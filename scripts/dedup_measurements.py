"""One-time script: deduplicate measurements for 2026-03-19.

For each (model, task_id, run_date) group on that date, keeps only the
row with the highest `id` (most recently inserted) and deletes the rest.

Requires SUPABASE_URL and SUPABASE_KEY environment variables.

Usage:
    python -m scripts.dedup_measurements          # dry-run (default)
    python -m scripts.dedup_measurements --apply   # actually delete
"""

import os
import sys
from collections import defaultdict

import httpx

TARGET_DATE = "2026-03-19"


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


def fetch_rows():
    """Fetch all measurement rows for TARGET_DATE."""
    resp = httpx.get(
        _sb_url("measurements"),
        headers=_sb_headers(),
        params={
            "select": "id,model,task_id,run_date",
            "run_date": f"eq.{TARGET_DATE}",
            "order": "id.asc",
        },
    )
    resp.raise_for_status()
    return resp.json()


def find_duplicates(rows: list[dict]) -> list[int]:
    """Return IDs to delete — keeps the highest id per (model, task_id, run_date)."""
    groups: dict[tuple, list[int]] = defaultdict(list)
    for r in rows:
        key = (r["model"], r["task_id"], r["run_date"])
        groups[key].append(r["id"])

    ids_to_delete = []
    for key, ids in groups.items():
        if len(ids) > 1:
            ids.sort()
            ids_to_delete.extend(ids[:-1])  # keep the last (highest) id
    return ids_to_delete


def delete_rows(ids: list[int]):
    """Delete rows by id."""
    for row_id in ids:
        resp = httpx.delete(
            _sb_url("measurements"),
            headers=_sb_headers(),
            params={"id": f"eq.{row_id}"},
        )
        resp.raise_for_status()


def main():
    apply = "--apply" in sys.argv

    rows = fetch_rows()
    print(f"Found {len(rows)} rows for {TARGET_DATE}")

    ids_to_delete = find_duplicates(rows)
    if not ids_to_delete:
        print("No duplicates found.")
        return

    print(f"Duplicates to delete: {len(ids_to_delete)} rows")

    if not apply:
        print("Dry run — pass --apply to actually delete.")
        print(f"IDs that would be deleted: {ids_to_delete}")
        return

    delete_rows(ids_to_delete)
    print(f"Deleted {len(ids_to_delete)} duplicate rows.")


if __name__ == "__main__":
    main()
