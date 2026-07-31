#!/usr/bin/env python3
"""Refresh GEX data and optionally send a compact Telegram update."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
GEX_PATH = ROOT / "src/data/generated/gex.json"
GENERATED_DIR = ROOT / "src/data/generated"
NY_TZ = ZoneInfo("America/New_York")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh InsiderFinance GEX and send Telegram update.")
    parser.add_argument("ticker", nargs="?", default=os.getenv("GEX_TICKER", "SPX"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--send-telegram", action="store_true")
    parser.add_argument("--quiet-no-change", action="store_true", help="Do not send if source timestamp did not change.")
    return parser.parse_args()


def output_path_for_ticker(ticker: str, explicit_output: Path | None) -> Path:
    if explicit_output:
        return explicit_output
    normalized = ticker.upper()
    if normalized == "SPX":
        return GEX_PATH
    return GENERATED_DIR / f"gex-{normalized}.json"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def run_fetch(ticker: str, output: Path) -> dict[str, Any]:
    cmd = [sys.executable, "scripts/fetch-gex-data.py", ticker, "--output", str(output)]
    completed = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, check=False)
    return {
        "exitCode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "command": " ".join(cmd),
    }


def number(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if numeric == numeric else None


def fmt_money(value: Any) -> str:
    numeric = number(value)
    if numeric is None:
        return "n/a"
    sign = "-" if numeric < 0 else ""
    absolute = abs(numeric)
    if absolute >= 1_000_000_000:
        return f"{sign}${absolute / 1_000_000_000:.2f}B"
    if absolute >= 1_000_000:
        return f"{sign}${absolute / 1_000_000:.1f}M"
    return f"{sign}${absolute:,.2f}"


def fmt_level(value: Any) -> str:
    numeric = number(value)
    return f"{numeric:,.2f}" if numeric is not None else "n/a"


def fmt_delta(current: Any, previous: Any, money: bool = False) -> str:
    current_number = number(current)
    previous_number = number(previous)
    if current_number is None or previous_number is None:
        return ""
    delta = current_number - previous_number
    if abs(delta) < 0.005:
        return " (flat)"
    sign = "+" if delta > 0 else ""
    if money:
        return f" ({sign}{fmt_money(delta)})"
    return f" ({sign}{delta:,.2f})"


def fmt_pct(value: Any) -> str:
    numeric = number(value)
    return f"{numeric:+.2f}%" if numeric is not None else "n/a"


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def session_label(now_ny: datetime) -> str:
    minutes = now_ny.hour * 60 + now_ny.minute
    if now_ny.weekday() == 5 or (now_ny.weekday() == 6 and minutes < 20 * 60 + 15) or (now_ny.weekday() == 4 and minutes >= 17 * 60):
        return "Closed / Weekend"
    if now_ny.weekday() < 5 and 4 * 60 <= minutes < 9 * 60 + 30:
        return "Pre-market / Extended Hours"
    if now_ny.weekday() < 5 and 9 * 60 + 30 <= minutes < 16 * 60:
        return "RTH / Regular Trading Hours"
    if now_ny.weekday() < 5 and 16 * 60 <= minutes < 20 * 60:
        return "After-hours / Extended Hours"
    return "GTH / Overnight"


def build_report(current: dict[str, Any], previous: dict[str, Any] | None, fetched_at: str) -> str:
    summary = current.get("summary", {})
    previous_summary = previous.get("summary", {}) if previous else {}
    ticker = current.get("ticker", "SPX")
    source_time = parse_time(current.get("sourceTimestamp"))
    local_time = parse_time(fetched_at) or datetime.now().astimezone()
    now_ny = local_time.astimezone(NY_TZ)
    source_text = source_time.astimezone(NY_TZ).strftime("%Y-%m-%d %H:%M %Z") if source_time else "n/a"
    regime = str(summary.get("regime", "unknown")).replace("_", " ")

    lines = [
        f"*{ticker} GEX Update*",
        f"{session_label(now_ny)} | {local_time.strftime('%Y-%m-%d %H:%M %Z')} / {now_ny.strftime('%H:%M %Z')}",
        f"Source: {source_text} | Regime: {regime}",
        "",
        f"Spot: {fmt_level(current.get('spot'))}{fmt_delta(current.get('spot'), previous.get('spot') if previous else None)}",
        f"Net GEX: {fmt_money(summary.get('netGex'))}{fmt_delta(summary.get('netGex'), previous_summary.get('netGex'), money=True)}",
        f"Call / Put GEX: {fmt_money(summary.get('callGex'))} / {fmt_money(summary.get('putGex'))}",
        f"Zero Gamma: {fmt_level(summary.get('zeroGamma'))} ({fmt_pct(summary.get('zeroGammaDistancePct'))})",
        f"Call Wall: {fmt_level(summary.get('callWall'))} ({fmt_pct(summary.get('callWallDistancePct'))})",
        f"Put Wall: {fmt_level(summary.get('putWall'))} ({fmt_pct(summary.get('putWallDistancePct'))})",
        f"Peak GEX / Max Pain: {fmt_level(summary.get('peakGexStrike'))} / {fmt_level(summary.get('maxPain'))}",
    ]
    return "\n".join(lines) + "\n"


def send_telegram(message: str) -> dict[str, Any]:
    token = os.getenv("GEX_TELEGRAM_BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("GEX_TELEGRAM_CHAT_ID") or os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return {"enabled": True, "sent": False, "error": "Missing GEX_TELEGRAM_* or TELEGRAM_* settings."}

    payload = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown",
        "disable_web_page_preview": "true",
    }).encode("utf-8")
    request = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8")
        return {"enabled": True, "sent": True, "error": None, "response": body}
    except Exception as exc:  # noqa: BLE001
        return {"enabled": True, "sent": False, "error": str(exc)}


def main() -> int:
    load_env(ROOT / ".env")
    args = parse_args()
    ticker = args.ticker.upper()
    output = output_path_for_ticker(ticker, args.output)
    previous = read_json(output)
    fetch_result = run_fetch(ticker, output)
    if fetch_result["exitCode"] != 0:
        print(fetch_result["stderr"], file=sys.stderr)
        return int(fetch_result["exitCode"])

    current = read_json(output)
    if not current:
        print(f"No usable GEX output at {output}", file=sys.stderr)
        return 1

    if args.quiet_no_change and previous and previous.get("sourceTimestamp") == current.get("sourceTimestamp"):
        print(json.dumps({"sent": False, "reason": "sourceTimestamp unchanged", "fetch": fetch_result}, indent=2))
        return 0

    fetched_at = str(current.get("fetchedAt") or datetime.now().astimezone().isoformat(timespec="seconds"))
    report = build_report(current, previous, fetched_at)
    telegram = send_telegram(report) if args.send_telegram else {"enabled": False, "sent": False, "error": None}
    print(json.dumps({"ticker": current.get("ticker"), "sourceTimestamp": current.get("sourceTimestamp"), "telegram": telegram}, indent=2))
    print("\n" + report)
    return 0 if not telegram.get("error") else 1


if __name__ == "__main__":
    sys.exit(main())
