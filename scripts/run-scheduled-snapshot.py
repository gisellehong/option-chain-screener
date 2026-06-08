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
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_PATH = ROOT / "config/watchlists.json"
REAL_OPTIONS_PATH = ROOT / "src/data/generated/realOptions.json"
META_PATH = ROOT / "src/data/generated/realOptions.meta.json"
TRACKING_PATH = ROOT / "src/data/generated/tracking.json"
SNAPSHOT_ROOT = ROOT / "data/snapshots"
REPORT_ROOT = ROOT / "data/reports"
NY_TZ = ZoneInfo("America/New_York")
TRACKING_SCHEMA_VERSION = 1

SESSION_LABELS = {
    "pre_market": "開盤前 / Pre-market",
    "open_30m": "開盤後 30 分鐘 / Open +30m",
    "hourly": "盤中每小時 / Hourly",
    "half_hourly": "盤中每半小時 / Half-hourly",
    "pre_close": "收盤前 / Pre-close",
    "manual": "手動測試 / Manual",
}

SCREENER_CONFIGS = {
    "leaps": {
        "title": "LEAPS Call - 深度 ITM 替代正股",
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
        "title": "Weekly CSP - 高 IV 現金擔保 Put",
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
    parser.add_argument("--publish", action="store_true", help="Commit and push generated data after a successful fetch.")
    parser.add_argument("--no-publish", action="store_true", help="Disable AUTO_PUBLISH_GITHUB for this run.")
    parser.add_argument("--top", type=int, default=3, help="Number of candidates per strategy in the report.")
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


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


def days_between(start: str, end: str) -> float:
    return (parse_time(end) - parse_time(start)).total_seconds() / 86400


def tracking_seed() -> dict[str, Any]:
    return {
        "schemaVersion": TRACKING_SCHEMA_VERSION,
        "generatedAt": None,
        "summary": {},
        "signals": [],
    }


def signal_key(signal: dict[str, Any]) -> str:
    return "|".join(
        [
            str(signal.get("signalAt")),
            str(signal.get("session")),
            str(signal.get("strategy")),
            str(signal.get("scenario")),
            str(signal.get("contractId")),
        ]
    )


def compact_signal(
    row: dict[str, Any],
    strategy: str,
    session: str,
    generated_at: str,
    rank: int,
    scenario: str = "best",
) -> dict[str, Any]:
    mid = number(row.get("mid"))
    signal = {
        "id": f"{generated_at}|{strategy}|{scenario}|{rank}|{row.get('id')}",
        "signalAt": generated_at,
        "session": session,
        "strategy": strategy,
        "scenario": scenario,
        "rank": rank,
        "score": round(number(row.get("score")), 2),
        "contractId": row.get("id"),
        "ticker": row.get("ticker"),
        "companyName": row.get("companyName"),
        "optionType": row.get("optionType"),
        "expiration": row.get("expiration"),
        "dte": number(row.get("dte")),
        "strike": number(row.get("strike")),
        "entry": {
            "mid": mid,
            "bid": number(row.get("bid")),
            "ask": number(row.get("ask")),
            "underlyingPrice": number(row.get("underlyingPrice")),
            "iv": number(row.get("iv")),
            "delta": number(row.get("delta")),
            "spread": number(row.get("spread")),
            "spreadPct": number(row.get("spreadPct")),
        },
        "latest": None,
        "outcome": {},
        "observations": {
            "count": 0,
            "firstObservedAt": None,
            "lastObservedAt": None,
        },
    }
    if strategy == "weekly_csp":
        signal["outcome"] = {
            "status": "open",
            "targetProfitPct": 80,
            "targetAsk": round(mid * 0.2, 4) if mid > 0 else None,
            "hit80At": None,
            "daysTo80": None,
            "hit80Within5D": False,
            "bestProfitCapturePct": None,
            "bestProfitCaptureAt": None,
            "wentItm": False,
            "lowestUnderlying": number(row.get("underlyingPrice")),
            "expired": False,
        }
    else:
        signal["outcome"] = {
            "status": "tracking",
            "optionReturnPct": 0,
            "underlyingReturnPct": 0,
            "relativeReturnPct": 0,
            "realizedLeverage": None,
            "deltaChange": 0,
            "ivChange": 0,
        }
    return signal


def latest_quote(row: dict[str, Any]) -> dict[str, Any]:
    derived = derive(row)
    return {
        "mid": derived["mid"],
        "bid": number(row.get("bid")),
        "ask": number(row.get("ask")),
        "underlyingPrice": number(row.get("underlyingPrice")),
        "iv": number(row.get("iv")),
        "delta": number(row.get("delta")),
        "spread": derived["spread"],
        "spreadPct": derived["spreadPct"],
    }


def update_signal_outcome(signal: dict[str, Any], quote: dict[str, Any], generated_at: str) -> None:
    signal["latest"] = {
        **quote,
        "observedAt": generated_at,
    }
    observations = signal.setdefault("observations", {})
    observations["count"] = int(observations.get("count") or 0) + 1
    observations["firstObservedAt"] = observations.get("firstObservedAt") or generated_at
    observations["lastObservedAt"] = generated_at

    entry = signal.get("entry", {})
    outcome = signal.setdefault("outcome", {})
    if signal.get("strategy") == "weekly_csp":
        entry_credit = number(entry.get("mid"))
        current_ask = number(quote.get("ask"))
        current_underlying = number(quote.get("underlyingPrice"))
        strike = number(signal.get("strike"))
        profit_capture = ((entry_credit - current_ask) / entry_credit) * 100 if entry_credit > 0 else 0
        previous_best = outcome.get("bestProfitCapturePct")
        if previous_best is None or profit_capture > number(previous_best):
            outcome["bestProfitCapturePct"] = round(profit_capture, 2)
            outcome["bestProfitCaptureAt"] = generated_at
        if current_underlying > 0:
            lowest = outcome.get("lowestUnderlying")
            outcome["lowestUnderlying"] = current_underlying if lowest is None else min(number(lowest), current_underlying)
            if current_underlying < strike:
                outcome["wentItm"] = True
        if entry_credit > 0 and current_ask <= entry_credit * 0.2 and not outcome.get("hit80At"):
            outcome["hit80At"] = generated_at
            outcome["daysTo80"] = round(days_between(str(signal.get("signalAt")), generated_at), 2)
            outcome["hit80Within5D"] = outcome["daysTo80"] <= 5
            outcome["status"] = "hit_80"
        if generated_at[:10] > str(signal.get("expiration")):
            outcome["expired"] = True
            if not outcome.get("hit80At"):
                outcome["status"] = "expired_no_80"
        elif not outcome.get("hit80At"):
            outcome["status"] = "open"
        return

    entry_mid = number(entry.get("mid"))
    entry_underlying = number(entry.get("underlyingPrice"))
    option_return = ((number(quote.get("mid")) - entry_mid) / entry_mid) * 100 if entry_mid > 0 else 0
    underlying_return = (
        ((number(quote.get("underlyingPrice")) - entry_underlying) / entry_underlying) * 100
        if entry_underlying > 0
        else 0
    )
    outcome["optionReturnPct"] = round(option_return, 2)
    outcome["underlyingReturnPct"] = round(underlying_return, 2)
    outcome["relativeReturnPct"] = round(option_return - underlying_return, 2)
    outcome["realizedLeverage"] = round(option_return / underlying_return, 2) if underlying_return else None
    outcome["deltaChange"] = round(number(quote.get("delta")) - number(entry.get("delta")), 4)
    outcome["ivChange"] = round(number(quote.get("iv")) - number(entry.get("iv")), 2)


def summarize_tracking(signals: list[dict[str, Any]]) -> dict[str, Any]:
    weekly = [item for item in signals if item.get("strategy") == "weekly_csp"]
    leaps = [item for item in signals if item.get("strategy") == "leaps"]
    closed_weekly = [item for item in weekly if item.get("outcome", {}).get("hit80At") or item.get("outcome", {}).get("expired")]
    hit_weekly = [item for item in weekly if item.get("outcome", {}).get("hit80At")]
    hit_within_5d = [item for item in weekly if item.get("outcome", {}).get("hit80Within5D")]
    leaps_with_latest = [item for item in leaps if item.get("latest")]
    avg_days_to_80 = (
        sum(number(item.get("outcome", {}).get("daysTo80")) for item in hit_weekly) / len(hit_weekly)
        if hit_weekly
        else None
    )
    avg_leaps_return = (
        sum(number(item.get("outcome", {}).get("optionReturnPct")) for item in leaps_with_latest) / len(leaps_with_latest)
        if leaps_with_latest
        else None
    )
    avg_leaps_relative = (
        sum(number(item.get("outcome", {}).get("relativeReturnPct")) for item in leaps_with_latest) / len(leaps_with_latest)
        if leaps_with_latest
        else None
    )
    return {
        "totalSignals": len(signals),
        "weeklyCspSignals": len(weekly),
        "weeklyCspOpen": len([item for item in weekly if item.get("outcome", {}).get("status") == "open"]),
        "weeklyCspHit80": len(hit_weekly),
        "weeklyCspHit80Within5D": len(hit_within_5d),
        "weeklyCspHitRate": round((len(hit_weekly) / len(closed_weekly)) * 100, 2) if closed_weekly else None,
        "weeklyCspHitWithin5DRate": round((len(hit_within_5d) / len(weekly)) * 100, 2) if weekly else None,
        "weeklyCspAvgDaysTo80": round(avg_days_to_80, 2) if avg_days_to_80 is not None else None,
        "leapsSignals": len(leaps),
        "leapsTracked": len(leaps_with_latest),
        "leapsAvgOptionReturnPct": round(avg_leaps_return, 2) if avg_leaps_return is not None else None,
        "leapsAvgRelativeReturnPct": round(avg_leaps_relative, 2) if avg_leaps_relative is not None else None,
    }


def update_tracking(
    generated_at: str,
    session: str,
    watchlists: dict[str, list[str]],
    candidates: list[dict[str, Any]],
    top: int,
) -> dict[str, Any]:
    tracking = read_json(TRACKING_PATH, tracking_seed())
    if not isinstance(tracking, dict) or tracking.get("schemaVersion") != TRACKING_SCHEMA_VERSION:
        tracking = tracking_seed()
    signals = list(tracking.get("signals", []))
    by_key = {signal_key(signal): signal for signal in signals}
    rows_by_id = {str(row.get("id")): row for row in candidates if row.get("id")}

    for signal in signals:
        row = rows_by_id.get(str(signal.get("contractId")))
        if row:
            update_signal_outcome(signal, latest_quote(row), generated_at)
        elif signal.get("strategy") == "weekly_csp" and generated_at[:10] > str(signal.get("expiration")):
            outcome = signal.setdefault("outcome", {})
            outcome["expired"] = True
            if not outcome.get("hit80At"):
                outcome["status"] = "expired_no_80"

    ranked_by_strategy = {
        "leaps": scored_candidates(candidates, "leaps", watchlists["leaps"]),
        "weekly_csp": scored_candidates(candidates, "weekly_csp", watchlists["weekly_csp"]),
    }
    for strategy, rows in ranked_by_strategy.items():
        for rank, row in enumerate(rows[:top], start=1):
            signal = compact_signal(row, strategy, session, generated_at, rank)
            key = signal_key(signal)
            if key not in by_key:
                update_signal_outcome(signal, latest_quote(row), generated_at)
                signals.append(signal)
                by_key[key] = signal

    tracking = {
        "schemaVersion": TRACKING_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "summary": summarize_tracking(signals),
        "signals": sorted(signals, key=lambda item: str(item.get("signalAt")), reverse=True),
    }
    TRACKING_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRACKING_PATH.write_text(json.dumps(tracking, indent=2) + "\n", encoding="utf-8")
    return tracking


def fmt_money(value: Any) -> str:
    return f"${number(value):,.2f}"


def fmt_pct(value: Any, digits: int = 1) -> str:
    return f"{number(value):.{digits}f}%"


def fmt_compact(value: Any) -> str:
    numeric = number(value)
    if abs(numeric) >= 1_000_000:
        return f"{numeric / 1_000_000:.1f}M"
    if abs(numeric) >= 1_000:
        return f"{numeric / 1_000:.1f}K"
    return f"{numeric:.0f}"


def fmt_time(iso_value: str) -> str:
    parsed = datetime.fromisoformat(iso_value)
    local_text = parsed.strftime("%Y-%m-%d %H:%M %Z")
    ny_text = parsed.astimezone(NY_TZ).strftime("%H:%M %Z")
    return f"{local_text} / {ny_text}"


def score_label(score: Any) -> str:
    value = number(score)
    if value >= 78:
        return "強 / Strong"
    if value >= 62:
        return "觀察 / Watch"
    return "弱 / Weak"


def warning_text(warnings: list[str]) -> str:
    if not warnings:
        return "無明顯警告"
    labels = {
        "wide spread": "價差偏寬",
        "thin OI": "OI 偏薄",
        "IV proxy": "IV proxy",
    }
    return "、".join(labels.get(item, item) for item in warnings)


def short_warning_text(warnings: list[str]) -> str:
    actionable = [item for item in warnings if item != "IV proxy"]
    if not actionable:
        return ""
    return f" | {warning_text(actionable)}"


def contract_line(row: dict[str, Any]) -> str:
    return (
        f"{row['ticker']} {row['expiration']} {str(row['optionType']).upper()} "
        f"{fmt_money(row['strike'])}"
    )


def quote_line(row: dict[str, Any]) -> str:
    return (
        f"Mid {fmt_money(row['mid'])} | Bid/Ask {fmt_money(row['bid'])}/{fmt_money(row['ask'])} | "
        f"Spread {fmt_money(row['spread'])} ({fmt_pct(row['spreadPct'])})"
    )


def risk_line(row: dict[str, Any]) -> str:
    return (
        f"DTE {number(row['dte']):.0f} | Delta {number(row['delta']):.2f} | IV {fmt_pct(row['iv'])} | "
        f"OI {fmt_compact(row['openInterest'])} / Vol {fmt_compact(row['volume'])}"
    )


def leaps_focus_line(row: dict[str, Any]) -> str:
    return (
        f"ITM {fmt_pct(row['percentItm'])} | Intrinsic {fmt_pct(row['intrinsicValuePct'])} | "
        f"Leverage {number(row['leverageRatio']):.1f}x | 警告: {warning_text(row['warnings'])}"
    )


def csp_focus_line(row: dict[str, Any]) -> str:
    return (
        f"Ann ROI {fmt_pct(row['annualizedRoi'], 0)} | OTM {fmt_pct(row['distanceOtmPct'])} | "
        f"Cash Req {fmt_money(row['cashRequired'])} | 警告: {warning_text(row['warnings'])}"
    )


def compact_candidate_line(strategy: str, index: int, row: dict[str, Any]) -> str:
    if strategy == "leaps":
        metrics = (
            f"Score {number(row['score']):.0f}, Delta {number(row['delta']):.2f}, "
            f"IV {fmt_pct(row['iv'])}, Intr {fmt_pct(row['intrinsicValuePct'], 0)}, Mid {fmt_money(row['mid'])}"
        )
    else:
        metrics = (
            f"Score {number(row['score']):.0f}, AnnROI {fmt_pct(row['annualizedRoi'], 0)}, "
            f"OTM {fmt_pct(row['distanceOtmPct'])}, Delta {number(row['delta']):.2f}, Mid {fmt_money(row['mid'])}"
        )
    return f"{index}. {contract_line(row)} - {metrics}{short_warning_text(row['warnings'])}"


def build_report(
    session: str,
    generated_at: str,
    watchlists: dict[str, list[str]],
    candidates: list[dict[str, Any]],
    top: int,
) -> str:
    scored_by_strategy = {
        "leaps": scored_candidates(candidates, "leaps", watchlists["leaps"]),
        "weekly_csp": scored_candidates(candidates, "weekly_csp", watchlists["weekly_csp"]),
    }
    total_matches = sum(len(rows) for rows in scored_by_strategy.values())
    dashboard_url = os.getenv("DASHBOARD_URL", "").strip()
    lines = [
        "*Option Snapshot*",
        f"{SESSION_LABELS[session]} | {fmt_time(generated_at)}",
        f"Matched {total_matches} / Raw {len(candidates)} | Universe {len(watchlists['combined'])}",
    ]
    if dashboard_url:
        lines.append(f"Dashboard: {dashboard_url}")
    lines.append("")

    for strategy in ("leaps", "weekly_csp"):
        rows = scored_by_strategy[strategy]
        lines.append(f"*{SCREENER_CONFIGS[strategy]['title']}*")
        if not rows:
            lines.append("目前沒有符合條件的候選。")
            lines.append("")
            continue
        for index, row in enumerate(rows[:top], start=1):
            lines.append(compact_candidate_line(strategy, index, row))
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
    }).encode("utf-8")
    request = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8")
        return {"enabled": True, "sent": True, "error": None, "response": body}
    except Exception as exc:  # noqa: BLE001
        return {"enabled": True, "sent": False, "error": str(exc)}


def env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def run_git(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=False)


def publish_generated_data(session: str, generated_at: str) -> dict[str, Any]:
    paths = [
        "src/data/generated/realOptions.json",
        "src/data/generated/realOptions.meta.json",
        "src/data/generated/tracking.json",
    ]
    status = run_git(["status", "--porcelain", "--", *paths])
    if status.returncode != 0:
        return {"enabled": True, "published": False, "error": status.stderr.strip(), "commit": None}
    if not status.stdout.strip():
        return {"enabled": True, "published": False, "error": None, "commit": None, "message": "No generated data changes."}

    add = run_git(["add", *paths])
    if add.returncode != 0:
        return {"enabled": True, "published": False, "error": add.stderr.strip(), "commit": None}

    commit_message = f"Update option snapshot: {session} {generated_at}"
    commit = run_git(["commit", "-m", commit_message])
    if commit.returncode != 0:
        return {"enabled": True, "published": False, "error": commit.stderr.strip() or commit.stdout.strip(), "commit": None}

    commit_id = run_git(["rev-parse", "--short", "HEAD"])
    push = run_git(["push", "origin", "HEAD"])
    if push.returncode != 0:
        return {
            "enabled": True,
            "published": False,
            "error": push.stderr.strip() or push.stdout.strip(),
            "commit": commit_id.stdout.strip() if commit_id.returncode == 0 else None,
        }

    return {
        "enabled": True,
        "published": True,
        "error": None,
        "commit": commit_id.stdout.strip() if commit_id.returncode == 0 else None,
        "stdout": push.stdout.strip(),
        "stderr": push.stderr.strip(),
    }


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
            write_outputs(
                args,
                generated_at,
                watchlists,
                [],
                fetch_result,
                "Fetch failed.\n",
                {"enabled": args.send_telegram, "sent": False, "error": None},
            )
            print(fetch_result["stderr"], file=sys.stderr)
            return int(fetch_result["exitCode"])

    candidates = read_json(args.output, [])
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    tracking = update_tracking(generated_at, args.session, watchlists, candidates, args.top)
    report = build_report(args.session, generated_at, watchlists, candidates, args.top)
    telegram = send_telegram(report) if args.send_telegram else {"enabled": False, "sent": False, "error": None}
    should_publish = (args.publish or env_truthy("AUTO_PUBLISH_GITHUB")) and not args.no_publish
    publish = {"enabled": should_publish, "published": False, "error": None, "commit": None}
    metadata = write_outputs(args, generated_at, watchlists, candidates, fetch_result, report, telegram)
    if should_publish and not args.skip_fetch:
        publish = publish_generated_data(args.session, generated_at)

    print(json.dumps({
        "generatedAt": generated_at,
        "session": args.session,
        "candidateCount": len(candidates),
        "trackingSignals": tracking.get("summary", {}).get("totalSignals"),
        "reportPath": metadata["reportPath"],
        "telegram": telegram,
        "publish": publish,
    }, indent=2))
    print("\n" + report)
    return 0 if not telegram.get("error") else 1


if __name__ == "__main__":
    sys.exit(main())
