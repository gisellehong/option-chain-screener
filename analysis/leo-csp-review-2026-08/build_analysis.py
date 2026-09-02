#!/usr/bin/env python3
"""Reconstruct the Leo CSP screenshots against local Moomoo archives.

The script deliberately separates directly observed Greeks from Black--Scholes
estimates.  It writes bounded, reviewable outputs used by the Markdown and HTML
reports in this directory.
"""

from __future__ import annotations

import csv
import glob
import json
import math
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from statistics import median
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(__file__).resolve().parent
ET = ZoneInfo("America/New_York")
SGT = ZoneInfo("Asia/Singapore")
RISK_FREE_RATE = 0.04


@dataclass(frozen=True)
class Entry:
    ticker: str
    expiration: str
    strike: float
    trade_date: str
    trade_time_et: str
    fill_price: float
    commission: float


ENTRIES = [
    Entry("NVDA", "2026-08-14", 190.0, "2026-07-30", "10:08:55", 4.17, 1.06),
    Entry("SPY", "2026-08-14", 730.0, "2026-07-30", "10:07:29", 5.73, 1.06),
    Entry("NVDA", "2026-08-07", 195.0, "2026-07-30", "10:07:10", 4.60, 1.05),
    Entry("QQQ", "2026-08-14", 660.0, "2026-07-30", "10:06:12", 7.06, 1.05),
    Entry("PLTR", "2026-08-07", 122.0, "2026-08-03", "15:00:35", 5.28, 1.06),
    Entry("TSM", "2026-08-14", 390.0, "2026-08-03", "12:37:57", 8.46, 1.07),
    Entry("TSLA", "2026-08-21", 310.0, "2026-08-03", "10:49:53", 8.37, 1.07),
    Entry("MRVL", "2026-08-14", 172.5, "2026-08-03", "09:40:11", 8.40, 1.06),
    Entry("SPCX", "2026-08-07", 103.0, "2026-08-04", "10:16:13", 3.53, 1.04),
    Entry("SPCX", "2026-08-14", 100.0, "2026-08-05", "09:31:26", 3.99, 1.05),
]


EXITS = [
    {
        "ticker": "QQQ",
        "expiration": "2026-08-14",
        "strike": 660.0,
        "entry_date": "2026-07-30",
        "entry_credit": 7.06,
        "exit_date": "2026-08-07",
        "exit_time_et": "15:46:38",
        "exit_debit": 0.16,
        "exit_commission": 1.03,
        "displayed_profit": 687.92,
        "entry_visible": True,
    },
    {
        "ticker": "TSLA",
        "expiration": "2026-08-14",
        "strike": 300.0,
        "entry_date": None,
        "entry_credit": 5.85,
        "exit_date": "2026-08-07",
        "exit_time_et": "11:51:19",
        "exit_debit": 0.35,
        "exit_commission": 1.03,
        "displayed_profit": 548.40,
        "entry_visible": False,
    },
    {
        "ticker": "AVGO",
        "expiration": "2026-08-14",
        "strike": 365.0,
        "entry_date": None,
        "entry_credit": 7.41,
        "exit_date": "2026-08-07",
        "exit_time_et": "10:48:08",
        "exit_debit": 0.26,
        "exit_commission": 1.04,
        "displayed_profit": 713.25,
        "entry_visible": False,
    },
    {
        "ticker": "NVDA",
        "expiration": "2026-08-14",
        "strike": 190.0,
        "entry_date": "2026-07-30",
        "entry_credit": 4.17,
        "exit_date": "2026-08-07",
        "exit_time_et": "10:41:39",
        "exit_debit": 0.11,
        "exit_commission": 0.57,
        "displayed_profit": 404.37,
        "entry_visible": True,
    },
    {
        "ticker": "SPCX",
        "expiration": "2026-08-14",
        "strike": 100.0,
        "entry_date": "2026-08-05",
        "entry_credit": 3.99,
        "exit_date": "2026-08-07",
        "exit_time_et": "10:39:43",
        "exit_debit": 0.25,
        "exit_commission": 1.04,
        "displayed_profit": 371.91,
        "entry_visible": True,
    },
    {
        "ticker": "SPY",
        "expiration": "2026-08-14",
        "strike": 730.0,
        "entry_date": "2026-07-30",
        "entry_credit": 5.73,
        "exit_date": "2026-08-07",
        "exit_time_et": "10:23:31",
        "exit_debit": 0.11,
        "exit_commission": 0.86,
        "displayed_profit": 560.08,
        "entry_visible": True,
    },
]


DIVIDEND_YIELD = {
    "NVDA": 0.0003,
    "SPY": 0.011,
    "QQQ": 0.005,
    "TSLA": 0.0,
    "MRVL": 0.006,
    "SPCX": 0.0,
}


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def black_scholes_put(
    underlying: float,
    strike: float,
    years: float,
    volatility: float,
    risk_free_rate: float,
    dividend_yield: float,
) -> tuple[float, float]:
    root_time = math.sqrt(years)
    d1 = (
        math.log(underlying / strike)
        + (risk_free_rate - dividend_yield + volatility * volatility / 2.0) * years
    ) / (volatility * root_time)
    d2 = d1 - volatility * root_time
    price = (
        strike * math.exp(-risk_free_rate * years) * normal_cdf(-d2)
        - underlying * math.exp(-dividend_yield * years) * normal_cdf(-d1)
    )
    delta = -math.exp(-dividend_yield * years) * normal_cdf(-d1)
    return price, delta


def implied_volatility(
    underlying: float,
    strike: float,
    years: float,
    put_price: float,
    dividend_yield: float,
) -> tuple[float, float]:
    low, high = 0.001, 5.0
    for _ in range(120):
        guess = (low + high) / 2.0
        model_price, _ = black_scholes_put(
            underlying,
            strike,
            years,
            guess,
            RISK_FREE_RATE,
            dividend_yield,
        )
        if model_price < put_price:
            low = guess
        else:
            high = guess
    volatility = (low + high) / 2.0
    _, delta = black_scholes_put(
        underlying,
        strike,
        years,
        volatility,
        RISK_FREE_RATE,
        dividend_yield,
    )
    return volatility, delta


def trade_datetime(entry: Entry) -> datetime:
    return datetime.fromisoformat(f"{entry.trade_date}T{entry.trade_time_et}").replace(tzinfo=ET)


def expiry_datetime(entry: Entry) -> datetime:
    return datetime.fromisoformat(f"{entry.expiration}T16:00:00").replace(tzinfo=ET)


def load_snapshots() -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    contract_keys = {
        (entry.ticker, entry.expiration, entry.strike, "put") for entry in ENTRIES
    }
    patterns = [
        str(ROOT / "data" / "snapshots" / date / "*.json")
        for date in (
            "2026-07-30",
            "2026-07-31",
            "2026-08-01",
            "2026-08-03",
            "2026-08-04",
            "2026-08-05",
            "2026-08-06",
        )
    ]
    paths = sorted(path for pattern in patterns for path in glob.glob(pattern))
    for path_text in paths:
        path = Path(path_text)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        generated_at = datetime.fromisoformat(payload["generatedAt"])
        by_ticker: dict[str, float] = {}
        relevant_candidates: list[dict[str, Any]] = []
        for candidate in payload.get("candidates", []):
            ticker = candidate.get("ticker")
            price = candidate.get("underlyingPrice")
            if ticker and isinstance(price, (int, float)) and price > 0:
                by_ticker.setdefault(ticker, float(price))
            key = (
                ticker,
                candidate.get("expiration"),
                float(candidate.get("strike", 0.0)),
                candidate.get("optionType"),
            )
            if key in contract_keys:
                relevant_candidates.append(candidate)
        snapshots.append(
            {
                "generated_at": generated_at,
                "path": path.relative_to(ROOT).as_posix(),
                "candidates": relevant_candidates,
                "underlying_by_ticker": by_ticker,
            }
        )
    return snapshots


def matching_contracts(entry: Entry, snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    trade_sgt = trade_datetime(entry).astimezone(SGT)
    matches: list[dict[str, Any]] = []
    for snapshot in snapshots:
        for candidate in snapshot["candidates"]:
            if (
                candidate.get("ticker") == entry.ticker
                and candidate.get("expiration") == entry.expiration
                and candidate.get("optionType") == "put"
                and abs(float(candidate.get("strike", 0.0)) - entry.strike) < 1e-6
            ):
                matches.append(
                    {
                        "minutes_from_trade": (
                            snapshot["generated_at"] - trade_sgt
                        ).total_seconds()
                        / 60.0,
                        "generated_at": snapshot["generated_at"],
                        "path": snapshot["path"],
                        "candidate": candidate,
                    }
                )
    return sorted(matches, key=lambda row: abs(row["minutes_from_trade"]))


def estimate_underlying(entry: Entry, snapshots: list[dict[str, Any]]) -> dict[str, Any] | None:
    trade_sgt = trade_datetime(entry).astimezone(SGT)
    points = [
        {
            "generated_at": snapshot["generated_at"],
            "path": snapshot["path"],
            "underlying": snapshot["underlying_by_ticker"][entry.ticker],
        }
        for snapshot in snapshots
        if entry.ticker in snapshot["underlying_by_ticker"]
    ]
    if not points:
        return None
    before = [point for point in points if point["generated_at"] <= trade_sgt]
    after = [point for point in points if point["generated_at"] >= trade_sgt]
    nearest_before = max(before, key=lambda point: point["generated_at"], default=None)
    nearest_after = min(after, key=lambda point: point["generated_at"], default=None)
    if nearest_before and nearest_after and nearest_before != nearest_after:
        full_seconds = (nearest_after["generated_at"] - nearest_before["generated_at"]).total_seconds()
        offset_seconds = (trade_sgt - nearest_before["generated_at"]).total_seconds()
        if full_seconds <= 90 * 60:
            weight = offset_seconds / full_seconds
            estimate = nearest_before["underlying"] + weight * (
                nearest_after["underlying"] - nearest_before["underlying"]
            )
            return {
                "value": estimate,
                "method": "linear interpolation",
                "before": nearest_before,
                "after": nearest_after,
            }
    nearest = min(points, key=lambda point: abs((point["generated_at"] - trade_sgt).total_seconds()))
    return {"value": nearest["underlying"], "method": "nearest snapshot", "nearest": nearest}


def reconstruct_entry(entry: Entry, snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    matches = matching_contracts(entry, snapshots)
    observed = matches[0] if matches and abs(matches[0]["minutes_from_trade"]) <= 20 else None
    collateral = entry.strike * 100.0
    calendar_dte = (
        datetime.fromisoformat(entry.expiration).date()
        - datetime.fromisoformat(entry.trade_date).date()
    ).days
    premium_yield = entry.fill_price / entry.strike
    base: dict[str, Any] = {
        **asdict(entry),
        "contract": f"{entry.ticker} {entry.expiration} {entry.strike:g} Put",
        "calendar_dte": calendar_dte,
        "collateral": collateral,
        "gross_premium": entry.fill_price * 100.0,
        "premium_yield": premium_yield,
        "annualized_entry_yield": premium_yield * 365.0 / calendar_dte,
    }

    # The Aug 5 SPCX trade crossed a sharp opening gap.  Nearby archived quotes
    # do not bracket the execution, so use a bounded price sensitivity instead
    # of presenting the nearest quote Greek as an entry observation.
    if entry.ticker == "SPCX" and entry.trade_date == "2026-08-05":
        years = (expiry_datetime(entry) - trade_datetime(entry)).total_seconds() / (365.0 * 86400.0)
        sensitivities = []
        for underlying in (108.0, 110.0, 112.25, 113.0, 115.0):
            iv, delta = implied_volatility(
                underlying,
                entry.strike,
                years,
                entry.fill_price,
                DIVIDEND_YIELD[entry.ticker],
            )
            sensitivities.append({"underlying": underlying, "iv": iv, "delta": delta})
        point = next(row for row in sensitivities if row["underlying"] == 112.25)
        return {
            **base,
            "greeks_status": "model range",
            "underlying_at_entry": point["underlying"],
            "iv": point["iv"],
            "delta": point["delta"],
            "iv_range": [min(row["iv"] for row in sensitivities), max(row["iv"] for row in sensitivities)],
            "delta_range": [min(row["delta"] for row in sensitivities), max(row["delta"] for row in sensitivities)],
            "evidence": "Opening-gap sensitivity using S=$108-$115; nearest post-open S=$112.25.",
        }

    if observed:
        candidate = observed["candidate"]
        return {
            **base,
            "greeks_status": "observed nearby snapshot",
            "underlying_at_entry": candidate.get("underlyingPrice"),
            "iv": float(candidate.get("iv")) / 100.0,
            "delta": float(candidate.get("delta")),
            "snapshot_minutes": observed["minutes_from_trade"],
            "snapshot_path": observed["path"],
            "bid": candidate.get("bid"),
            "ask": candidate.get("ask"),
            "evidence": "Same contract in the nearest local Moomoo snapshot.",
        }

    underlying = estimate_underlying(entry, snapshots)
    if underlying is None:
        sensitivity = []
        if entry.ticker == "TSM":
            years = (expiry_datetime(entry) - trade_datetime(entry)).total_seconds() / (365.0 * 86400.0)
            for spot in (400.0, 410.0, 420.0, 430.0):
                iv, delta = implied_volatility(spot, entry.strike, years, entry.fill_price, 0.015)
                sensitivity.append({"underlying": spot, "iv": iv, "delta": delta})
        return {
            **base,
            "greeks_status": "unavailable",
            "underlying_at_entry": None,
            "iv": None,
            "delta": None,
            "sensitivity": sensitivity,
            "evidence": "Ticker absent from the local watchlist; no defensible entry spot price.",
        }

    years = (expiry_datetime(entry) - trade_datetime(entry)).total_seconds() / (365.0 * 86400.0)
    iv, delta = implied_volatility(
        underlying["value"],
        entry.strike,
        years,
        entry.fill_price,
        DIVIDEND_YIELD.get(entry.ticker, 0.0),
    )
    return {
        **base,
        "greeks_status": "Black-Scholes estimate",
        "underlying_at_entry": underlying["value"],
        "iv": iv,
        "delta": delta,
        "underlying_method": underlying["method"],
        "underlying_evidence": {
            key: (
                {
                    **value,
                    "generated_at": value["generated_at"].isoformat(),
                }
                if isinstance(value, dict) and "generated_at" in value
                else value
            )
            for key, value in underlying.items()
        },
        "evidence": "IV solved from fill price; Delta computed from the same model and local underlying snapshot(s).",
    }


def reconstruct_exit(exit_trade: dict[str, Any]) -> dict[str, Any]:
    gross_capture = (exit_trade["entry_credit"] - exit_trade["exit_debit"]) / exit_trade["entry_credit"]
    net_capture = exit_trade["displayed_profit"] / (exit_trade["entry_credit"] * 100.0)
    collateral = exit_trade["strike"] * 100.0
    result = {
        **exit_trade,
        "contract": (
            f'{exit_trade["ticker"]} {exit_trade["expiration"]} '
            f'{exit_trade["strike"]:g} Put'
        ),
        "collateral": collateral,
        "gross_capture": gross_capture,
        "net_capture": net_capture,
        "net_return_on_collateral": exit_trade["displayed_profit"] / collateral,
    }
    if exit_trade["entry_date"]:
        holding_days = (
            datetime.fromisoformat(exit_trade["exit_date"]).date()
            - datetime.fromisoformat(exit_trade["entry_date"]).date()
        ).days
        result["holding_days"] = holding_days
        result["annualized_realized_return"] = (
            result["net_return_on_collateral"] * 365.0 / holding_days
        )
    else:
        result["holding_days"] = None
        result["annualized_realized_return"] = None
    return result


def json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def build_notebook(results: dict[str, Any]) -> dict[str, Any]:
    source_path = "results.json"
    summary = results["summary"]
    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## tl;dr\n",
                f"- Visible CSP entries require **${summary['visible_entry_collateral']:,.0f}** of strike collateral.\n",
                f"- Capital-weighted entry yield is **{summary['weighted_entry_yield']:.2%}**; simple annualized entry yield is **{summary['capital_day_annualized_entry_yield']:.1%}**.\n",
                f"- Four exact entry/exit pairs captured **{summary['exact_exit_weighted_gross_capture']:.1%}** of premium.\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## Context & Methods\n",
                "### Key Assumptions\n",
                "Screenshot fills are authoritative. Same-contract Moomoo snapshots within 20 minutes are observed evidence; otherwise IV is solved from the fill with a Black–Scholes model using local underlying snapshots, 4% risk-free rate, and bounded dividend-yield assumptions. TSM remains unavailable because its underlying was not archived.\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "import json\n",
                "from pathlib import Path\n",
                f"results = json.loads(Path('{source_path}').read_text(encoding='utf-8'))\n",
                "len(results['entries']), len(results['exits'])\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": ["## Data\n", "The bounded entry and exit records used in the report.\n"],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "[(row['contract'], row['greeks_status'], row['delta'], row['iv']) for row in results['entries']]\n"
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": ["## Results\n", "Recompute the headline portfolio and exit statistics from the serialized rows.\n"],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "entries = results['entries']\n",
                "exits = [row for row in results['exits'] if row['entry_visible']]\n",
                "visible_collateral = sum(row['collateral'] for row in entries)\n",
                "visible_premium = sum(row['gross_premium'] for row in entries)\n",
                "weighted_entry_yield = visible_premium / visible_collateral\n",
                "weighted_capture = sum((row['entry_credit'] - row['exit_debit']) * 100 for row in exits) / sum(row['entry_credit'] * 100 for row in exits)\n",
                "visible_collateral, weighted_entry_yield, weighted_capture\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## Takeaways\n",
                "The visible winner sample supports an aggressive, higher-Delta CSP style and near-full premium capture. It does not establish a true annual account return because losing or still-open trades are not shown.\n",
            ],
        },
    ]
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def main() -> None:
    snapshots = load_snapshots()
    entries = [reconstruct_entry(entry, snapshots) for entry in ENTRIES]
    exits = [reconstruct_exit(exit_trade) for exit_trade in EXITS]
    visible_collateral = sum(row["collateral"] for row in entries)
    visible_premium = sum(row["gross_premium"] for row in entries)
    capital_days = sum(row["collateral"] * row["calendar_dte"] for row in entries)
    exact_exits = [row for row in exits if row["entry_visible"]]
    exact_net_profit = sum(row["displayed_profit"] for row in exact_exits)
    exact_capital_days = sum(row["collateral"] * row["holding_days"] for row in exact_exits)
    exact_gross_capture_numerator = sum(
        (row["entry_credit"] - row["exit_debit"]) * 100.0 for row in exact_exits
    )
    exact_opening_premium = sum(row["entry_credit"] * 100.0 for row in exact_exits)
    summary = {
        "visible_entry_count": len(entries),
        "visible_entry_collateral": visible_collateral,
        "visible_entry_premium": visible_premium,
        "weighted_entry_yield": visible_premium / visible_collateral,
        "median_entry_yield": median(row["premium_yield"] for row in entries),
        "capital_weighted_dte": capital_days / visible_collateral,
        "capital_day_annualized_entry_yield": visible_premium / (capital_days / 365.0),
        "median_trade_annualized_entry_yield": median(
            row["annualized_entry_yield"] for row in entries
        ),
        "exact_pair_count": len(exact_exits),
        "exact_exit_weighted_gross_capture": exact_gross_capture_numerator / exact_opening_premium,
        "exact_exit_median_gross_capture": median(row["gross_capture"] for row in exact_exits),
        "exact_exit_net_profit": exact_net_profit,
        "exact_exit_net_return_on_collateral": exact_net_profit
        / sum(row["collateral"] for row in exact_exits),
        "exact_exit_capital_day_annualized_return": exact_net_profit
        / (exact_capital_days / 365.0),
        "inferred_additional_closed_collateral": 66_500.0,
        "assigned_intc_capital": 20_000.0,
        "cropped_340_put_collateral": 34_000.0,
        "likely_peak_collateral_low": 383_750.0,
        "likely_peak_collateral_high": 417_750.0,
        "prudent_account_cash_low": 460_000.0,
        "prudent_account_cash_high": 520_000.0,
    }
    results = json_safe(
        {
            "generated_at": datetime.now(tz=SGT).isoformat(timespec="seconds"),
            "source_snapshot_count": len(snapshots),
            "entries": entries,
            "exits": exits,
            "summary": summary,
            "method": {
                "risk_free_rate": RISK_FREE_RATE,
                "timezone": "America/New_York for trades; Asia/Singapore for local snapshots",
                "iv_percentile_note": "Local ivPercentile is current-IV proxy, not historical IV rank.",
            },
        }
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "results.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_csv(
        OUTPUT_DIR / "entries.csv",
        entries,
        [
            "contract",
            "trade_date",
            "trade_time_et",
            "fill_price",
            "calendar_dte",
            "collateral",
            "premium_yield",
            "annualized_entry_yield",
            "underlying_at_entry",
            "delta",
            "iv",
            "greeks_status",
            "snapshot_minutes",
            "snapshot_path",
            "evidence",
        ],
    )
    write_csv(
        OUTPUT_DIR / "exits.csv",
        exits,
        [
            "contract",
            "entry_date",
            "entry_credit",
            "exit_date",
            "exit_time_et",
            "exit_debit",
            "displayed_profit",
            "gross_capture",
            "net_capture",
            "collateral",
            "net_return_on_collateral",
            "holding_days",
            "annualized_realized_return",
            "entry_visible",
        ],
    )
    (OUTPUT_DIR / "analysis.ipynb").write_text(
        json.dumps(build_notebook(results), indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
