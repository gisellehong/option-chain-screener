#!/usr/bin/env python3
"""Build the canonical Data Analytics report artifact from results.json."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


HERE = Path(__file__).resolve().parent
RESULTS = json.loads((HERE / "results.json").read_text(encoding="utf-8"))
GENERATED_AT = datetime.now(tz=ZoneInfo("Asia/Singapore")).isoformat(timespec="seconds")


def pct(value: float | None) -> float | None:
    return None if value is None else round(value, 6)


entry_rows = []
delta_rows = []
for row in RESULTS["entries"]:
    short_contract = (
        f'{row["ticker"]} {row["expiration"][5:].replace("-", "/")} '
        f'{row["strike"]:g}P'
    )
    entry_row = {
        "contract": short_contract,
        "trade_date": row["trade_date"],
        "fill": row["fill_price"],
        "dte": row["calendar_dte"],
        "collateral": row["collateral"],
        "entry_yield": pct(row["premium_yield"]),
        "annualized_yield": pct(row["annualized_entry_yield"]),
        "delta": pct(row["delta"]),
        "iv": pct(row["iv"]),
        "greeks_status": row["greeks_status"],
    }
    entry_rows.append(entry_row)
    if row["delta"] is not None:
        delta_rows.append(
            {
                **entry_row,
                "abs_delta": round(abs(row["delta"]), 6),
                "current_middle_pass": abs(row["delta"]) <= 0.25,
                "current_best_pass": abs(row["delta"]) <= 0.12,
            }
        )

exit_rows = [
    {
        "contract": row["contract"].replace("2026-", "").replace(" Put", "P"),
        "entry_credit": row["entry_credit"],
        "exit_debit": row["exit_debit"],
        "gross_capture": pct(row["gross_capture"]),
        "net_profit": row["displayed_profit"],
        "holding_days": row["holding_days"],
        "pair_status": "Exact pair" if row["entry_visible"] else "Entry inferred",
    }
    for row in RESULTS["exits"]
]

comparison_rows = [
    {
        "dimension": "Delta",
        "leo": "Median -0.346; 8/9 exceed |Delta| 0.25",
        "current": "Best -0.12–0; Middle -0.25–-0.03",
        "implication": "Leo accepts materially more assignment and short-gamma risk.",
    },
    {
        "dimension": "DTE",
        "leo": "3–18 DTE; 40% above 14 DTE",
        "current": "Best 1–10; Middle 1–14",
        "implication": "Current archive misses several observed entries.",
    },
    {
        "dimension": "IV",
        "leo": "15.5%–220.8%; low-IV ETFs included",
        "current": "Best proxy ≥50%; Middle ≥35%",
        "implication": "Leo is not a pure IV-expansion filter.",
    },
    {
        "dimension": "Profit target",
        "leo": "94%–98%; exact-pair weighted 97.0%",
        "current": "Tracks 80% capture within five days",
        "implication": "Current approach exits tail risk materially earlier.",
    },
    {
        "dimension": "Assignment",
        "leo": "Two INTC contracts assigned; wheel-like follow-up possible",
        "current": "Opening candidate screen",
        "implication": "Assignment and repair path should be modeled explicitly.",
    },
]

sources = [
    {
        "id": "entry_reconstruction",
        "label": "Entry reconstruction from screenshots and local Moomoo snapshots",
        "path": "analysis/leo-csp-review-2026-08/entries.csv",
        "query": {
            "engine": "duckdb",
            "language": "sql",
            "sql": "SELECT contract, trade_date, fill_price AS fill, calendar_dte AS dte, collateral, premium_yield AS entry_yield, annualized_entry_yield AS annualized_yield, delta, iv, greeks_status, ABS(delta) AS abs_delta FROM read_csv_auto('analysis/leo-csp-review-2026-08/entries.csv') ORDER BY abs_delta DESC NULLS LAST",
            "description": "Loads the bounded entry reconstruction produced from screenshot fills, local option-chain snapshots, and Black–Scholes estimates where the contract was not archived.",
            "executed_at": RESULTS["generated_at"],
            "tables_used": [
                "analysis/leo-csp-review-2026-08/entries.csv",
                "data/snapshots/2026-07-30_to_2026-08-06",
            ],
            "filters": [
                "Trades visible in the four supplied screenshots",
                "Same-contract snapshots within 20 minutes treated as observed",
                "TSM excluded from single-point Greek estimates",
            ],
            "metric_definitions": {
                "entry_yield": "Option credit divided by strike collateral.",
                "annualized_yield": "Entry yield multiplied by 365 divided by calendar DTE.",
                "gross_capture": "(Entry credit - close debit) divided by entry credit.",
            },
        },
    },
    {
        "id": "exit_reconstruction",
        "label": "Exit reconstruction from screenshot pairs",
        "path": "analysis/leo-csp-review-2026-08/exits.csv",
        "query": {
            "engine": "duckdb",
            "language": "sql",
            "sql": "SELECT contract, entry_credit, exit_debit, gross_capture, displayed_profit AS net_profit, holding_days, CASE WHEN entry_visible THEN 'Exact pair' ELSE 'Entry inferred' END AS pair_status FROM read_csv_auto('analysis/leo-csp-review-2026-08/exits.csv') ORDER BY gross_capture DESC",
            "description": "Loads six August 7 profit-taking records; four have exact visible entry pairs and two use inferred entry credits.",
            "executed_at": RESULTS["generated_at"],
            "tables_used": ["analysis/leo-csp-review-2026-08/exits.csv"],
            "metric_definitions": {
                "gross_capture": "(Entry credit - close debit) divided by entry credit.",
                "net_profit": "Broker-displayed realized profit after the visible trade costs.",
            },
        },
    },
    {
        "id": "method_comparison",
        "label": "Current Weekly CSP configuration and reconstructed Leo behavior",
        "path": "src/data/screenerConfigs.ts",
        "query": {
            "engine": "duckdb",
            "language": "sql",
            "sql": "SELECT * FROM (VALUES ('Delta', 'Median -0.346; 8/9 exceed |Delta| 0.25', 'Best -0.12–0; Middle -0.25–-0.03'), ('DTE', '3–18 DTE; 40% above 14 DTE', 'Best 1–10; Middle 1–14'), ('IV', '15.5%–220.8%; low-IV ETFs included', 'Best proxy >=50%; Middle >=35%'), ('Profit target', '94%–98%; exact-pair weighted 97.0%', 'Tracks 80% capture within five days'), ('Assignment', 'Two INTC contracts assigned', 'Opening candidate screen')) AS comparison(dimension, leo, current_method)",
            "description": "Compares the reconstructed screenshot behavior with current Best and Middle Weekly CSP filter thresholds and tracking logic.",
            "executed_at": GENERATED_AT,
            "tables_used": [
                "src/data/screenerConfigs.ts",
                "src/lib/scoring.ts",
                "analysis/leo-csp-review-2026-08/results.json",
            ],
        },
    },
]

artifact = {
    "surface": "report",
    "manifest": {
        "version": 1,
        "surface": "report",
        "title": "Leo Cash-Secured Put 交易重建",
        "description": "Entry Greeks、資金需求、報酬率、profit-taking 與現行 Weekly CSP 方法的比較。",
        "generatedAt": GENERATED_AT,
        "cards": [],
        "charts": [
            {
                "id": "entry_delta",
                "title": "Estimated entry |Delta| by contract",
                "subtitle": "Nine estimable entries; TSM excluded. Dashed line marks the current Middle-case |Delta| cap of 0.25.",
                "headerMarkdown": "Bars farther past **0.25** represent materially more aggressive strike selection than the current Middle case.",
                "question": "How aggressive were Leo's entry strikes relative to the current screener?",
                "rationale": "A horizontal comparison bar keeps nine long contract labels readable and makes the 0.25 threshold explicit.",
                "intent": "comparison",
                "type": "horizontalBar",
                "dataset": "entry_delta",
                "sourceId": "entry_reconstruction",
                "encodings": {
                    "x": {"field": "contract", "type": "nominal", "label": "Contract"},
                    "y": {"field": "abs_delta", "type": "quantitative", "label": "Absolute Delta", "format": "number"},
                    "tooltip": [
                        {"field": "delta", "type": "quantitative", "label": "Signed Delta", "format": "number"},
                        {"field": "iv", "type": "quantitative", "label": "IV", "format": "percent"},
                        {"field": "dte", "type": "quantitative", "label": "DTE", "format": "number"},
                        {"field": "greeks_status", "type": "text", "label": "Evidence"},
                    ],
                },
                "yAxisTitle": "|Delta|",
                "valueFormat": "number",
                "layout": "full",
                "palette": {"kind": "identity", "name": "blue"},
                "referenceLines": [
                    {"axis": "y", "value": 0.25, "label": "Current Middle cap", "color": "neutral", "lineStyle": "dashed"}
                ],
                "labels": {"values": "all"},
                "settings": {"sort": "descending", "showValues": True},
            }
        ],
        "tables": [
            {
                "id": "entry_detail",
                "title": "Entry reconstruction",
                "subtitle": "Ten visible CSP openings from July 30 to August 5, 2026; TSM Greeks unavailable.",
                "dataset": "entries",
                "sourceId": "entry_reconstruction",
                "defaultSort": {"field": "trade_date", "direction": "asc"},
                "density": "dense",
                "layout": "full",
                "columns": [
                    {"field": "contract", "label": "Contract", "type": "text"},
                    {"field": "trade_date", "label": "Entry date", "type": "text"},
                    {"field": "fill", "label": "Credit", "format": "currency"},
                    {"field": "dte", "label": "DTE", "format": "number"},
                    {"field": "delta", "label": "Delta", "format": "number"},
                    {"field": "iv", "label": "IV", "format": "percent"},
                    {"field": "entry_yield", "label": "Entry yield", "format": "percent"},
                    {"field": "collateral", "label": "Collateral", "format": "currency"},
                    {"field": "greeks_status", "label": "Evidence", "type": "text"},
                ],
            },
            {
                "id": "exit_detail",
                "title": "Profit-taking reconstruction",
                "subtitle": "Six August 7 closings; four have exact visible entry pairs and two use inferred entry credits.",
                "dataset": "exits",
                "sourceId": "exit_reconstruction",
                "defaultSort": {"field": "gross_capture", "direction": "desc"},
                "density": "spacious",
                "layout": "full",
                "columns": [
                    {"field": "contract", "label": "Contract", "type": "text"},
                    {"field": "entry_credit", "label": "Entry credit", "format": "currency"},
                    {"field": "exit_debit", "label": "Close debit", "format": "currency"},
                    {"field": "gross_capture", "label": "Gross capture", "format": "percent"},
                    {"field": "net_profit", "label": "Displayed profit", "format": "currency"},
                    {"field": "holding_days", "label": "Days", "format": "number"},
                    {"field": "pair_status", "label": "Pair status", "type": "text"},
                ],
            },
            {
                "id": "method_comparison",
                "title": "Leo versus the current Weekly CSP method",
                "subtitle": "Differences in entry risk, coverage, exit behavior, and assignment handling.",
                "dataset": "comparison",
                "sourceId": "method_comparison",
                "defaultSort": {"field": "dimension", "direction": "asc"},
                "density": "spacious",
                "layout": "full",
                "columns": [
                    {"field": "dimension", "label": "Dimension", "type": "text"},
                    {"field": "leo", "label": "Leo", "type": "text"},
                    {"field": "current", "label": "Current method", "type": "text"},
                    {"field": "implication", "label": "Implication", "type": "text"},
                ],
            },
        ],
        "sources": [
            {"id": source["id"], "label": source["label"], "path": source["path"]}
            for source in sources
        ],
        "blocks": [
            {"id": "title", "type": "markdown", "body": "# Leo Cash-Secured Put 交易重建"},
            {
                "id": "executive_summary",
                "type": "markdown",
                "body": "## Executive Summary\n\n- **Entry 並非固定低 Delta。** 9 筆可估交易的中位數約 -0.346，8/9 比目前 Middle case 的 |Delta| 0.25 上限更進取。\n- **可見 10 筆 CSP 需要 $297,250 collateral。** 納入隱藏 entry、INTC assignment 與裁切的 340P，較可能峰值約 $383,750–$417,750；保留 10%–20% buffer 時，帳戶 cash 約 $460k–$520k。\n- **單筆 entry yield 中位數 2.53%，collateral-weighted 為 2.00%。** Gross deployed-capital pace 約 56.2% simple annualized，但 winner-only 截圖不足以推論真實 account annual return。\n- **Profit-taking 約 94%–98%，而非 70%–80%。** 四組 exact pairs 的 weighted gross capture 為 97.0%。",
            },
            {
                "id": "delta_finding",
                "type": "markdown",
                "body": "## Strike selection 明顯更靠近 ATM\n\n下圖把 9 筆可估 entry 的 absolute Delta 與你目前 Middle-case 上限 0.25 放在同一尺度。只有 SPCX 103P 明確通過；SPCX 100P 在模型誤差邊界，其餘皆更進取。這提高 premium，也提高 assignment、短 gamma 與 gap risk。",
            },
            {"id": "delta_chart", "type": "chart", "chartId": "entry_delta", "layout": "full"},
            {
                "id": "greeks_note",
                "type": "markdown",
                "body": "## Entry Greeks 應分成 observed 與 estimated\n\nNVDA 195P、PLTR 122P、SPCX 103P 有同合約近時點 archive；其餘多為 fill + underlying snapshot 的 Black–Scholes reconstruction。TSM 不在 watchlist，少了 entry spot price，無法提供可信單點 Delta/IV。IV 是 absolute implied volatility，不是 IV Rank / Percentile。",
            },
            {"id": "entry_table", "type": "table", "tableId": "entry_detail", "layout": "full"},
            {
                "id": "capital_return",
                "type": "markdown",
                "body": "## 資本與報酬：headline annualization 需要降溫\n\n10 筆可見 opening 收取 $5,959 gross premium、占用 $297,250 strike collateral；capital-weighted DTE 為 13.0 天。按 collateral-days 年化的 gross premium pace 為 56.2%，但 3–4 DTE trades 會製造 395%–417% 的誤導性單筆年化。最合理的風格推論是每筆約 2%–4% premium/collateral；真實 account return 仍需 losing trades、idle cash、assignment drawdown 與未平倉部位。",
            },
            {
                "id": "exit_finding",
                "type": "markdown",
                "body": "## 平倉邏輯接近 95%+ premium capture\n\n四筆 exact pairs 的 gross capture 為 93.7%–98.1%，weighted average 97.0%。另外兩筆 inferred pairs 約 94.0% / 96.5%。這更像等待 buy-to-close debit 降至 $0.10–$0.35，而不是在 70%–80% 固定停利；多拿最後一小段 premium 的同時，也保留了更多 tail risk。",
            },
            {"id": "exit_table", "type": "table", "tableId": "exit_detail", "layout": "full"},
            {
                "id": "comparison_finding",
                "type": "markdown",
                "body": "## 相對現行方法：更進取、覆蓋更長、退出更晚\n\n你目前方法在 Delta 與 liquidity 上更保守，也較早回收 tail risk；但 10-DTE archive 上限會漏掉 15–18 DTE entry，`ivPercentile` 亦仍是 current-IV proxy。Leo 的行為較接近 aggressive / wheel-ready CSP，不宜直接併入 Best case。",
            },
            {"id": "comparison_table", "type": "table", "tableId": "method_comparison", "layout": "full"},
            {
                "id": "recommendations",
                "type": "markdown",
                "body": "## Recommended next steps\n\n1. 保留低-Delta Best case，另建 `Aggressive / Wheel-ready` scenario（約 -0.25 至 -0.45）。\n2. Archive 抓取擴至至少 21 DTE，UI filters 仍可保留 1–10 / 1–14。\n3. 新增真正的 `credit / strike` 門檻，並與 break-even distance、Delta、liquidity 一起判斷。\n4. Exit tracker 同時記錄 50% / 80% / 90% / 95% milestones、MAE 與 assignment outcome。\n5. Dashboard 增加 portfolio collateral、單一 ticker 上限與 tech-factor concentration。",
            },
            {
                "id": "further_questions",
                "type": "markdown",
                "body": "## Further questions\n\n- TSLA 300P 與 AVGO 365P 的實際 entry date、fill、Delta/IV 是多少？\n- Aug 5 裁切的 340P ticker 是什麼？\n- INTC assignment 後 shares 是否仍持有，是否已有 covered call？\n- 是否能取得至少一個完整月份的所有 winners、losers、assignment 與 unrealized P&L？",
            },
            {
                "id": "caveats",
                "type": "markdown",
                "body": "## Caveats and assumptions\n\nTrades 按 ET、archive 按 SGT 對時。Black–Scholes 使用 4% risk-free rate 與簡化 dividend assumptions，不等同 broker 原始 Greeks。30-minute snapshots 在快速行情中會有誤差。Screenshots 有 winner-selection bias；所有 annualization 都是 simple annualization，不包含 compounding、tax、idle cash 或 tail loss。本報告不是 investment advice。",
            },
        ],
    },
    "snapshot": {
        "version": 1,
        "generatedAt": GENERATED_AT,
        "status": "ready",
        "datasets": {
            "entry_delta": sorted(delta_rows, key=lambda row: row["abs_delta"], reverse=True),
            "entries": entry_rows,
            "exits": exit_rows,
            "comparison": comparison_rows,
        },
    },
    "sources": sources,
    "package_info": {
        "root": "analysis/leo-csp-review-2026-08",
        "manifestPath": "artifact.json",
        "snapshotPath": "artifact.json",
    },
}

(HERE / "artifact.json").write_text(
    json.dumps(artifact, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(HERE / "artifact.json")
