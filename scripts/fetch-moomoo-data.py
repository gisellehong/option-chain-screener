#!/usr/bin/env python3
"""Fetch moomoo option data through OpenD and write the app's JSON format.

OpenD must be running and logged in before this script starts. The script writes
the generated JSON file consumed by the dashboard.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import socket
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

DEFAULT_UNIVERSE = ["AAPL", "AMD", "NVDA", "TSLA", "MSFT", "SMH"]
DEFAULT_OUTPUT_PATH = Path("src/data/generated/realOptions.json")
OPTION_CHAIN_DELAY_SECONDS = 3.1
SNAPSHOT_DELAY_SECONDS = 0.55
SNAPSHOT_BATCH_SIZE = 400


try:
    from moomoo import OpenQuoteContext, RET_OK
except ImportError as exc:
    raise SystemExit(
        "Missing moomoo Python SDK. Install it with `python3 -m pip install moomoo` "
        "and make sure OpenD is running before retrying."
    ) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch option candidates from moomoo OpenD.")
    parser.add_argument("tickers", nargs="*", help="Underlying tickers. Plain US tickers are normalized to US.*.")
    parser.add_argument("--host", default=os.getenv("MOOMOO_OPEND_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MOOMOO_OPEND_PORT", "11111")))
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--weekly-min-dte", type=int, default=1)
    parser.add_argument("--weekly-max-dte", type=int, default=10)
    parser.add_argument("--leaps-min-dte", type=int, default=540)
    parser.add_argument("--leaps-max-dte", type=int, default=900)
    parser.add_argument("--max-expirations-per-ticker", type=int, default=24)
    return parser.parse_args()


def normalize_code(ticker: str) -> str:
    trimmed = ticker.strip().upper()
    if trimmed.startswith(("US.", "HK.", "SH.", "SZ.")):
        return trimmed
    return f"US.{trimmed}"


def display_ticker(code: str) -> str:
    return code.split(".", 1)[1] if "." in code else code


def days_to_expiration(expiration: str) -> int:
    expiry = datetime.strptime(expiration, "%Y-%m-%d").date()
    return max(0, (expiry - date.today()).days)


def to_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, str) and value.strip().upper() in {"", "N/A", "NONE", "NAN"}:
        return default
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(numeric) or math.isinf(numeric):
        return default
    return numeric


def to_int(value: Any, default: int = 0) -> int:
    return int(to_float(value, float(default)))


def frame_records(frame: Any) -> list[dict[str, Any]]:
    if frame is None:
        return []
    if hasattr(frame, "to_dict"):
        return list(frame.to_dict("records"))
    if isinstance(frame, list):
        return frame
    return []


def call_or_raise(label: str, func: Any, *args: Any, **kwargs: Any) -> Any:
    ret, data = func(*args, **kwargs)
    if ret != RET_OK:
        raise RuntimeError(f"{label} failed: {data}")
    return data


def ensure_opend_available(host: str, port: int) -> None:
    try:
        with socket.create_connection((host, port), timeout=2):
            return
    except OSError as exc:
        raise RuntimeError(
            f"OpenD is not listening at {host}:{port}. Start and log in to moomoo OpenD, "
            "or pass --host/--port / MOOMOO_OPEND_HOST/MOOMOO_OPEND_PORT for your OpenD settings."
        ) from exc


def chunked(values: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def get_snapshot_map(quote_ctx: OpenQuoteContext, codes: list[str]) -> dict[str, dict[str, Any]]:
    snapshots: dict[str, dict[str, Any]] = {}
    batches = list(chunked(codes, SNAPSHOT_BATCH_SIZE))
    for index, batch in enumerate(batches):
        data = call_or_raise("get_market_snapshot", quote_ctx.get_market_snapshot, batch)
        for row in frame_records(data):
            code = row.get("code")
            if code:
                snapshots[str(code)] = row
        if index < len(batches) - 1:
            time.sleep(SNAPSHOT_DELAY_SECONDS)
    return snapshots


def expiration_dates(
    quote_ctx: OpenQuoteContext,
    code: str,
    min_dte: int,
    max_dte: int,
    max_count: int,
) -> list[str]:
    data = call_or_raise("get_option_expiration_date", quote_ctx.get_option_expiration_date, code=code)
    dates = []
    for row in frame_records(data):
        expiration = str(row.get("strike_time", ""))
        if not expiration:
            continue
        dte = days_to_expiration(expiration)
        if min_dte <= dte <= max_dte:
            dates.append(expiration)
    return dates[:max_count]


def option_type_value(value: Any) -> str | None:
    text = str(value).lower()
    if "call" in text or text in {"1", "optiontype.call"}:
        return "call"
    if "put" in text or text in {"2", "optiontype.put"}:
        return "put"
    return None


def collect_chain_codes(
    quote_ctx: OpenQuoteContext,
    code: str,
    expirations: list[str],
    underlying_price: float,
    max_expirations: int,
) -> list[str]:
    option_codes: set[str] = set()
    selected_expirations = expirations[:max_expirations]
    for expiration in selected_expirations:
        data = call_or_raise(
            f"get_option_chain {code} {expiration}",
            quote_ctx.get_option_chain,
            code=code,
            start=expiration,
            end=expiration,
        )
        for row in frame_records(data):
            option_code = row.get("code")
            strike = to_float(row.get("strike_price"))
            opt_type = option_type_value(row.get("option_type"))
            if not option_code or not strike or opt_type is None:
                continue
            if opt_type == "call" and underlying_price * 0.45 <= strike <= underlying_price * 0.9:
                option_codes.add(str(option_code))
            if opt_type == "put" and underlying_price * 0.65 <= strike <= underlying_price:
                option_codes.add(str(option_code))
        if expiration != selected_expirations[-1]:
            time.sleep(OPTION_CHAIN_DELAY_SECONDS)
    return sorted(option_codes)


def map_snapshot(row: dict[str, Any], underlying: dict[str, Any]) -> dict[str, Any] | None:
    option_type = option_type_value(row.get("option_type"))
    expiration = str(row.get("strike_time", ""))
    strike = to_float(row.get("option_strike_price"))
    code = str(row.get("code", ""))
    underlying_code = str(underlying.get("code", ""))
    underlying_price = to_float(underlying.get("last_price"))
    bid = to_float(row.get("bid_price"))
    ask = to_float(row.get("ask_price"))
    last_price = to_float(row.get("last_price"))

    if not code or option_type is None or not expiration or not strike or not underlying_price:
        return None

    if bid <= 0 or ask <= 0 or ask < bid:
        return None

    iv = to_float(row.get("option_implied_volatility"))
    if 0 < iv <= 1:
        iv *= 100

    market_cap_b = to_float(underlying.get("total_market_val")) / 1_000_000_000
    if market_cap_b <= 0:
        market_cap_b = 10

    volume = to_int(row.get("volume"))
    day_change_pct = to_float(row.get("change_rate"))

    return {
        "id": code,
        "ticker": display_ticker(underlying_code),
        "companyName": str(underlying.get("name") or display_ticker(underlying_code)),
        "sector": "ETF" if display_ticker(underlying_code) in {"SMH", "SPY", "QQQ", "IWM"} else "Unknown",
        "optionType": option_type,
        "expiration": expiration,
        "dte": days_to_expiration(expiration),
        "strike": strike,
        "underlyingPrice": underlying_price,
        "marketCapB": market_cap_b,
        "lastPrice": last_price if last_price > 0 else (bid + ask) / 2,
        "bid": bid,
        "ask": ask,
        "delta": to_float(row.get("option_delta")),
        "gamma": to_float(row.get("option_gamma")),
        "theta": to_float(row.get("option_theta")),
        "vega": to_float(row.get("option_vega")),
        "iv": iv,
        "ivPercentile": min(100, max(0, iv)),
        "openInterest": to_int(row.get("option_open_interest")),
        "volume": volume,
        "dayChangePct": day_change_pct,
        "priceSource": "moomoo_snapshot",
        "underlyingPriceSource": "moomoo_snapshot",
        "ivPercentileSource": "current_iv_proxy",
    }


def fetch_ticker_candidates(quote_ctx: OpenQuoteContext, code: str, args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    underlying = get_snapshot_map(quote_ctx, [code]).get(code)
    if not underlying:
        raise RuntimeError(f"No underlying snapshot returned for {code}")

    underlying_price = to_float(underlying.get("last_price"))
    if underlying_price <= 0:
        raise RuntimeError(f"No usable underlying price returned for {code}")

    weekly_expirations = expiration_dates(
        quote_ctx,
        code,
        args.weekly_min_dte,
        args.weekly_max_dte,
        args.max_expirations_per_ticker,
    )
    leaps_expirations = expiration_dates(
        quote_ctx,
        code,
        args.leaps_min_dte,
        args.leaps_max_dte,
        args.max_expirations_per_ticker,
    )
    all_expirations = sorted(set(weekly_expirations + leaps_expirations))
    option_codes = collect_chain_codes(
        quote_ctx,
        code,
        all_expirations,
        underlying_price,
        args.max_expirations_per_ticker,
    )
    option_snapshots = get_snapshot_map(quote_ctx, option_codes) if option_codes else {}
    candidates = [
        candidate
        for candidate in (map_snapshot(row, underlying) for row in option_snapshots.values())
        if candidate is not None
    ]

    return candidates, {
        "ticker": display_ticker(code),
        "underlyingPrice": underlying_price,
        "expirations": len(all_expirations),
        "optionCodes": len(option_codes),
        "candidates": len(candidates),
    }


def main() -> int:
    args = parse_args()
    codes = [normalize_code(ticker) for ticker in (args.tickers or DEFAULT_UNIVERSE)]
    all_candidates: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []

    ensure_opend_available(args.host, args.port)
    quote_ctx = OpenQuoteContext(host=args.host, port=args.port)
    try:
        for code in codes:
            candidates, summary = fetch_ticker_candidates(quote_ctx, code, args)
            all_candidates.extend(candidates)
            summaries.append(summary)
            if code != codes[-1]:
                time.sleep(OPTION_CHAIN_DELAY_SECONDS)
    finally:
        quote_ctx.close()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(all_candidates, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"outputPath": str(args.output), "summaries": summaries, "totalCandidates": len(all_candidates)}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
