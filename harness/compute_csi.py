"""Compute CSI index values from measurements stored in Supabase.

Reads the measurements table, aggregates per model and overall,
then writes results to csi_by_model and csi_index tables.
"""

import argparse
import logging
import os
import statistics
from collections import defaultdict
from datetime import date

import httpx
from tabulate import tabulate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("csi-compute")


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


def main():
    parser = argparse.ArgumentParser(description="Compute CSI index from measurements")
    parser.add_argument("--date", type=str, default=str(date.today()),
                        help="Run date to compute for (YYYY-MM-DD, default=today)")
    args = parser.parse_args()

    run_date = args.date

    log.info("Fetching measurements for run_date=%s", run_date)
    resp = httpx.get(
        _sb_url("measurements"),
        headers=_sb_headers(),
        params={"select": "*", "run_date": f"eq.{run_date}"},
    )
    resp.raise_for_status()
    rows = resp.json()

    if not rows:
        log.error("No measurements found for %s", run_date)
        return

    log.info("Found %d measurements", len(rows))

    # Group by model
    by_model = defaultdict(list)
    for r in rows:
        by_model[r["model"]].append(r)

    model_results = []
    for model_id, mrows in by_model.items():
        provider = mrows[0]["provider"]
        scores = [float(r["score"]) for r in mrows]
        lats = [float(r["latency_seconds"]) for r in mrows]
        costs = [float(r["cost_dollars"]) for r in mrows]
        n_tasks = len(mrows)

        avg_score = statistics.mean(scores)
        avg_latency = statistics.mean(lats)
        avg_cost = statistics.mean(costs)

        cs = avg_score / avg_latency if avg_latency > 0 else 0
        cd = avg_score / avg_cost if avg_cost > 0 else 0
        csi = avg_score / (avg_latency * avg_cost) if (avg_latency > 0 and avg_cost > 0) else 0

        entry = {
            "run_date": run_date,
            "model": model_id,
            "provider": provider,
            "avg_score": round(avg_score, 4),
            "avg_latency": round(avg_latency, 4),
            "avg_cost": round(avg_cost, 8),
            "cs": round(cs, 4),
            "cd": round(cd, 4),
            "csi": round(csi, 4),
        }
        model_results.append(entry)

    # Print per-model table
    table = []
    for m in model_results:
        table.append([
            m["model"], n_tasks,
            f"{m['avg_score']:.3f}", f"{m['avg_latency']:.2f}s",
            f"${m['avg_cost']:.6f}", f"{m['cs']:.4f}",
            f"{m['cd']:.2f}", f"{m['csi']:.2f}",
        ])

    print("\n" + "=" * 80)
    print(f"CSI BY MODEL — {run_date}")
    print("=" * 80)
    print(tabulate(
        table,
        headers=["Model", "Tasks", "Avg Score", "Avg Latency", "Avg Cost", "CS", "CD", "CSI"],
        tablefmt="grid",
    ))

    # Write to csi_by_model (upsert via Prefer header)
    upsert_headers = {**_sb_headers(), "Prefer": "resolution=merge-duplicates"}
    for entry in model_results:
        try:
            r = httpx.post(_sb_url("csi_by_model"), headers=upsert_headers, json=entry)
            r.raise_for_status()
        except Exception as exc:
            log.error("Failed to upsert csi_by_model for %s: %s", entry["model"], exc)

    # Compute aggregate index
    if model_results:
        csi_vals = [m["csi"] for m in model_results]
        cs_vals = [m["cs"] for m in model_results]
        cd_vals = [m["cd"] for m in model_results]

        agg = {
            "run_date": run_date,
            "csi_aggregate": round(statistics.median(csi_vals), 4),
            "cs_aggregate": round(statistics.median(cs_vals), 4),
            "cd_aggregate": round(statistics.median(cd_vals), 4),
            "methodology_version": "v1",
        }

        print(f"\nAGGREGATE INDEX:")
        print(f"  CSI (median): {agg['csi_aggregate']:.4f}")
        print(f"  CS  (median): {agg['cs_aggregate']:.4f}")
        print(f"  CD  (median): {agg['cd_aggregate']:.4f}")
        print(f"  Models: {len(model_results)}")

        try:
            r = httpx.post(_sb_url("csi_index"), headers=upsert_headers, json=agg)
            r.raise_for_status()
            log.info("Stored aggregate index for %s", run_date)
        except Exception as exc:
            log.error("Failed to upsert csi_index: %s", exc)


if __name__ == "__main__":
    main()
