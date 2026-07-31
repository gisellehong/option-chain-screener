#!/usr/bin/env python3
"""Run the due option snapshot for the current New York market session."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, time as clock_time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = ROOT / "data/scheduler"
STATE_PATH = STATE_DIR / "state.json"
LOCK_PATH = STATE_DIR / "snapshot.lock"
NY_TZ = ZoneInfo("America/New_York")
GEX_RTH_INTERVAL_MINUTES = 30
GEX_GTH_INTERVAL_MINUTES = 60
SOXL_GEX_SCHEDULE = [
    {"session": "pre_market", "key": "soxl_gex_pre_market_0900", "time": clock_time(9, 0)},
    {"session": "rth", "key": "soxl_gex_rth_0930", "time": clock_time(9, 30)},
    {"session": "rth", "key": "soxl_gex_rth_1000", "time": clock_time(10, 0)},
    {"session": "rth", "key": "soxl_gex_rth_1030", "time": clock_time(10, 30)},
    {"session": "rth", "key": "soxl_gex_rth_1100", "time": clock_time(11, 0)},
    {"session": "rth", "key": "soxl_gex_rth_1130", "time": clock_time(11, 30)},
    {"session": "rth", "key": "soxl_gex_rth_1200", "time": clock_time(12, 0)},
    {"session": "rth", "key": "soxl_gex_rth_1230", "time": clock_time(12, 30)},
    {"session": "rth", "key": "soxl_gex_rth_1300", "time": clock_time(13, 0)},
    {"session": "rth", "key": "soxl_gex_rth_1330", "time": clock_time(13, 30)},
    {"session": "rth", "key": "soxl_gex_rth_1400", "time": clock_time(14, 0)},
    {"session": "rth", "key": "soxl_gex_rth_1430", "time": clock_time(14, 30)},
    {"session": "rth", "key": "soxl_gex_rth_1500", "time": clock_time(15, 0)},
    {"session": "rth", "key": "soxl_gex_rth_1530", "time": clock_time(15, 30)},
    {"session": "close", "key": "soxl_gex_close_1600", "time": clock_time(16, 0)},
]

SCHEDULE = [
    {"session": "pre_market", "key": "pre_market", "time": clock_time(9, 0)},
    {"session": "half_hourly", "key": "half_hourly_0930", "time": clock_time(9, 30)},
    {"session": "half_hourly", "key": "half_hourly_1000", "time": clock_time(10, 0)},
    {"session": "half_hourly", "key": "half_hourly_1030", "time": clock_time(10, 30)},
    {"session": "half_hourly", "key": "half_hourly_1100", "time": clock_time(11, 0)},
    {"session": "half_hourly", "key": "half_hourly_1130", "time": clock_time(11, 30)},
    {"session": "half_hourly", "key": "half_hourly_1200", "time": clock_time(12, 0)},
    {"session": "half_hourly", "key": "half_hourly_1230", "time": clock_time(12, 30)},
    {"session": "half_hourly", "key": "half_hourly_1300", "time": clock_time(13, 0)},
    {"session": "half_hourly", "key": "half_hourly_1330", "time": clock_time(13, 30)},
    {"session": "half_hourly", "key": "half_hourly_1400", "time": clock_time(14, 0)},
    {"session": "half_hourly", "key": "half_hourly_1430", "time": clock_time(14, 30)},
    {"session": "half_hourly", "key": "half_hourly_1500", "time": clock_time(15, 0)},
    {"session": "pre_close", "key": "pre_close_1530", "time": clock_time(15, 30)},
    {"session": "close", "key": "close_1600", "time": clock_time(16, 0)},
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a scheduled snapshot only when a market session is due.")
    parser.add_argument("--grace-minutes", type=int, default=10, help="Run if the target time was reached within this window.")
    parser.add_argument("--force-session", choices=["pre_market", "open_30m", "hourly", "half_hourly", "pre_close", "close"])
    parser.add_argument("--force-key", help="Optional unique key when forcing a repeated session.")
    parser.add_argument("--no-telegram", action="store_true")
    parser.add_argument("--no-gex", action="store_true")
    parser.add_argument("--top", type=int, default=3)
    return parser.parse_args()


def read_state() -> dict[str, str]:
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_state(state: dict[str, str]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def acquire_lock() -> bool:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if LOCK_PATH.exists():
        age_seconds = time.time() - LOCK_PATH.stat().st_mtime
        if age_seconds < 7200:
            print(f"Another snapshot appears to be running: {LOCK_PATH}")
            return False
        LOCK_PATH.unlink()
    try:
        fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(f"{os.getpid()}\n")
    return True


def release_lock() -> None:
    try:
        LOCK_PATH.unlink()
    except FileNotFoundError:
        pass


def due_job(now_ny: datetime, grace_minutes: int) -> dict[str, str] | None:
    if now_ny.weekday() >= 5:
        return None

    minutes_now = now_ny.hour * 60 + now_ny.minute
    for item in SCHEDULE:
        target = item["time"]
        minutes_target = target.hour * 60 + target.minute
        if 0 <= minutes_now - minutes_target < grace_minutes:
            return {"session": item["session"], "key": item["key"]}
    return None


def is_spx_week_open(now_ny: datetime) -> bool:
    minutes = now_ny.hour * 60 + now_ny.minute
    if now_ny.weekday() == 6:
        return minutes >= 20 * 60 + 15
    if now_ny.weekday() in {0, 1, 2, 3}:
        return True
    if now_ny.weekday() == 4:
        return minutes < 17 * 60
    return False


def due_gex_job(now_ny: datetime, grace_minutes: int) -> dict[str, str] | None:
    if not is_spx_week_open(now_ny):
        return None
    minutes = now_ny.hour * 60 + now_ny.minute
    is_rth = now_ny.weekday() < 5 and 9 * 60 + 30 <= minutes < 16 * 60
    sunday_open = 20 * 60 + 15
    if now_ny.weekday() == 6 and 0 <= minutes - sunday_open < grace_minutes:
        return {"ticker": "SPX", "session": "gth", "key": "spx_gex_gth_2015"}
    interval = GEX_RTH_INTERVAL_MINUTES if is_rth else GEX_GTH_INTERVAL_MINUTES
    if minutes % interval >= grace_minutes:
        return None
    session = "rth" if is_rth else "gth"
    return {"ticker": "SPX", "session": session, "key": f"spx_gex_{session}_{now_ny.hour:02d}{(minutes // interval) * interval % 60:02d}"}


def due_soxl_gex_job(now_ny: datetime, grace_minutes: int) -> dict[str, str] | None:
    if now_ny.weekday() >= 5:
        return None
    minutes_now = now_ny.hour * 60 + now_ny.minute
    for item in SOXL_GEX_SCHEDULE:
        target = item["time"]
        minutes_target = target.hour * 60 + target.minute
        if 0 <= minutes_now - minutes_target < grace_minutes:
            return {"ticker": "SOXL", "session": item["session"], "key": item["key"]}
    return None


def run_snapshot(session: str, send_telegram: bool, top: int) -> int:
    cmd = [sys.executable, "scripts/run-scheduled-snapshot.py", "--session", session, "--top", str(top)]
    if send_telegram:
        cmd.append("--send-telegram")
    print("Running:", " ".join(cmd))
    completed = subprocess.run(cmd, cwd=ROOT, check=False)
    return completed.returncode


def run_gex_update(ticker: str, send_telegram: bool) -> int:
    cmd = [sys.executable, "scripts/run-gex-update.py", ticker]
    if send_telegram:
        cmd.append("--send-telegram")
    print("Running:", " ".join(cmd))
    completed = subprocess.run(cmd, cwd=ROOT, check=False)
    return completed.returncode


def main() -> int:
    args = parse_args()
    now_ny = datetime.now(NY_TZ)
    snapshot_job = (
        {"session": args.force_session, "key": args.force_key or args.force_session}
        if args.force_session
        else due_job(now_ny, args.grace_minutes)
    )
    gex_jobs = [] if args.no_gex or args.force_session else [
        job for job in (due_gex_job(now_ny, args.grace_minutes), due_soxl_gex_job(now_ny, args.grace_minutes)) if job
    ]
    if not snapshot_job and not gex_jobs:
        print(f"No due snapshot or GEX update at {now_ny.isoformat(timespec='seconds')}")
        return 0

    state = read_state()
    jobs: list[dict[str, str]] = []
    if snapshot_job:
        jobs.append({"type": "snapshot", **snapshot_job})
    for gex_job in gex_jobs:
        jobs.append({"type": "gex", **gex_job})

    pending = []
    for job in jobs:
        run_key = f"{now_ny.date().isoformat()}:{job['key']}"
        if state.get(run_key) == "completed" and not args.force_session:
            print(f"Already completed {run_key}")
            continue
        pending.append({**job, "run_key": run_key})

    if not pending:
        return 0

    if not acquire_lock():
        return 0

    try:
        final_exit_code = 0
        for job in pending:
            state[job["run_key"]] = "started"
            write_state(state)
            if job["type"] == "snapshot":
                exit_code = run_snapshot(job["session"], not args.no_telegram, args.top)
            else:
                exit_code = run_gex_update(job["ticker"], not args.no_telegram)
            state[job["run_key"]] = "completed" if exit_code == 0 else f"failed:{exit_code}"
            write_state(state)
            if exit_code != 0:
                final_exit_code = exit_code
        return final_exit_code
    finally:
        release_lock()


if __name__ == "__main__":
    sys.exit(main())
