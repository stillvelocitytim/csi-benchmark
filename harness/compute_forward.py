"""CSI Forward Curve — projection engine.

Decomposes CSI into Score, Latency, Cost, models each independently,
and recomposes via Monte Carlo simulation across 3 scenarios × 4 horizons.
"""

import logging
import math
import os
from datetime import date

import httpx
import numpy as np
from dotenv import load_dotenv
from tabulate import tabulate

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("csi-forward")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HORIZONS = [3, 6, 12, 24]  # months
SCENARIOS = ["below_trend", "historical_trend", "above_trend"]

# Score improvement rates (logistic k parameter)
SCORE_K = {"below_trend": 0.5, "historical_trend": 1.0, "above_trend": 2.0}

# Cost deflation rates (annualized)
COST_DEFLATION = {"below_trend": 0.30, "historical_trend": 0.50, "above_trend": 0.70}

# Latency improvement rates (annualized)
LATENCY_IMPROVEMENT = {"below_trend": 0.15, "historical_trend": 0.25, "above_trend": 0.40}

# Credibility discounts (applied to improvement rates)
CREDIBILITY = {
    "anthropic": 0.90,
    "openai": 0.75,
    "google": 0.80,
    "openrouter_meta": 0.85,
    "openrouter_mistral": 0.80,
}

# Monte Carlo parameters
N_SIMULATIONS = 10_000
SEED = 42

# Noise standard deviations
SCORE_STD = 0.02
LATENCY_STD_FRAC = 0.15  # 15% of projected latency
COST_STD_FRAC = 0.20     # 20% of projected cost

# Hardware step: B300 GPU at month >= 12 → 0.80x latency multiplier
HW_STEP_MONTH = 12
HW_STEP_FACTOR = 0.80

# Flash-effect models
FLASH_EFFECT_MODELS = {"gemini-2.5-flash"}

# ---------------------------------------------------------------------------
# Supabase helpers (same pattern as compute_csi.py)
# ---------------------------------------------------------------------------


def _sb_headers() -> dict:
    key = os.environ["SUPABASE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def _sb_url(table: str) -> str:
    return f"{os.environ['SUPABASE_URL']}/rest/v1/{table}"


# ---------------------------------------------------------------------------
# Provider → credibility mapping
# ---------------------------------------------------------------------------


def _credibility_for(model: str, provider: str) -> float:
    if provider == "anthropic":
        return CREDIBILITY["anthropic"]
    if provider == "openai":
        return CREDIBILITY["openai"]
    if provider == "google":
        return CREDIBILITY["google"]
    if provider == "openrouter":
        if "llama" in model.lower() or "meta" in model.lower():
            return CREDIBILITY["openrouter_meta"]
        if "mistral" in model.lower():
            return CREDIBILITY["openrouter_mistral"]
        return 0.80  # default for other openrouter models
    return 0.70  # unknown provider


# ---------------------------------------------------------------------------
# Component projection models
# ---------------------------------------------------------------------------


def project_score(score_now: float, t_years: float, scenario: str) -> float:
    """Logistic saturation: score(t) = 1.0 - (1.0 - score_now) * exp(-k * t)"""
    k = SCORE_K[scenario]
    projected = 1.0 - (1.0 - score_now) * math.exp(-k * t_years)
    return min(projected, 1.0)


def project_latency(
    latency_now: float, t_years: float, scenario: str,
    credibility: float, horizon_months: int,
) -> float:
    """Log-linear with hardware step at month >= 12."""
    rate = LATENCY_IMPROVEMENT[scenario] * credibility
    projected = latency_now * math.exp(-rate * t_years)
    if horizon_months >= HW_STEP_MONTH:
        projected *= HW_STEP_FACTOR
    return projected


def project_cost(
    cost_now: float, t_years: float, scenario: str,
    credibility: float, is_flash: bool,
) -> float:
    """Exponential deflation. Flash-effect models use below_trend regardless."""
    if is_flash:
        rate = COST_DEFLATION["below_trend"] * credibility
    else:
        rate = COST_DEFLATION[scenario] * credibility
    return cost_now * math.exp(-rate * t_years)


# ---------------------------------------------------------------------------
# Monte Carlo engine
# ---------------------------------------------------------------------------


def monte_carlo_csi(
    score_proj: float, latency_proj: float, cost_proj: float,
    rng: np.random.Generator,
) -> np.ndarray:
    """Sample N_SIMULATIONS CSI values from noisy component distributions."""
    scores = rng.normal(score_proj, SCORE_STD, N_SIMULATIONS)
    scores = np.clip(scores, 0.01, 1.0)

    latencies = rng.normal(latency_proj, LATENCY_STD_FRAC * latency_proj, N_SIMULATIONS)
    latencies = np.clip(latencies, 0.01, None)

    costs = rng.normal(cost_proj, COST_STD_FRAC * cost_proj, N_SIMULATIONS)
    costs = np.clip(costs, 1e-9, None)

    return scores / (latencies * costs)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    run_date = str(date.today())
    rng = np.random.default_rng(SEED)

    # 1. Fetch current measurements from csi_by_model
    log.info("Fetching current model data from csi_by_model …")
    resp = httpx.get(
        _sb_url("csi_by_model"),
        headers=_sb_headers(),
        params={"select": "*", "order": "run_date.desc"},
    )
    resp.raise_for_status()
    all_rows = resp.json()

    if not all_rows:
        log.error("No data in csi_by_model")
        return

    # Use the latest run_date
    latest_date = all_rows[0]["run_date"]
    models = [r for r in all_rows if r["run_date"] == latest_date]
    log.info("Using %d models from run_date=%s", len(models), latest_date)

    # 2. Run projections: 8 models × 4 horizons × 3 scenarios
    per_model_results = []
    for m in models:
        model_name = m["model"]
        provider = m["provider"]
        score_now = float(m["avg_score"])
        latency_now = float(m["avg_latency"])
        cost_now = float(m["avg_cost"])
        cred = _credibility_for(model_name, provider)
        is_flash = model_name in FLASH_EFFECT_MODELS

        for horizon in HORIZONS:
            t_years = horizon / 12.0
            for scenario in SCENARIOS:
                s_proj = project_score(score_now, t_years, scenario)
                l_proj = project_latency(latency_now, t_years, scenario, cred, horizon)
                c_proj = project_cost(cost_now, t_years, scenario, cred, is_flash)

                csi_samples = monte_carlo_csi(s_proj, l_proj, c_proj, rng)
                median_csi = float(np.median(csi_samples))
                p10 = float(np.percentile(csi_samples, 10))
                p90 = float(np.percentile(csi_samples, 90))

                per_model_results.append({
                    "run_date": run_date,
                    "model": model_name,
                    "horizon_months": horizon,
                    "scenario": scenario,
                    "projected_csi": round(median_csi, 2),
                    "projected_score": round(s_proj, 4),
                    "projected_latency": round(l_proj, 4),
                    "projected_cost": round(c_proj, 8),
                    "credibility_discount": round(cred, 2),
                    "flash_effect_flag": is_flash,
                    # carry forward for aggregate computation
                    "_p10": p10,
                    "_p90": p90,
                    "_samples": csi_samples,
                })

    # 3. Compute aggregate forward curve (median of per-model medians)
    aggregate_results = []
    for horizon in HORIZONS:
        t_years = horizon / 12.0
        for scenario in SCENARIOS:
            subset = [
                r for r in per_model_results
                if r["horizon_months"] == horizon and r["scenario"] == scenario
            ]
            # For each MC iteration, take the median across models
            all_samples = np.stack([r["_samples"] for r in subset])  # (n_models, N_SIM)
            agg_samples = np.median(all_samples, axis=0)  # (N_SIM,)

            agg_median = float(np.median(agg_samples))
            agg_p10 = float(np.percentile(agg_samples, 10))
            agg_p90 = float(np.percentile(agg_samples, 90))

            # Representative cost deflation rate for this scenario
            defl_rate = COST_DEFLATION[scenario]

            aggregate_results.append({
                "run_date": run_date,
                "horizon_months": horizon,
                "scenario": scenario,
                "projected_csi": round(agg_median, 2),
                "projected_score": None,
                "projected_latency": None,
                "projected_cost_deflation_rate": round(defl_rate, 4),
                "confidence_lower": round(agg_p10, 2),
                "confidence_upper": round(agg_p90, 2),
                "n_simulations": N_SIMULATIONS,
                "methodology_version": "structural_v1",
            })

    # 4. Print summary tables
    print("\n" + "=" * 100)
    print(f"CSI FORWARD CURVE — AGGREGATE — {run_date}")
    print("=" * 100)
    agg_table = []
    for r in aggregate_results:
        agg_table.append([
            r["horizon_months"],
            r["scenario"],
            f"{r['projected_csi']:.2f}",
            f"{r['confidence_lower']:.2f}",
            f"{r['confidence_upper']:.2f}",
            f"{r['projected_cost_deflation_rate']:.2f}",
        ])
    print(tabulate(
        agg_table,
        headers=["Horizon (mo)", "Scenario", "Projected CSI", "CI Lower (p10)", "CI Upper (p90)", "Cost Defl Rate"],
        tablefmt="grid",
    ))

    print("\n" + "=" * 100)
    print(f"CSI FORWARD BY MODEL — {run_date}")
    print("=" * 100)
    model_table = []
    for r in per_model_results:
        model_table.append([
            r["model"][:30],
            r["horizon_months"],
            r["scenario"],
            f"{r['projected_csi']:.2f}",
            f"{r['projected_score']:.4f}",
            f"{r['projected_latency']:.4f}",
            f"${r['projected_cost']:.8f}",
            f"{r['credibility_discount']:.2f}",
            "Y" if r["flash_effect_flag"] else "",
        ])
    print(tabulate(
        model_table,
        headers=["Model", "Horizon", "Scenario", "Proj CSI", "Proj Score",
                 "Proj Latency", "Proj Cost", "Cred", "Flash"],
        tablefmt="grid",
    ))

    # 5. Store per-model results in csi_forward_by_model
    log.info("Storing %d per-model forward projections …", len(per_model_results))
    headers = {**_sb_headers(), "Prefer": "return=minimal"}
    for r in per_model_results:
        payload = {k: v for k, v in r.items() if not k.startswith("_")}
        try:
            resp = httpx.post(_sb_url("csi_forward_by_model"), headers=headers, json=payload)
            resp.raise_for_status()
        except Exception as exc:
            log.error("Failed to store forward_by_model %s/%s/%s: %s",
                      r["model"], r["horizon_months"], r["scenario"], exc)

    # 6. Store aggregate results in csi_forward_curve
    log.info("Storing %d aggregate forward curve points …", len(aggregate_results))
    for r in aggregate_results:
        try:
            resp = httpx.post(_sb_url("csi_forward_curve"), headers=headers, json=r)
            resp.raise_for_status()
        except Exception as exc:
            log.error("Failed to store forward_curve %s/%s: %s",
                      r["horizon_months"], r["scenario"], exc)

    log.info("Done. %d model projections, %d aggregate points stored.",
             len(per_model_results), len(aggregate_results))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log.error("Forward curve computation failed: %s", exc)
        log.info("This is non-fatal — forward curve will be retried on next run.")
        raise SystemExit(1)
