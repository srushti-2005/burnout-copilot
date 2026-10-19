#!/usr/bin/env python3
"""
Recompute cli_score / cli_score_raw / risk_level for stored sessions with the
CURRENT scoring rules (original CRITIC formula + idle=0 + gradual dynamics).

Raw signals are never touched. DRY RUN by default; nothing is written
unless you pass --apply.

    python scripts/recompute_cli.py                    # dry run, all users
    python scripts/recompute_cli.py --user <uuid>      # one user
    python scripts/recompute_cli.py --apply            # write changes

Take a backup first (Supabase SQL editor):
    create table sessions_backup_20261019 as select * from sessions;
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except Exception:
    pass

from dateutil import parser as dtparser

from src.auth.supabase_client import get_service_client
from src.cli_logic import compute_session_cli, get_training_bounds, get_training_weights

PAGE = 1000


def parse_ts(v):
    dt = dtparser.isoparse(str(v))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def fetch_all(sb, user=None):
    rows, start = [], 0
    while True:
        q = sb.table("sessions").select("*")
        if user:
            q = q.eq("user_id", user)
        batch = q.order("created_at").range(start, start + PAGE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        start += PAGE


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", help="only this user id")
    ap.add_argument("--apply", action="store_true", help="write the new values")
    args = ap.parse_args(argv)

    sb = get_service_client()
    weights, bounds = get_training_weights(), get_training_bounds()
    by_user = defaultdict(list)
    for r in fetch_all(sb, args.user):
        by_user[r["user_id"]].append(r)

    changed = total = 0
    for uid, rows in by_user.items():
        rows.sort(key=lambda r: parse_ts(r["created_at"]))
        prev, prev_t = None, None
        for r in rows:
            t = parse_ts(r["created_at"])
            gap = None if prev_t is None else max(0.0, (t - prev_t).total_seconds() / 60.0)
            raw, adj, risk = compute_session_cli(
                r, prev, gap, r.get("context_multiplier") or 1.0, weights, bounds)
            total += 1
            old = float(r.get("cli_score") or 0)
            if abs(old - adj) > 1e-9 or r.get("risk_level") != risk:
                changed += 1
                print(f"{uid[:8]} {t:%Y-%m-%d %H:%M:%S}  cli {old:.3f} -> {adj:.3f}   raw {float(r.get('cli_score_raw') or 0):.3f} -> {raw:.3f}")
                if args.apply:
                    sb.table("sessions").update(
                        {"cli_score": adj, "cli_score_raw": raw, "risk_level": risk}
                    ).eq("id", r["id"]).execute()
            prev, prev_t = {"cli_score": adj, "cli_score_raw": raw}, t

    mode = "APPLIED" if args.apply else "DRY RUN (nothing written; add --apply)"
    print(f"\n{mode}: {changed} of {total} rows would change across {len(by_user)} user(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
