#!/usr/bin/env python3
"""
MindEase data check (read-only: it only SELECTs).

Put this file in  backend/scripts/  and run it from the backend root
(the folder that contains src/), using the same .env as the API:

    python scripts/check_data.py you@example.com
    python scripts/check_data.py <user-uuid> --limit 60

It prints the latest sessions next to the live CLI rules, then flags what
makes the logged data suspicious: dead trackers, wrong units, duplicates,
a CLI that is not decaying, timezone slips, NULLs.
"""
from __future__ import annotations

import argparse
import statistics
import sys
from collections import Counter
from datetime import timezone
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

from dateutil import parser as dtparser

from src.auth.supabase_client import get_service_client
from src.cli_logic import get_training_bounds, get_training_weights, instant_cli, is_idle

IST = ZoneInfo("Asia/Kolkata")
FEATURES = ["typing_mean", "typing_variance", "task_switching", "work_duration"]
REQUIRED = FEATURES + ["late_night", "cli_score", "created_at"]
IDLE_STREAK_MIN_FOR_ZERO = 45     # idle this long -> stored CLI should be ~0


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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("user", help="email or user UUID")
    ap.add_argument("--limit", type=int, default=40)
    args = ap.parse_args(argv)

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
    print("Training bounds (live values above max are clipped to 1.0):")
    for k in FEATURES:
        print(f"  {k:16s} {bounds[k][0]:.1f} .. {bounds[k][1]:.3f}")
    print()

    hdr = (f"{'time (IST)':14s} {'src':7s} {'typ_mean':>9s} {'typ_var':>9s} {'switch':>6s} "
           f"{'hours':>6s} {'late':>4s} {'cli':>6s} {'raw':>6s} {'mult':>5s} {'instant':>7s}")
    print(hdr)
    print("-" * len(hdr))

    flags: list[tuple[str, str]] = []
    clipped, nulls = Counter(), Counter()
    times, vals_list, idle_flags = [], [], []
    prev = None
    idle_streak_start = None

    for r in rows:
        for c in REQUIRED:
            if r.get(c) is None:
                nulls[c] += 1
        vals = {k: float(r.get(k) or 0) for k in FEATURES}
        late = int(bool(r.get("late_night")))
        sample = {**vals, "late_night": late}
        inst = instant_cli(sample, weights, bounds)
        idle = is_idle(sample)
        for k in FEATURES:
            if vals[k] > bounds[k][1]:
                clipped[k] += 1

        t = parse_ts(r["created_at"])
        cli = float(r.get("cli_score") or 0)
        times.append(t)
        vals_list.append(sample)
        idle_flags.append(idle)

        print(f"{t.astimezone(IST):%m-%d %H:%M:%S}  {str(r.get('device_source') or '-'):7s} "
              f"{vals['typing_mean']:9.2f} {vals['typing_variance']:9.2f} {vals['task_switching']:6.0f} "
              f"{vals['work_duration']:6.3f} {late:4d} {cli:6.3f} {float(r.get('cli_score_raw') or 0):6.3f} "
              f"{float(r.get('context_multiplier') or 1):5.2f} {inst:7.3f}")

        if not idle and cli <= 0 and inst >= 0.02:
            flags.append(("ERROR", f"{t.astimezone(IST):%m-%d %H:%M}: active window (instant {inst:.3f}) stored with CLI 0"))
        if idle:
            idle_streak_start = idle_streak_start or t
            streak_min = (t - idle_streak_start).total_seconds() / 60
            if streak_min >= IDLE_STREAK_MIN_FOR_ZERO and cli > 0.02:
                flags.append(("ERROR", f"{t.astimezone(IST):%m-%d %H:%M}: idle for {streak_min:.0f} min but CLI is still {cli:.3f}; decay is not running (old scorer still deployed?)"))
        else:
            idle_streak_start = None

        if prev is not None:
            gap_min = (t - parse_ts(prev["created_at"])).total_seconds() / 60
            step = abs(cli - float(prev.get("cli_score") or 0))
            if gap_min < 360 and step > 0.02 * gap_min + 0.01:
                flags.append(("WARN", f"CLI moved {step:.3f} in {gap_min:.1f} min at {t.astimezone(IST):%m-%d %H:%M} (limit is 2%/min up, 1%/min down)"))
        h = t.astimezone(IST).hour
        if late and 7 <= h <= 20:
            flags.append(("WARN", f"late_night=1 at {h:02d}:xx IST ({t.astimezone(IST):%m-%d}); the sender may compute it in UTC"))
        prev = r

    print()
    n = len(rows)

    # --- data-quality flags ---
    if nulls:
        flags.append(("ERROR", f"NULL values in columns: {dict(nulls)}"))

    for k, c in clipped.items():
        flags.append(("WARN", f"{k}: {c}/{n} rows exceed the training max ({bounds[k][1]:.2f}) and are clipped at 1.0"))

    typing_rows = [v for v in vals_list if v["typing_mean"] > 0]
    recent = vals_list[-20:]
    recent_typing = [v for v in recent if v["typing_mean"] > 0]
    if len(recent_typing) >= 5 and all(v["task_switching"] == 0 for v in recent):
        flags.append(("ERROR", f"task_switching is 0 in all of the last {len(recent)} rows although typing was recorded in {len(recent_typing)} of them: the window-switch tracker is not working (check the desktop agent)"))
    nz_var = [v for v in vals_list if v["typing_variance"] > 0]
    two_sample = [v for v in nz_var if abs(2 * (v["typing_variance"] ** 0.5) - round(2 * (v["typing_variance"] ** 0.5))) < 1e-6]
    if len(nz_var) >= 5 and len(two_sample) >= 0.8 * len(nz_var):
        flags.append(("WARN", f"typing_variance looks like the variance of only TWO samples per window in {len(two_sample)}/{len(nz_var)} rows (2*sqrt(var) is a whole number every time). It is not a usable variance: the agent needs ~5+ sub-intervals per window"))
    zero_run, best = 0, 0
    for v in vals_list:
        zero_run = zero_run + 1 if v["typing_mean"] == 0 else 0
        best = max(best, zero_run)
    if best >= 10:
        flags.append(("INFO", f"{best} consecutive rows with typing_mean 0: either genuinely idle or the keystroke hook stopped"))

    gaps = [(b - a).total_seconds() for a, b in zip(times, times[1:])]
    dup = 0
    for i in range(1, n):
        a, b = vals_list[i - 1], vals_list[i]
        if gaps[i - 1] <= 90 and all(abs(a[k] - b[k]) < 1e-6 for k in FEATURES + ["late_night"]):
            dup += 1
    if dup:
        flags.append(("WARN", f"{dup} identical rows were stored within 90 s of each other (client retry / double connect). The new backend drops these at insert; older rows still contain them"))
    if gaps:
        print(f"Spacing between sessions: median {statistics.median(gaps)/60:.1f} min, "
              f"min {min(gaps):.0f} s, max {max(gaps)/3600:.1f} h")
    src = Counter(str(r.get("device_source") or "NULL") for r in rows)
    print(f"device_source counts: {dict(src)}")
    if "NULL" in src:
        flags.append(("WARN", "Some rows have device_source NULL. Run the SQL migration that adds the column"))
    idle_n = sum(idle_flags)
    print(f"Idle rows (no typing / variance / switching): {idle_n}/{n}")
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
