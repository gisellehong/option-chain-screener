#!/usr/bin/env python3
"""Fetch InsiderFinance Gamma Exposure (GEX) data and write a compact JSON file."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_PATH = ROOT / "src/data/generated/gex.json"
ARCHIVE_ROOT = ROOT / "data/gex"
DEFAULT_TICKER = "SPX"
USER_AGENT = "Mozilla/5.0 (compatible; option-chain-screener/0.1; +https://github.com/gisellehong/option-chain-screener)"


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self.text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        value = " ".join(data.split())
        if value:
            self.text.append(value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch GEX data from InsiderFinance.")
    parser.add_argument("ticker", nargs="?", default=DEFAULT_TICKER, help="Ticker path segment, e.g. SPX.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--archive-root", type=Path, default=ARCHIVE_ROOT)
    parser.add_argument("--source-url", help="Override the source URL.")
    parser.add_argument("--timeout", type=int, default=25)
    return parser.parse_args()


def fetch_html(url: str, timeout: int) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_next_data(html: str) -> dict[str, Any]:
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not match:
        raise RuntimeError("Unable to find __NEXT_DATA__ in InsiderFinance response.")
    return json.loads(unescape(match.group(1)))


def visible_text(html: str) -> list[str]:
    parser = TextExtractor()
    parser.feed(html)
    return parser.text


def parse_money(value: str | None) -> float | None:
    if not value:
        return None
    cleaned = value.replace("$", "").replace(",", "").strip()
    multiplier = 1.0
    if cleaned.endswith("B"):
        multiplier = 1_000_000_000
        cleaned = cleaned[:-1]
    elif cleaned.endswith("M"):
        multiplier = 1_000_000
        cleaned = cleaned[:-1]
    elif cleaned.endswith("K"):
        multiplier = 1_000
        cleaned = cleaned[:-1]
    try:
        return float(cleaned) * multiplier
    except ValueError:
        return None


def parse_pct(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.replace("%", "").replace("+", "").strip())
    except ValueError:
        return None


def parse_oi(value: str | None) -> int | None:
    if not value:
        return None
    cleaned = value.replace(",", "").strip()
    multiplier = 1.0
    if cleaned.endswith("B"):
        multiplier = 1_000_000_000
        cleaned = cleaned[:-1]
    elif cleaned.endswith("M"):
        multiplier = 1_000_000
        cleaned = cleaned[:-1]
    elif cleaned.endswith("K"):
        multiplier = 1_000
        cleaned = cleaned[:-1]
    try:
        return int(float(cleaned) * multiplier)
    except ValueError:
        return None


def value_after(labels: list[str], label: str, text: list[str], offset: int = 1) -> str | None:
    for index, item in enumerate(text):
        if item in labels and index + offset < len(text):
            return text[index + offset]
    return None


def parse_display_metrics(text: list[str]) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "spotPrice": parse_money(value_after(["Spot Price"], "Spot Price", text)),
        "netGex": parse_money(value_after(["Net GEX"], "Net GEX", text)),
        "netGexRatio": None,
        "callGex": parse_money(value_after(["Call GEX"], "Call GEX", text)),
        "callOpenInterest": parse_oi(value_after(["Call GEX"], "Call GEX", text, 2)),
        "putGex": parse_money(value_after(["Put GEX"], "Put GEX", text)),
        "putOpenInterest": parse_oi(value_after(["Put GEX"], "Put GEX", text, 2)),
        "totalGex": parse_money(value_after(["Total GEX"], "Total GEX", text)),
        "totalOpenInterest": parse_oi(value_after(["Total GEX"], "Total GEX", text, 2)),
        "callWall": parse_money(value_after(["Call Wall"], "Call Wall", text)),
        "callWallDistancePct": parse_pct(value_after(["Call Wall"], "Call Wall", text, 2)),
        "putWall": parse_money(value_after(["Put Wall"], "Put Wall", text)),
        "putWallDistancePct": parse_pct(value_after(["Put Wall"], "Put Wall", text, 2)),
        "zeroGamma": parse_money(value_after(["Zero Gamma"], "Zero Gamma", text)),
        "zeroGammaDistancePct": parse_pct(value_after(["Zero Gamma"], "Zero Gamma", text, 2)),
    }
    ratio = value_after(["Net GEX"], "Net GEX", text, 2)
    if ratio and ratio.startswith("Ratio:"):
        try:
            metrics["netGexRatio"] = float(ratio.split(":", 1)[1].strip())
        except ValueError:
            pass
    return metrics


def parse_seo_key_levels(seo_content: str | None) -> dict[str, Any]:
    if not seo_content:
        return {}
    levels: dict[str, Any] = {}
    money_patterns = {
        "peakGexStrike": r"Peak GEX Strike:\*\*\s*\$([\d,.]+)",
        "maxPain": r"Max Pain:\*\*\s*\$([\d,.]+)",
    }
    for key, pattern in money_patterns.items():
        match = re.search(pattern, seo_content)
        if match:
            levels[key] = parse_money(f"${match.group(1)}")

    wall_patterns = {
        "callWallOpenInterest": r"Call Wall:\*\*\s*\$[\d,.]+\s*\(([\d.]+[KMB]?)\s+OI\)",
        "putWallOpenInterest": r"Put Wall:\*\*\s*\$[\d,.]+\s*\(([\d.]+[KMB]?)\s+OI\)",
    }
    for key, pattern in wall_patterns.items():
        match = re.search(pattern, seo_content)
        if match:
            levels[key] = parse_oi(match.group(1))
    return levels


def option_expiration(row: dict[str, Any]) -> str:
    return f"{int(row['expireYear']):04d}-{int(row['expireMonth']):02d}-{int(row['expireDay']):02d}"


def gamma_exposure(row: dict[str, Any], spot: float) -> float:
    gamma = float(row.get("gamma") or 0)
    oi = float(row.get("openInterest") or 0)
    raw = gamma * oi * 100 * spot * spot * 0.01
    return raw if row.get("cp") == "C" else -raw


def finite_number(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def wall_from_exposure(rows: list[dict[str, Any]], cp: str, spot: float) -> dict[str, Any] | None:
    by_strike: dict[float, dict[str, float]] = defaultdict(lambda: {"openInterest": 0.0, "gex": 0.0})
    for row in rows:
        if row.get("cp") != cp:
            continue
        strike = finite_number(row.get("strike"))
        by_strike[strike]["openInterest"] += finite_number(row.get("openInterest"))
        by_strike[strike]["gex"] += abs(gamma_exposure(row, spot))
    if not by_strike:
        return None
    strike, values = max(by_strike.items(), key=lambda item: item[1]["gex"])
    return {
        "strike": strike,
        "distancePct": ((strike - spot) / spot) * 100 if spot else None,
        "openInterest": int(values["openInterest"]),
        "gex": values["gex"],
    }


def aggregate_options(rows: list[dict[str, Any]], spot: float) -> dict[str, Any]:
    by_strike: dict[float, dict[str, float]] = defaultdict(
        lambda: {"callGex": 0.0, "putGex": 0.0, "netGex": 0.0, "callOpenInterest": 0.0, "putOpenInterest": 0.0}
    )
    by_expiry: dict[str, dict[str, float]] = defaultdict(lambda: {"netGex": 0.0, "absGex": 0.0, "openInterest": 0.0})
    call_gex = 0.0
    put_gex_abs = 0.0
    call_oi = 0
    put_oi = 0

    for row in rows:
        strike = finite_number(row.get("strike"))
        expiry = option_expiration(row)
        exposure = gamma_exposure(row, spot)
        abs_exposure = abs(exposure)
        oi = int(finite_number(row.get("openInterest")))
        if row.get("cp") == "C":
            call_gex += abs_exposure
            call_oi += oi
            by_strike[strike]["callGex"] += abs_exposure
            by_strike[strike]["callOpenInterest"] += oi
        else:
            put_gex_abs += abs_exposure
            put_oi += oi
            by_strike[strike]["putGex"] -= abs_exposure
            by_strike[strike]["putOpenInterest"] += oi
        by_strike[strike]["netGex"] += exposure
        by_expiry[expiry]["netGex"] += exposure
        by_expiry[expiry]["absGex"] += abs_exposure
        by_expiry[expiry]["openInterest"] += oi

    strike_profile = [
        {
            "strike": strike,
            "callGex": values["callGex"],
            "putGex": values["putGex"],
            "netGex": values["netGex"],
            "absGex": abs(values["callGex"]) + abs(values["putGex"]),
            "callOpenInterest": int(values["callOpenInterest"]),
            "putOpenInterest": int(values["putOpenInterest"]),
        }
        for strike, values in by_strike.items()
    ]
    expiry_profile = [
        {
            "expiration": expiry,
            "netGex": values["netGex"],
            "absGex": values["absGex"],
            "openInterest": int(values["openInterest"]),
        }
        for expiry, values in by_expiry.items()
    ]

    peak = max(strike_profile, key=lambda item: item["absGex"]) if strike_profile else None
    return {
        "computed": {
            "callGex": call_gex,
            "putGex": -put_gex_abs,
            "netGex": call_gex - put_gex_abs,
            "totalGex": call_gex + put_gex_abs,
            "callOpenInterest": call_oi,
            "putOpenInterest": put_oi,
            "totalOpenInterest": call_oi + put_oi,
            "callPutGexRatio": call_gex / put_gex_abs if put_gex_abs else None,
            "callWall": wall_from_exposure(rows, "C", spot),
            "putWall": wall_from_exposure(rows, "P", spot),
            "peakGexStrike": peak,
        },
        "strikeProfile": sorted(strike_profile, key=lambda item: item["absGex"], reverse=True)[:80],
        "expiryProfile": sorted(expiry_profile, key=lambda item: item["absGex"], reverse=True)[:40],
    }


def market_regime(net_gex: float | None) -> str:
    if net_gex is None:
        return "unknown"
    if net_gex > 0:
        return "positive_gamma"
    if net_gex < 0:
        return "negative_gamma"
    return "neutral_gamma"


def archive_path(root: Path, ticker: str, generated_at: str) -> Path:
    parsed = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    stamp = parsed.isoformat(timespec="seconds").replace(":", "").replace("-", "").replace("+", "_")
    return root / parsed.date().isoformat() / f"{ticker.upper()}-{stamp}.json"


def main() -> int:
    args = parse_args()
    ticker = args.ticker.upper()
    source_url = args.source_url or f"https://www.insiderfinance.io/gamma-exposure/{ticker}"
    fetched_at = datetime.now().astimezone().isoformat(timespec="seconds")
    html = fetch_html(source_url, args.timeout)
    next_data = extract_next_data(html)
    page_props = next_data.get("props", {}).get("pageProps", {})
    initial = page_props.get("initialData") or {}
    options = initial.get("options") or []
    spot = finite_number(initial.get("spot"))
    display = parse_display_metrics(visible_text(html))
    key_levels = parse_seo_key_levels(page_props.get("seoContent"))
    aggregates = aggregate_options(options, spot)
    computed = aggregates["computed"]
    summary = {key: value for key, value in display.items() if value is not None}
    for key in ("callGex", "putGex", "netGex", "totalGex", "callOpenInterest", "putOpenInterest", "totalOpenInterest"):
        summary.setdefault(key, computed.get(key))
    summary.update(key_levels)
    summary["regime"] = market_regime(summary.get("netGex"))

    payload = {
        "schemaVersion": 1,
        "source": "insiderfinance",
        "sourceUrl": source_url,
        "ticker": ticker,
        "fetchedAt": fetched_at,
        "sourceTimestamp": initial.get("timestamp"),
        "isStale": bool(initial.get("isStale")),
        "spot": spot,
        "tickerDetails": initial.get("tickerDetails") or {},
        "summary": summary,
        "computedSummary": computed,
        "strikeProfile": aggregates["strikeProfile"],
        "expiryProfile": aggregates["expiryProfile"],
        "rawOptionCount": len(options),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    archive = archive_path(args.archive_root, ticker, fetched_at)
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"outputPath": str(args.output), "archivePath": str(archive), "ticker": ticker, "spot": spot}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        sys.exit(1)
