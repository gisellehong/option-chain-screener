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

SCHEDULE = [
    {"session": "pre_market", "key": "pre_market", "time": clock_time(9, 0)},
    {"session": "open_30m", "key": "open_30m", "time": clock_time(10, 0)},
    {"session": "hourly", "key": "hourly_1030", "time": clock_time(10, 30)},
    {"session": "hourly", "key": "hourly_1130", "time": clock_time(11, 30)},
    {"session": "hourly", "key": "hourly_1230", "time": clock_time(12, 30)},
    {"session": "hourly", "key": "hourly_1330", "time": clock_time(13, 30)},
    {"session": "hourly", "key": "hourly_1430", "time": clock_time(14, 30)},
    {"session": "pre_close", "key": "pre_close", "time": clock_time(15, 45)},
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a scheduled snapshot only when a market session is due.")
    parser.add_argument("--grace-minutes", type=int, default=10, help="Run if the target time was reached within this window.")
    parser.add_argument("--force-session", choices=["pre_market", "open_30m", "hourly", "pre_close"])
    parser.add_argument("--force-key", help="Optional unique key when forcing an hourly session.")
    parser.add_argument("--no-telegram", action="store_true")
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


def run_snapshot(session: str, send_telegram: bool, top: int) -> int:
    cmd = [sys.executable, "scripts/run-scheduled-snapshot.py", "--session", session, "--top", str(top)]
    if send_telegram:
        cmd.append("--send-telegram")
    print("Running:", " ".join(cmd))
    completed = subprocess.run(cmd, cwd=ROOT, check=False)
    return completed.returncode


def main() -> int:
    args = parse_args()
    now_ny = datetime.now(NY_TZ)
    job = (
        {"session": args.force_session, "key": args.force_key or args.force_session}
        if args.force_session
        else due_job(now_ny, args.grace_minutes)
    )
    if not job:
        print(f"No due snapshot at {now_ny.isoformat(timespec='seconds')}")
        return 0

    run_key = f"{now_ny.date().isoformat()}:{job['key']}"
    state = read_state()
    if state.get(run_key) == "completed" and not args.force_session:
        print(f"Already completed {run_key}")
        return 0

    if not acquire_lock():
        return 0

    try:
        state[run_key] = "started"
        write_state(state)
        exit_code = run_snapshot(job["session"], not args.no_telegram, args.top)
        state[run_key] = "completed" if exit_code == 0 else f"failed:{exit_code}"
        write_state(state)
        return exit_code
    finally:
        release_lock()


if __name__ == "__main__":
    sys.exit(main())
