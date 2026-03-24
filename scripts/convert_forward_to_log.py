"""One-shot script: convert historical forward curve data to natural log scale.

Applies math.log() to projected_csi, confidence_lower, confidence_upper
in csi_forward_curve, and projected_csi in csi_forward_by_model.
Skips rows where values are already < 10 (already converted).
"""

import math
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]


def headers(**extra):
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    h.update(extra)
    return h


def sb_url(table):
    return f"{SUPABASE_URL}/rest/v1/{table}"


def fetch_all(table, params=None):
    """Fetch all rows handling pagination."""
    all_rows = []
    offset = 0
    batch = 1000
    while True:
        p = {"select": "*", "limit": str(batch), "offset": str(offset), "order": "id"}
        if params:
            p.update(params)
        resp = httpx.get(sb_url(table), headers=headers(), params=p, timeout=30)
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        offset += batch
    return all_rows


def convert_forward_curve():
    """Convert csi_forward_curve: projected_csi, confidence_lower, confidence_upper."""
    print("\n=== csi_forward_curve ===")
    rows = fetch_all("csi_forward_curve", {"projected_csi": "gte.10"})
    print(f"  Rows to convert: {len(rows)}")

    for row in rows:
        patch = httpx.patch(
            sb_url("csi_forward_curve"),
            headers=headers(Prefer="return=minimal"),
            params={"id": f"eq.{row['id']}"},
            json={
                "projected_csi": round(math.log(row["projected_csi"]), 6),
                "confidence_lower": round(math.log(row["confidence_lower"]), 6),
                "confidence_upper": round(math.log(row["confidence_upper"]), 6),
            },
            timeout=30,
        )
        patch.raise_for_status()

    print(f"  Done: {len(rows)} updated")


def convert_forward_by_model():
    """Convert csi_forward_by_model: projected_csi only."""
    print("\n=== csi_forward_by_model ===")
    rows = fetch_all("csi_forward_by_model", {"projected_csi": "gte.10"})
    print(f"  Rows to convert: {len(rows)}")

    for i, row in enumerate(rows):
        patch = httpx.patch(
            sb_url("csi_forward_by_model"),
            headers=headers(Prefer="return=minimal"),
            params={"id": f"eq.{row['id']}"},
            json={"projected_csi": round(math.log(row["projected_csi"]), 6)},
            timeout=30,
        )
        patch.raise_for_status()
        if (i + 1) % 50 == 0:
            print(f"    {i + 1}/{len(rows)}")

    print(f"  Done: {len(rows)} updated")


if __name__ == "__main__":
    convert_forward_curve()
    convert_forward_by_model()
    print("\nAll done. Now run: python -m harness.compute_forward")
