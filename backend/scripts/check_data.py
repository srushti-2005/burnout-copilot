#!/usr/bin/env python3
"""
MindEase data check (read-only: it only SELECTs).

Put this file in  backend/scripts/  and run it from the backend root
(the folder that contains src/), using the same .env as the API:

    python scripts/check_data.py you@example.com
    python scripts/check_data.py <user-uuid> --limit 40

It prints your latest sessions next to the training bounds, then flags
anything that makes the logged data suspicious (units, zeros, duplicates,
timezone, big CLI jumps, nulls).
"""
from __future__ import annotations

import argparse
import statistics
import sys
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:  # optional: load backend/.env if python-dotenv is installed
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except Exception:
    pass

import pandas as pd
from dateutil import parser as dtparser
from datetime import timezone

from src.auth.supabase_client import get_service_client
from src.cli_logic import (
    calculate_cli,
    get_training_bounds,
    get_training_weights,
    normalize_with_fixed_bounds,
)

IST = ZoneInfo("Asia/Kolkata")
FEATURES = ["typing_mean", "typing_variance", "task_switching", "work_duration"]
REQUIRED = FEATURES + ["late_night", "cli_score", "created_at"]


def parse_ts(v):
    dt = dtparser.isoparse(str(v))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def resolve_user(sb, who: str) -> str:
    if "@" not in who:
        return who
    res = sb.table("profiles").select("id").eq("email", who).execute()
    if not res.data:
        sys.exit(f"No profile found for email {who!r}. Pass the user UUID instead.")
    return res.data[0]["id"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("user", help="email or user UUID")
    ap.add_argument("--limit", type=int, default=30)
    args = ap.parse_args()

    sb = get_service_client()
    uid = resolve_user(sb, args.user)
    res = (
        sb.table("sessions").select("*")
        .eq("user_id", uid).order("created_at", desc=True)
        .limit(args.limit).execute()
    )
    rows = list(reversed(res.data or []))
    if not rows:
        print(f"No sessions stored for {uid}. Nothing reached the sessions table.")
        return 1

    bounds = get_training_bounds()
    weights = get_training_weights()

    print(f"User {uid}  |  {len(rows)} sessions (oldest -> newest)\n")
    print("Training upper bounds (values above these are clipped to 1.0):")
    for k in FEATURES:
        print(f"  {k:16s} max = {bounds[k][1]:.3f}")
    print()

    hdr = (f"{'time (IST)':16s} {'src':8s} {'typ_mean':>9s} {'typ_var':>9s} {'switch':>7s} "
           f"{'hours':>7s} {'late':>4s} {'cli':>6s} {'raw':>6s} {'mult':>5s} {'instant':>7s}")
    print(hdr)
    print("-" * len(hdr))

    flags: list[tuple[str, str]] = []
    norm_cols: dict[str, list[float]] = {k: [] for k in FEATURES}
    clipped = Counter()
    nulls = Counter()
    idle = 0
    zero_cli = 0
    dt_list = []
    prev = None

    for r in rows:
        for c in REQUIRED:
            if r.get(c) is None:
                nulls[c] += 1
        vals = {k: float(r.get(k) or 0) for k in FEATURES}
        late = int(bool(r.get("late_night")))
        df = pd.DataFrame([{**vals, "late_night": late}])
        norm = normalize_with_fixed_bounds(df, bounds).iloc[0]
        instant = calculate_cli(norm, weights)
        for k in FEATURES:
            norm_cols[k].append(float(norm[f"{k}_norm"]))
            if vals[k] > bounds[k][1]:
                clipped[k] += 1

        t = parse_ts(r["created_at"])
        dt_list.append(t)
        cli = float(r.get("cli_score") or 0)
        if cli <= 0:
            zero_cli += 1
        if all(v == 0 for v in vals.values()) and not late:
            idle += 1

        print(f"{t.astimezone(IST):%m-%d %H:%M:%S}  {str(r.get('device_source') or '-'):8s} "
              f"{vals['typing_mean']:9.2f} {vals['typing_variance']:9.2f} {vals['task_switching']:7.0f} "
              f"{vals['work_duration']:7.3f} {late:4d} {cli:6.3f} {float(r.get('cli_score_raw') or 0):6.3f} "
              f"{float(r.get('context_multiplier') or 1):5.2f} {instant:7.3f}")

        # CLI step size between consecutive sessions (only when no overnight gap)
        if prev is not None:
            gap_h = (t - parse_ts(prev["created_at"])).total_seconds() / 3600
            step = abs(cli - float(prev.get("cli_score") or 0))
            if gap_h < 6 and step > 0.05:
                flags.append(("WARN", f"CLI jumped {step:.3f} in one step at {t.astimezone(IST):%m-%d %H:%M} (cap should be ~0.03)"))
        # late_night flag vs local hour (daytime sessions should not be late-night)
        h = t.astimezone(IST).hour
        if late and 7 <= h <= 20:
            flags.append(("WARN", f"late_night=1 at {h:02d}:xx IST ({t.astimezone(IST):%m-%d}) -- the sender may be computing it in UTC"))
        prev = r

    print()

    # --- flags ---
    if nulls:
        flags.append(("ERROR", f"NULL values in columns: {dict(nulls)} (these crashed /dashboard before the _clean_row fix)"))
    if zero_cli:
        flags.append(("ERROR", f"{zero_cli} rows have cli_score 0/NULL. The scorer never stores 0 for active rows"))
    if idle:
        flags.append(("INFO", f"{idle}/{len(rows)} rows are fully idle (all zeros). They still update your baseline unless you apply the has_activity guard"))
    for k, n in clipped.items():
        flags.append(("WARN", f"{k}: {n}/{len(rows)} rows exceed the training max ({bounds[k][1]:.2f}) -> clipped at 1.0. Check the sender's units"))
    for k in FEATURES:
        nz = [v for v in norm_cols[k] if v > 0]
        med = statistics.median(norm_cols[k])
        if nz and statistics.median(nz) < 0.01:
            flags.append(("WARN", f"{k}: normalized values are ~0 (median {statistics.median(nz):.4f}) -> sender units are probably far smaller than the training data"))
        if med >= 0.99:
            flags.append(("WARN", f"{k}: nearly every row is clipped at 1.0 -> units are probably far larger than the training data"))

    gaps = [(b - a).total_seconds() for a, b in zip(dt_list, dt_list[1:])]
    if gaps:
        print(f"Spacing between sessions: median {statistics.median(gaps)/60:.1f} min, "
              f"min {min(gaps):.0f} s, max {max(gaps)/3600:.1f} h")
        dupes = sum(1 for g in gaps if g < 30)
        if dupes:
            flags.append(("WARN", f"{dupes} sessions landed <30 s after the previous one (double sender, retry, or sync replay)"))
    src = Counter(str(r.get("device_source") or "NULL") for r in rows)
    print(f"device_source counts: {dict(src)}")
    if "NULL" in src:
        flags.append(("WARN", "Some rows have device_source NULL. Run the SQL migration that adds the column"))
    print(f"Median normalized value per feature: "
          + ", ".join(f"{k}={statistics.median(v):.3f}" for k, v in norm_cols.items()))
    print()

    if not flags:
        print("RESULT: no problems detected in these rows.")
        return 0
    order = {"ERROR": 0, "WARN": 1, "INFO": 2}
    seen = set()
    print("RESULT: things to look at")
    for sev, msg in sorted(flags, key=lambda f: order[f[0]]):
        if msg in seen:
            continue
        seen.add(msg)
        print(f"  [{sev}] {msg}")
    return 1 if any(s == "ERROR" for s, _ in flags) else 0


if __name__ == "__main__":
    raise SystemExit(main())
