# Option Chain Screener

本專案是用來取代手動調整 Moomoo/Futubull options screener 的本地 MVP。第一版先以兩個策略為核心：

- `Deep ITM LEAPS Call`: 尋找可替代正股持倉的深度價內 LEAPS Call。
- `IV Expansion for Weekly CSP`: 尋找高 IV、短天期、流動性足夠的 Weekly Cash Secured Put。

## MVP Scope

- Strategy configs: 把篩選條件集中在 `src/data/screenerConfigs.ts`。
- Scoring engine: 由 `src/lib/scoring.ts` 計算衍生欄位、filter pass/fail 和 score。
- Dashboard: 顯示 overview、filter rail、candidate table、contract detail、warnings 和 CSV export。
- Data source: 預設使用 mock data，Massive API adapter 已先建立在 `src/api/massiveClient.ts`。

## Local Commands

```bash
npm install
npm run dev
npm run build
npm run smoke:massive -- AAPL
npm run fetch:real -- AAPL AMD
```

## Massive API Timing

現在不需要立刻付費。建議流程：

1. 先用 mock data 確認 dashboard、欄位、score 和排序邏輯。
2. 要開始 API smoke test 時，註冊 Massive free account 並把 API key 放進 `.env`。
3. Free tier 被 rate limit 或欄位權限卡住時，再升級到 `Options Starter`。
4. 若 Weekly CSP 要用於接近盤中實盤決策，再評估 `Options Advanced`，因為 real-time quotes 對 bid/ask spread 更重要。

## Massive Starter Findings

`Options Starter` 已可讀取 option snapshot endpoint，包含 contract details、Greeks、implied volatility、open interest、day OHLCV 和 underlying ticker。Starter 目前沒有 options quote/trade entitlement；`last_quote`、bid/ask、last trade endpoint 會缺失或回 403。只訂 Options plan 時，stock snapshot 也會回 403，因此 underlying price 需要用其他資料源、Stocks plan，或暫時用外部/手動 price feed 補齊。

## Real Data MVP Strategy

目前 real-data MVP 使用 Massive Options Starter + Nasdaq no-key quote endpoint：

- Massive: option snapshot、Greeks、IV、OI、option day OHLCV。
- Nasdaq: underlying stock/ETF last sale price。
- Bid/ask: Starter 沒有 quote entitlement，暫時用 option day close 作為 price proxy。
- IV Percentile: Massive 不直接提供，暫時用 current IV 作為 proxy；之後累積歷史 snapshot 後再改成真正 percentile。

產生 real data：

```bash
npm run fetch:real -- AAPL AMD NVDA TSLA MSFT SMH
```

輸出檔案會寫到 `src/data/generated/realOptions.json`，Dashboard 會自動啟用 Real data mode。

`.env` example:

```bash
VITE_MASSIVE_API_KEY=your_key_here
VITE_DATA_SOURCE=mock
```

## API Notes

Massive option chain snapshot 可對應 Greeks、implied volatility、open interest、bid/ask、last trade、underlying price 等欄位。`IV Percentile`、market cap、sector、earnings date、day change 這類欄位可能需要從其他 endpoint、外部資料或本地歷史累積計算取得。

## Automation Roadmap

- Daily report: 把 matched candidates 轉成 Markdown/JSON，交給 Hermes Agent 或 Telegram bot。
- Scheduled job: 先用本地 cron 或 launchd；等資料流程穩定後再接 Codex automation/thread wakeup。
- Run history: 儲存每日 screener results，用於新增/移除標的、IV percentile 和回測。
