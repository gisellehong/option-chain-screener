#!/usr/bin/env python3
"""Fetch English watchlist news into the dashboard's generated JSON format."""

from __future__ import annotations

import argparse
import email.utils
import html
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_PATH = ROOT / "config/watchlists.json"
OUTPUT_PATH = ROOT / "src/data/generated/watchlistNews.json"
YAHOO_RSS_URL = "https://feeds.finance.yahoo.com/rss/2.0/headline"
SCHEMA_VERSION = 1

CHINESE_DOMAINS = {
    "baidu.com",
    "caixin.com",
    "china.com",
    "chinanews.com",
    "eastmoney.com",
    "hexun.com",
    "ifeng.com",
    "jrj.com.cn",
    "qq.com",
    "sina.com.cn",
    "sohu.com",
    "wallstreetcn.com",
    "yicai.com",
}

COMPANY_ALIASES = {
    "AAPL": ["Apple"],
    "MSFT": ["Microsoft"],
    "NVDA": ["NVIDIA", "Nvidia"],
    "AMD": ["Advanced Micro Devices", "AMD"],
    "SMH": ["VanEck Semiconductor ETF", "Semiconductor ETF", "SMH"],
    "QQQ": ["Invesco QQQ", "Nasdaq 100", "Nasdaq-100", "QQQ"],
    "GOOGL": ["Alphabet", "Google"],
    "AMZN": ["Amazon", "AWS"],
    "AVGO": ["Broadcom"],
    "ORCL": ["Oracle"],
    "META": ["Meta Platforms", "Meta"],
    "TSLA": ["Tesla"],
    "BRK.B": ["Berkshire Hathaway", "Berkshire"],
    "BRK-B": ["Berkshire Hathaway", "Berkshire"],
    "MRVL": ["Marvell"],
    "NOK": ["Nokia"],
    "MU": ["Micron"],
    "INTC": ["Intel"],
    "QCOM": ["Qualcomm"],
    "ASX": ["ASE Technology"],
    "HOOD": ["Robinhood"],
    "CRCL": ["Circle"],
    "SMR": ["NuScale", "NuScale Power"],
    "NOW": ["ServiceNow"],
    "SPY": ["SPDR S&P 500", "S&P 500", "SPY"],
    "EWY": ["iShares MSCI South Korea", "South Korea ETF", "EWY"],
    "PLTR": ["Palantir"],
    "SPCX": ["SpaceX", "Space Exploration Technologies", "SPCX"],
    "SOXL": ["Direxion Daily Semiconductor Bull", "SOXL"],
    "SNDK": ["SanDisk", "Sandisk"],
}

TAG_KEYWORDS = [
    ("earnings", ["earnings", "revenue", "profit", "guidance", "quarter", "results"]),
    ("AI", [" ai ", "artificial intelligence", "accelerator", "gpu", "data center", "datacenter"]),
    ("IPO", [" ipo", "debut", "listing", "public offering"]),
    ("options", ["option", "options", "volatility", "implied volatility"]),
    ("regulation", ["regulation", "regulatory", "antitrust", "lawsuit", "probe", "ban"]),
    ("M&A", ["acquire", "acquisition", "merger", "deal", "buyout"]),
    ("analyst", ["analyst", "upgrade", "downgrade", "price target", "rating"]),
    ("macro", ["fed", "rates", "inflation", "tariff", "jobs report"]),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch watchlist news from English Yahoo Finance RSS feeds.")
    parser.add_argument("--watchlists", type=Path, default=WATCHLIST_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--max-items", type=int, default=5)
    parser.add_argument("--delay", type=float, default=0.2)
    parser.add_argument("tickers", nargs="*", help="Optional ticker override. Defaults to combined config/watchlists.json.")
    return parser.parse_args()


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_ticker(value: str) -> str:
    ticker = value.strip().upper()
    return "BRK-B" if ticker == "BRK.B" else ticker


def display_ticker(value: str) -> str:
    return "BRK.B" if value == "BRK-B" else value


def unique_tickers(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        ticker = normalize_ticker(value)
        if ticker and ticker not in seen:
            seen.add(ticker)
            result.append(ticker)
    return result


def load_tickers(path: Path, overrides: list[str]) -> list[str]:
    if overrides:
        return unique_tickers(overrides)
    raw = read_json(path, {})
    return unique_tickers(list(raw.get("leaps", [])) + list(raw.get("weekly_csp", [])))


def feed_url(ticker: str) -> str:
    return f"{YAHOO_RSS_URL}?{urllib.parse.urlencode({'s': display_ticker(ticker), 'region': 'US', 'lang': 'en-US'})}"


def fetch_xml(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
            "User-Agent": "option-chain-screener/0.1 (+local watchlist news)",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.read()


def clean_text(value: str | None) -> str:
    text = html.unescape(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_datetime(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def domain_for(url: str) -> str:
    hostname = urllib.parse.urlparse(url).hostname or ""
    return hostname.lower().removeprefix("www.")


def is_chinese_source(url: str) -> bool:
    hostname = domain_for(url)
    return any(hostname == domain or hostname.endswith(f".{domain}") for domain in CHINESE_DOMAINS)


def relevance_score(ticker: str, title: str, description: str) -> int:
    haystack = f" {title} {description} "
    score = 0
    ticker_pattern = re.compile(rf"(?<![A-Z0-9]){re.escape(display_ticker(ticker))}(?![A-Z0-9])", re.IGNORECASE)
    if ticker_pattern.search(haystack):
        score += 3
    for alias in COMPANY_ALIASES.get(ticker, []):
        if alias.lower() in haystack.lower():
            score += 2
    if "$" in haystack and display_ticker(ticker) in haystack:
        score += 1
    return score


def classify_tag(title: str, description: str) -> str:
    haystack = f" {title} {description} ".lower()
    for tag, keywords in TAG_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return tag
    return "market news"


def impact_note(tag: str) -> str:
    notes = {
        "earnings": "Check earnings timing, guidance tone, and whether IV already prices the move.",
        "AI": "AI-related catalyst; compare narrative strength against current valuation and IV.",
        "IPO": "Post-listing volatility can be unstable; verify options liquidity before sizing.",
        "options": "Options-specific catalyst; watch bid/ask spread and IV expansion or crush.",
        "regulation": "Regulatory headline can gap the stock; avoid shallow buffers into binary risk.",
        "M&A": "Deal news can override normal technical and IV signals.",
        "analyst": "Analyst-driven move; confirm whether price action has follow-through.",
        "macro": "Macro-sensitive headline; compare against SPY/QQQ sector move.",
    }
    return notes.get(tag, "Monitor whether the headline changes the base thesis or just short-term sentiment.")


def parse_items(ticker: str, xml_data: bytes, max_items: int) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_data)
    items: list[dict[str, Any]] = []
    seen_links: set[str] = set()
    for node in root.findall("./channel/item"):
        title = clean_text(node.findtext("title"))
        description = clean_text(node.findtext("description"))
        link = clean_text(node.findtext("link"))
        if not title or not link or link in seen_links or is_chinese_source(link):
            continue
        score = relevance_score(ticker, title, description)
        if score < 3:
            continue
        tag = classify_tag(title, description)
        items.append(
            {
                "date": (parse_datetime(node.findtext("pubDate")) or datetime.now(timezone.utc).isoformat()).split("T")[0],
                "publishedAt": parse_datetime(node.findtext("pubDate")),
                "headline": title,
                "summary": description,
                "impact": impact_note(tag),
                "tag": tag,
                "source": domain_for(link),
                "url": link,
                "relevanceScore": score,
            }
        )
        seen_links.add(link)
    return sorted(items, key=lambda item: (item.get("publishedAt") or "", item.get("relevanceScore") or 0), reverse=True)[:max_items]


def main() -> int:
    args = parse_args()
    tickers = load_tickers(args.watchlists, args.tickers)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    by_ticker: dict[str, Any] = {}
    errors: dict[str, str] = {}
    source_urls: dict[str, str] = {}

    for index, ticker in enumerate(tickers):
        url = feed_url(ticker)
        source_urls[display_ticker(ticker)] = url
        try:
            by_ticker[display_ticker(ticker)] = parse_items(ticker, fetch_xml(url), args.max_items)
        except Exception as exc:  # noqa: BLE001
            by_ticker[display_ticker(ticker)] = []
            errors[display_ticker(ticker)] = str(exc)
        if index < len(tickers) - 1 and args.delay > 0:
            time.sleep(args.delay)

    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "source": {
            "name": "Yahoo Finance RSS",
            "region": "US",
            "language": "en-US",
            "sourceUrls": source_urls,
            "excludedDomains": sorted(CHINESE_DOMAINS),
        },
        "byTicker": by_ticker,
        "errors": errors,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"outputPath": str(args.output), "tickers": len(tickers), "errors": errors}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
