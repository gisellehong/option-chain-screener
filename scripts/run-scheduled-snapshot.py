#!/usr/bin/env python3
"""Run a scheduled moomoo snapshot and produce a Telegram-ready session report."""

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

ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_PATH = ROOT / "config/watchlists.json"
REAL_OPTIONS_PATH = ROOT / "src/data/generated/realOptions.json"
META_PATH = ROOT / "src/data/generated/realOptions.meta.json"
SNAPSHOT_ROOT = ROOT / "data/snapshots"
REPORT_ROOT = ROOT / "data/reports"

SESSION_LABELS = {
    "pre_market": "Pre-market",
    "open_30m": "Open +30m",
    "hourly": "Hourly",
    "pre_close": "Pre-close",
    "manual": "Manual",
}

SCREENER_CONFIGS = {
    "leaps": {
        "title": "Deep ITM LEAPS Call",
        "option_type": "call",
        "filters": [
            ("dte", "between", 540, 900),
            ("marketCapB", "gte", 10, None),
            ("delta", "between", 0.75, 0.85),
            ("openInterest", "gte", 500, None),
            ("volume", "gte", 10, None),
            ("intrinsicValuePct", "between", 70, 85),
            ("vega", "gte", 0.2, None),
            ("ivPercentile", "lte", None, 40),
            ("percentItm", "gte", 20, None),
            ("potentialRoi", "gte", 0, None),
            ("annualizedRoi", "gte", 0, None),
        ],
    },
    "weekly_csp": {
        "title": "IV Expansion Weekly CSP",
        "option_type": "put",
        "filters": [
            ("lastPrice", "gte", 2.5, None),
            ("delta", "between", -0.12, 0),
            ("dte", "between", 1, 10),
            ("volume", "gte", 200, None),
            ("ivPercentile", "gte", 50, None),
            ("distanceOtmPct", "gte", 0, None),
            ("iv", "gte", 30, None),
            ("spread", "lte", None, 0.5),
            ("potentialRoi", "gte", 0, None),
            ("annualizedRoi", "gte", 0, None),
            ("dayChangePct", "gte", 0, None),
        ],
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run scheduled moomoo snapshot and session report.")
    parser.add_argument("--session", choices=sorted(SESSION_LABELS), default="manual")
    parser.add_argument("--watchlists", type=Path, default=WATCHLIST_PATH)
    parser.add_argument("--output", type=Path, default=REAL_OPTIONS_PATH)
    parser.add_argument("--meta-output", type=Path, default=META_PATH)
    parser.add_argument("--skip-fetch", action="store_true", help="Use the current output JSON instead of calling moomoo.")
    parser.add_argument("--send-telegram", action="store_true", help="Send the generated report to Telegram.")
    parser.add_argument("--top", type=int, default=5, help="Number of candidates per strategy in the report.")
    return parser.parse_args()


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def unique_tickers(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        ticker = value.strip().upper()
        if ticker and ticker not in seen:
            seen.add(ticker)
            result.append(ticker)
    return result


def load_watchlists(path: Path) -> dict[str, list[str]]:
    raw = read_json(path, {})
    leaps = unique_tickers(raw.get("leaps", []))
    weekly = unique_tickers(raw.get("weekly_csp", []))
    return {
        "leaps": leaps,
        "weekly_csp": weekly,
        "combined": unique_tickers(leaps + weekly),
    }


def run_fetch(tickers: list[str], output: Path) -> dict[str, Any]:
    cmd = [sys.executable, "scripts/fetch-moomoo-data.py", "--output", str(output), *tickers]
    completed = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, check=False)
    return {
        "exitCode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "command": " ".join(cmd),
    }


def number(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    if numeric != numeric:
        return 0.0
    return numeric


def derive(candidate: dict[str, Any]) -> dict[str, float]:
    bid = number(candidate.get("bid"))
    ask = number(candidate.get("ask"))
    mid = (bid + ask) / 2
    spread = ask - bid
    spread_pct = (spread / mid) * 100 if mid > 0 else 0
    option_type = candidate.get("optionType")
    underlying = number(candidate.get("underlyingPrice"))
    strike = number(candidate.get("strike"))
    intrinsic = max(underlying - strike, 0) if option_type == "call" else max(strike - underlying, 0)
    extrinsic = max(mid - intrinsic, 0)
    intrinsic_pct = (intrinsic / mid) * 100 if mid > 0 else 0
    distance_otm = ((underlying - strike) / underlying) * 100 if option_type == "put" and underlying else 0
    percent_itm = ((underlying - strike) / underlying) * 100 if option_type == "call" and underlying else 0
    cash_required = strike * 100 if option_type == "put" else mid * 100
    potential_roi = ((mid * 100) / cash_required) * 100 if cash_required > 0 else 0
    dte = number(candidate.get("dte"))
    annualized_roi = potential_roi * (365 / dte) if dte > 0 else 0
    leverage = underlying / mid if mid > 0 else 0
    return {
        "mid": mid,
        "spread": spread,
        "spreadPct": spread_pct,
        "intrinsicValue": intrinsic,
        "extrinsicValue": extrinsic,
        "intrinsicValuePct": intrinsic_pct,
        "distanceOtmPct": distance_otm,
        "percentItm": percent_itm,
        "cashRequired": cash_required,
        "potentialRoi": potential_roi,
        "annualizedRoi": annualized_roi,
        "leverageRatio": leverage,
    }


def clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return min(maximum, max(minimum, value))


def passes(value: float, operator: str, lower: float | None, upper: float | None) -> bool:
    if operator == "between":
        return value >= float(lower) and value <= float(upper)
    if operator == "gte":
        return value >= float(lower)
    return value <= float(upper)


def warnings_for(row: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if number(row.get("spreadPct")) > 12:
        warnings.append("wide spread")
    if number(row.get("openInterest")) < 500:
        warnings.append("thin OI")
    if row.get("ivPercentileSource") == "current_iv_proxy":
        warnings.append("IV proxy")
    return warnings


def score_row(strategy: str, row: dict[str, Any]) -> float:
    if strategy == "leaps":
        delta_fit = 100 - abs(number(row.get("delta")) - 0.8) * 800
        intrinsic_fit = 100 - abs(number(row.get("intrinsicValuePct")) - 78) * 4
        low_iv_proxy = 100 - number(row.get("ivPercentile"))
        tight_spread = 100 - number(row.get("spreadPct")) * 3
        liquidity = clamp(__import__("math").log10(number(row.get("openInterest")) + number(row.get("volume")) + 1) * 18)
        return clamp(delta_fit * 0.24 + intrinsic_fit * 0.26 + low_iv_proxy * 0.22 + tight_spread * 0.14 + liquidity * 0.14)

    high_iv_proxy = clamp(number(row.get("ivPercentile")))
    liquidity = clamp(__import__("math").log10(number(row.get("volume")) + number(row.get("openInterest")) + 1) * 16)
    tight_spread = 100 - number(row.get("spreadPct")) * 3.5
    premium = clamp(number(row.get("annualizedRoi")) / 8)
    otm_buffer = clamp(number(row.get("distanceOtmPct")) * 9)
    dte_fit = 100 - abs(number(row.get("dte")) - 5) * 10
    return clamp(high_iv_proxy * 0.24 + liquidity * 0.2 + tight_spread * 0.18 + premium * 0.18 + otm_buffer * 0.12 + dte_fit * 0.08)


def scored_candidates(candidates: list[dict[str, Any]], strategy: str, allowed_tickers: list[str]) -> list[dict[str, Any]]:
    config = SCREENER_CONFIGS[strategy]
    allowed = set(allowed_tickers)
    scored: list[dict[str, Any]] = []
    for candidate in candidates:
        if candidate.get("ticker") not in allowed or candidate.get("optionType") != config["option_type"]:
            continue
        if number(candidate.get("bid")) <= 0 or number(candidate.get("ask")) <= 0 or number(candidate.get("ask")) < number(candidate.get("bid")):
            continue
        row = {**candidate, **derive(candidate)}
        failed = [
            field
            for field, operator, lower, upper in config["filters"]
            if not passes(number(row.get(field)), operator, lower, upper)
        ]
        row["matched"] = len(failed) == 0
        row["failedFilters"] = failed
        row["score"] = score_row(strategy, row)
        row["warnings"] = warnings_for(row)
        if row["matched"]:
            scored.append(row)
    return sorted(scored, key=lambda item: item["score"], reverse=True)


def fmt_money(value: Any) -> str:
    return f"${number(value):,.2f}"


def fmt_pct(value: Any, digits: int = 1) -> str:
    return f"{number(value):.{digits}f}%"


def build_report(
    session: str,
    generated_at: str,
    watchlists: dict[str, list[str]],
    candidates: list[dict[str, Any]],
    top: int,
) -> str:
    lines = [
        f"*Option Chain Session Report*",
        f"Session: {SESSION_LABELS[session]}",
        f"Generated: {generated_at}",
        f"Universe: {len(watchlists['combined'])} tickers",
        "",
    ]
    for strategy, tickers in (("leaps", watchlists["leaps"]), ("weekly_csp", watchlists["weekly_csp"])):
        rows = scored_candidates(candidates, strategy, tickers)
        lines.append(f"*{SCREENER_CONFIGS[strategy]['title']}*")
        if not rows:
            lines.append("No matched candidates.")
            lines.append("")
            continue
        for index, row in enumerate(rows[:top], start=1):
            warn = f" ({', '.join(row['warnings'])})" if row["warnings"] else ""
            if strategy == "leaps":
                detail = (
                    f"{index}. {row['ticker']} {row['expiration']} CALL {fmt_money(row['strike'])} | "
                    f"score {number(row['score']):.0f} | delta {number(row['delta']):.2f} | "
                    f"IV {fmt_pct(row['iv'])} | mid {fmt_money(row['mid'])}{warn}"
                )
            else:
                detail = (
                    f"{index}. {row['ticker']} {row['expiration']} PUT {fmt_money(row['strike'])} | "
                    f"score {number(row['score']):.0f} | ann ROI {fmt_pct(row['annualizedRoi'], 0)} | "
                    f"OTM {fmt_pct(row['distanceOtmPct'])} | mid {fmt_money(row['mid'])}{warn}"
                )
            lines.append(detail)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def send_telegram(message: str) -> dict[str, Any]:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return {"enabled": True, "sent": False, "error": "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID"}

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


def write_outputs(
    args: argparse.Namespace,
    generated_at: str,
    watchlists: dict[str, list[str]],
    candidates: list[dict[str, Any]],
    fetch_result: dict[str, Any],
    report: str,
    telegram: dict[str, Any],
) -> dict[str, Any]:
    stamp = generated_at.replace(":", "").replace("-", "").replace("+", "_").replace(".", "_")
    date_part = generated_at[:10]
    snapshot_path = SNAPSHOT_ROOT / date_part / f"{args.session}-{stamp}.json"
    report_path = REPORT_ROOT / date_part / f"{args.session}-{stamp}.md"
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    args.meta_output.parent.mkdir(parents=True, exist_ok=True)

    snapshot_payload = {
        "generatedAt": generated_at,
        "session": args.session,
        "watchlists": watchlists,
        "candidateCount": len(candidates),
        "candidates": candidates,
    }
    snapshot_path.write_text(json.dumps(snapshot_payload, indent=2) + "\n", encoding="utf-8")
    report_path.write_text(report, encoding="utf-8")

    metadata = {
        "generatedAt": generated_at,
        "session": args.session,
        "watchlists": watchlists,
        "candidateCount": len(candidates),
        "snapshotPath": str(snapshot_path.relative_to(ROOT)),
        "reportPath": str(report_path.relative_to(ROOT)),
        "telegram": telegram,
        "fetch": fetch_result,
    }
    args.meta_output.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def main() -> int:
    args = parse_args()
    load_env(ROOT / ".env")
    watchlists = load_watchlists(args.watchlists)
    if not watchlists["combined"]:
        print("No tickers configured in watchlist.", file=sys.stderr)
        return 1

    fetch_result = {"exitCode": None, "stdout": "", "stderr": "", "command": None}
    if not args.skip_fetch:
        fetch_result = run_fetch(watchlists["combined"], args.output)
        if fetch_result["exitCode"] != 0:
            generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
            write_outputs(args, generated_at, watchlists, [], fetch_result, "Fetch failed.\n", {"enabled": args.send_telegram, "sent": False, "error": None})
            print(fetch_result["stderr"], file=sys.stderr)
            return int(fetch_result["exitCode"])

    candidates = read_json(args.output, [])
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    report = build_report(args.session, generated_at, watchlists, candidates, args.top)
    telegram = send_telegram(report) if args.send_telegram else {"enabled": False, "sent": False, "error": None}
    metadata = write_outputs(args, generated_at, watchlists, candidates, fetch_result, report, telegram)

    print(json.dumps({
        "generatedAt": generated_at,
        "session": args.session,
        "candidateCount": len(candidates),
        "reportPath": metadata["reportPath"],
        "telegram": telegram,
    }, indent=2))
    print("\n" + report)
    return 0 if not telegram.get("error") else 1


if __name__ == "__main__":
    sys.exit(main())
