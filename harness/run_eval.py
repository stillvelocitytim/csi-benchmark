"""CSI Benchmark — main evaluation harness.

Sends standardized prompts to multiple AI models, measures latency,
scores responses, and stores results in Supabase.
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import date, timezone
from pathlib import Path

from tabulate import tabulate

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("csi")

# ---------------------------------------------------------------------------
# Paths & config
# ---------------------------------------------------------------------------
TASKS_PATH = Path(__file__).parent / "tasks.json"

MODEL_CONFIGS = {
    "claude": {
        "model_id": "claude-sonnet-4-20250514",
        "provider": "anthropic",
        "display": "Claude Sonnet 4",
    },
    "gpt4o": {
        "model_id": "gpt-4o",
        "provider": "openai",
        "display": "GPT-4o",
    },
    "gemini": {
        "model_id": "gemini-2.5-flash",
        "provider": "google",
        "display": "Gemini 2.5 Flash",
    },
    "llama": {
        "model_id": "meta-llama/llama-3.3-70b-instruct",
        "provider": "openrouter",
        "display": "Llama 3.3 70B",
    },
}

# ---------------------------------------------------------------------------
# Supabase REST helpers (using httpx directly — avoids heavy SDK deps)
# ---------------------------------------------------------------------------

import httpx

_pricing_cache: dict[str, tuple[float, float]] = {}


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


def fetch_pricing(model_id: str) -> tuple[float, float]:
    """Return (input_price_per_M_tokens, output_price_per_M_tokens) from Supabase pricing table."""
    if model_id in _pricing_cache:
        return _pricing_cache[model_id]
    resp = httpx.get(
        _sb_url("pricing"),
        headers=_sb_headers(),
        params={"select": "input_price_per_million,output_price_per_million", "model": f"eq.{model_id}"},
    )
    resp.raise_for_status()
    data = resp.json()
    if data:
        row = data[0]
        result = (float(row["input_price_per_million"]), float(row["output_price_per_million"]))
        _pricing_cache[model_id] = result
        return result
    log.warning("No pricing found for %s — using 0", model_id)
    return 0.0, 0.0


def store_measurement(row: dict):
    resp = httpx.post(
        _sb_url("measurements"),
        headers=_sb_headers(),
        json=row,
    )
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# API callers — each returns (response_text, prompt_tokens, completion_tokens)
# ---------------------------------------------------------------------------

def call_anthropic(prompt: str, model_id: str):
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=model_id,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    text = msg.content[0].text
    return text, msg.usage.input_tokens, msg.usage.output_tokens


def call_openai(prompt: str, model_id: str):
    import openai
    client = openai.OpenAI()
    resp = client.chat.completions.create(
        model=model_id,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.choices[0].message.content
    return text, resp.usage.prompt_tokens, resp.usage.completion_tokens


def call_google(prompt: str, model_id: str):
    from google import genai
    client = genai.Client()
    resp = client.models.generate_content(model=model_id, contents=prompt)
    text = resp.text
    pt = getattr(resp.usage_metadata, "prompt_token_count", 0) or 0
    ct = getattr(resp.usage_metadata, "candidates_token_count", 0) or 0
    return text, pt, ct


def call_openrouter(prompt: str, model_id: str):
    import openai
    client = openai.OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ["OPENROUTER_API_KEY"],
    )
    resp = client.chat.completions.create(
        model=model_id,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.choices[0].message.content
    pt = resp.usage.prompt_tokens if resp.usage else 0
    ct = resp.usage.completion_tokens if resp.usage else 0
    return text, pt, ct


CALLERS = {
    "anthropic": call_anthropic,
    "openai": call_openai,
    "google": call_google,
    "openrouter": call_openrouter,
}

# ---------------------------------------------------------------------------
# Main evaluation loop
# ---------------------------------------------------------------------------

def run_single(task: dict, model_key: str, dry_run: bool = False) -> dict | None:
    """Run one task against one model. Returns measurement dict or None on failure."""
    from harness.scoring import score_task

    cfg = MODEL_CONFIGS[model_key]
    model_id = cfg["model_id"]
    provider = cfg["provider"]
    task_id = task["task_id"]
    prompt = task["prompt"]

    if dry_run:
        log.info("[DRY-RUN] model=%s task=%s — would send %d-char prompt", model_key, task_id, len(prompt))
        return None

    caller = CALLERS[provider]
    log.info("Calling %s (%s) for task %s …", cfg["display"], model_id, task_id)

    try:
        start = time.time()
        text, pt, ct = caller(prompt, model_id)
        elapsed = time.time() - start
    except Exception as exc:
        log.error("API error for %s / %s: %s", model_key, task_id, exc)
        return None

    score = score_task(text, task)

    # Pricing
    try:
        in_price, out_price = fetch_pricing(model_id)
    except Exception:
        in_price, out_price = 0.0, 0.0

    cost = (pt * in_price / 1_000_000) + (ct * out_price / 1_000_000)

    log.info(
        "  %s | %s | latency=%.2fs | tokens=%d+%d | score=%.2f | cost=$%.6f",
        model_key, task_id, elapsed, pt, ct, score, cost,
    )

    row = {
        "run_date": str(date.today()),
        "model": model_id,
        "provider": provider,
        "task_id": task_id,
        "domain": task["domain"],
        "prompt_tokens": pt,
        "completion_tokens": ct,
        "latency_seconds": round(elapsed, 4),
        "cost_dollars": round(cost, 8),
        "score": round(score, 2),
        "raw_response": text,
    }
    return row


def main():
    parser = argparse.ArgumentParser(description="CSI Benchmark evaluation harness")
    parser.add_argument("--model", type=str, help="Run only this model key (claude, gpt4o, gemini, llama)")
    parser.add_argument("--task", type=str, help="Run only this task ID (e.g. R1, C2)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without making API calls")
    parser.add_argument("--no-store", action="store_true", help="Skip writing results to Supabase")
    args = parser.parse_args()

    # Load tasks
    with open(TASKS_PATH) as f:
        tasks = json.load(f)

    # Filter
    if args.task:
        tasks = [t for t in tasks if t["task_id"].upper() == args.task.upper()]
        if not tasks:
            log.error("Task %s not found", args.task)
            sys.exit(1)

    model_keys = list(MODEL_CONFIGS.keys())
    if args.model:
        if args.model not in MODEL_CONFIGS:
            log.error("Unknown model key: %s. Choose from %s", args.model, list(MODEL_CONFIGS.keys()))
            sys.exit(1)
        model_keys = [args.model]

    log.info("Running %d task(s) x %d model(s) = %d call(s)", len(tasks), len(model_keys), len(tasks) * len(model_keys))

    results = []
    for model_key in model_keys:
        for task in tasks:
            row = run_single(task, model_key, dry_run=args.dry_run)
            if row is not None:
                results.append(row)
                # Store to Supabase
                if not args.no_store and not args.dry_run:
                    try:
                        store_measurement(row)
                        log.info("  Stored in Supabase.")
                    except Exception as exc:
                        log.error("  Supabase write failed: %s", exc)
                # Rate-limit pause
                time.sleep(2)

    # -----------------------------------------------------------------------
    # Summary table
    # -----------------------------------------------------------------------
    if not results:
        log.info("No results to summarize.")
        return

    table_rows = []
    for r in results:
        table_rows.append([
            r["model"],
            r["task_id"],
            r["domain"],
            f"{r['score']:.2f}",
            f"{r['latency_seconds']:.2f}s",
            f"{r['prompt_tokens']}+{r['completion_tokens']}",
            f"${r['cost_dollars']:.6f}",
        ])

    print("\n" + "=" * 80)
    print("EVALUATION RESULTS")
    print("=" * 80)
    print(tabulate(
        table_rows,
        headers=["Model", "Task", "Domain", "Score", "Latency", "Tokens (in+out)", "Cost"],
        tablefmt="grid",
    ))

    # Per-model summary
    from collections import defaultdict
    import statistics

    by_model = defaultdict(list)
    for r in results:
        by_model[r["model"]].append(r)

    summary_rows = []
    for model_id, rows in by_model.items():
        scores = [r["score"] for r in rows]
        lats = [r["latency_seconds"] for r in rows]
        costs = [r["cost_dollars"] for r in rows]
        avg_s = statistics.mean(scores)
        avg_l = statistics.mean(lats)
        avg_c = statistics.mean(costs)
        cs = avg_s / avg_l if avg_l > 0 else 0
        cd = avg_s / avg_c if avg_c > 0 else 0
        csi = avg_s / (avg_l * avg_c) if (avg_l > 0 and avg_c > 0) else 0
        summary_rows.append([
            model_id,
            f"{avg_s:.3f}",
            f"{avg_l:.2f}s",
            f"${avg_c:.6f}",
            f"{cs:.4f}",
            f"{cd:.2f}",
            f"{csi:.2f}",
        ])

    print("\nPER-MODEL SUMMARY:")
    print(tabulate(
        summary_rows,
        headers=["Model", "Avg Score", "Avg Latency", "Avg Cost", "CS (score/lat)", "CD (score/cost)", "CSI"],
        tablefmt="grid",
    ))


if __name__ == "__main__":
    main()
