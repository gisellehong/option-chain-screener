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
```

## Massive API Timing

現在不需要立刻付費。建議流程：

1. 先用 mock data 確認 dashboard、欄位、score 和排序邏輯。
2. 要開始 API smoke test 時，註冊 Massive free account 並把 API key 放進 `.env`。
3. Free tier 被 rate limit 或欄位權限卡住時，再升級到 `Options Starter`。
4. 若 Weekly CSP 要用於接近盤中實盤決策，再評估 `Options Advanced`，因為 real-time quotes 對 bid/ask spread 更重要。

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
