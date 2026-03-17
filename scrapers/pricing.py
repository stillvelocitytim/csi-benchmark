"""Insert hardcoded model pricing into Supabase pricing table.

Prices are per 1M tokens (input and output) as of March 2026.
Run this once to seed the table, or again to update after price changes.

Usage:
    python -m scrapers.pricing
    python -m scrapers.pricing --dry-run
"""

import argparse
import os
import sys

import httpx

PRICING = [
    {
        "model": "claude-sonnet-4-20250514",
        "provider": "anthropic",
        "input_price_per_million": 3.00,
        "output_price_per_million": 15.00,
        "source_url": "https://docs.anthropic.com/en/docs/about-claude/models",
        "snapshot_date": "2026-03-13",
    },
    {
        "model": "gpt-4o",
        "provider": "openai",
        "input_price_per_million": 2.50,
        "output_price_per_million": 10.00,
        "source_url": "https://openai.com/api/pricing/",
        "snapshot_date": "2026-03-13",
    },
    {
        "model": "gemini-2.0-flash",
        "provider": "google",
        "input_price_per_million": 0.10,
        "output_price_per_million": 0.40,
        "source_url": "https://ai.google.dev/pricing",
        "snapshot_date": "2026-03-13",
    },
    {
        "model": "meta-llama/llama-3.3-70b-instruct",
        "provider": "openrouter",
        "input_price_per_million": 0.39,
        "output_price_per_million": 0.39,
        "source_url": "https://openrouter.ai/models/meta-llama/llama-3.3-70b-instruct",
        "snapshot_date": "2026-03-13",
    },
    {
        "model": "nvidia/llama-3.3-nemotron-super-49b-v1.5",
        "provider": "openrouter",
        "input_price_per_million": 0.10,
        "output_price_per_million": 0.40,
        "source_url": "https://openrouter.ai/models/nvidia/llama-3.3-nemotron-super-49b-v1.5",
        "snapshot_date": "2026-03-17",
    },
    {
        "model": "deepseek/deepseek-v3.2",
        "provider": "openrouter",
        "input_price_per_million": 0.26,
        "output_price_per_million": 0.38,
        "source_url": "https://openrouter.ai/models/deepseek/deepseek-v3.2",
        "snapshot_date": "2026-03-17",
    },
    {
        "model": "cohere/command-a",
        "provider": "openrouter",
        "input_price_per_million": 2.50,
        "output_price_per_million": 10.00,
        "source_url": "https://openrouter.ai/models/cohere/command-a",
        "snapshot_date": "2026-03-17",
    },
    {
        "model": "claude-haiku-4-5-20251001",
        "provider": "anthropic",
        "input_price_per_million": 1.00,
        "output_price_per_million": 5.00,
        "source_url": "https://docs.anthropic.com/en/docs/about-claude/models",
        "snapshot_date": "2026-03-17",
    },
    {
        "model": "x-ai/grok-3",
        "provider": "openrouter",
        "input_price_per_million": 3.00,
        "output_price_per_million": 15.00,
        "source_url": "https://openrouter.ai/models/x-ai/grok-3",
        "snapshot_date": "2026-03-17",
    },
    {
        "model": "deepseek/deepseek-r1-0528",
        "provider": "openrouter",
        "input_price_per_million": 0.45,
        "output_price_per_million": 2.15,
        "source_url": "https://openrouter.ai/models/deepseek/deepseek-r1-0528",
        "snapshot_date": "2026-03-17",
    },
    {
        "model": "cohere/command-r-plus-08-2024",
        "provider": "openrouter",
        "input_price_per_million": 2.50,
        "output_price_per_million": 10.00,
        "source_url": "https://openrouter.ai/models/cohere/command-r-plus-08-2024",
        "snapshot_date": "2026-03-17",
    },
    {
        "model": "qwen/qwen-2.5-72b-instruct",
        "provider": "openrouter",
        "input_price_per_million": 0.12,
        "output_price_per_million": 0.39,
        "source_url": "https://openrouter.ai/models/qwen/qwen-2.5-72b-instruct",
        "snapshot_date": "2026-03-17",
    },
]


def _sb_headers() -> dict:
    key = os.environ["SUPABASE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def _sb_url(table: str) -> str:
    return f"{os.environ['SUPABASE_URL']}/rest/v1/{table}"


def main():
    parser = argparse.ArgumentParser(description="Seed Supabase pricing table")
    parser.add_argument("--dry-run", action="store_true", help="Print rows without inserting")
    args = parser.parse_args()

    if not args.dry_run:
        for var in ("SUPABASE_URL", "SUPABASE_KEY"):
            if var not in os.environ:
                print(f"Error: {var} not set", file=sys.stderr)
                sys.exit(1)

    for row in PRICING:
        if args.dry_run:
            print(f"[DRY-RUN] {row['model']:45s}  "
                  f"in=${row['input_price_per_million']:<8.2f} out=${row['output_price_per_million']:<8.2f}  "
                  f"({row['provider']})")
            continue

        resp = httpx.post(_sb_url("pricing"), headers=_sb_headers(), json=row)
        if resp.status_code in (200, 201):
            print(f"OK  {row['model']}")
        else:
            print(f"ERR {row['model']}: {resp.status_code} {resp.text}", file=sys.stderr)

    if args.dry_run:
        print(f"\n{len(PRICING)} rows would be upserted into 'pricing' table.")
    else:
        print(f"\n{len(PRICING)} rows upserted into 'pricing' table.")


if __name__ == "__main__":
    main()
