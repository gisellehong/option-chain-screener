# Option Chain Screener

本專案是用來取代手動調整 Moomoo/Futubull options screener 的本地 MVP。資料源已固定為 moomoo OpenD live data，並保留 mock data 作為 UI / 離線開發用途。

第一版先以兩個策略為核心：

- `Deep ITM LEAPS Call`: 尋找可替代正股持倉的深度價內 LEAPS Call。
- `IV Expansion for Weekly CSP`: 尋找高 IV、短天期、流動性足夠的 Weekly Cash Secured Put。

## MVP Scope

- Strategy configs: 把篩選條件集中在 `src/data/screenerConfigs.ts`。
- Scenario filters: 每個策略同時有 `Best case` 和 `Middle case`，Dashboard 會同時呈現兩組結果。
- Scoring engine: 由 `src/lib/scoring.ts` 計算衍生欄位、filter pass/fail 和 score。
- Dashboard: 顯示 overview、filter rail、candidate table、contract detail、warnings 和 CSV export。
- Data source: moomoo OpenD live snapshot，輸出到 `src/data/generated/realOptions.json`。

## Screener Scenarios

每個 screener strategy 不再只有一組 fixed filters，而是同時顯示兩個 scenario：

- `Best case`: 嚴格條件，用來找最接近理想交易結構的候選。
- `Middle case`: 放寬後的次要選擇，用來找還值得研究、但不完全符合最佳條件的候選。

Dashboard 每個 scenario 都有 `Adjust filters` 區塊，可以直接在 UI 修改 min/max threshold，結果會即時重算。這些 UI 調整目前只保留在當次 session；要改預設值時，再更新 `src/data/screenerConfigs.ts` 裡對應 strategy 的 `scenarios`。

## Local Commands

```bash
npm install
npm run dev
npm run build
npm run fetch:moomoo -- AAPL AMD NVDA TSLA MSFT SMH
npm run snapshot -- --session pre_market
npm run report:telegram -- --session pre_market
```

## GitHub Pages

This app can be deployed as a static GitHub Pages site. The deployed page shows the latest committed `src/data/generated/realOptions.json`; GitHub Pages does not call moomoo OpenD directly.

Deployment flow:

```bash
npm run fetch:moomoo -- AAPL AMD NVDA TSLA MSFT SMH
npm run build
git add .
git commit -m "Update moomoo screener data"
git push origin main
```

After pushing, GitHub Actions runs `.github/workflows/deploy-pages.yml` and publishes `dist/` to Pages.

## Moomoo OpenD Data Source

moomoo API 需要先啟動並登入 OpenD gateway；它不是單純 REST API。資料流程會用 Python SDK 連到 OpenD，批量抓取 option chain，再用 market snapshot 補 bid/ask、Greeks、IV、OI、volume 和 underlying price，最後寫入 `src/data/generated/realOptions.json`。

首次使用：

```bash
python3 -m pip install moomoo
npm run fetch:moomoo -- AAPL AMD NVDA TSLA MSFT SMH
```

OpenD host/port 可用環境變數覆蓋：

```bash
MOOMOO_OPEND_HOST=127.0.0.1 MOOMOO_OPEND_PORT=11111 npm run fetch:moomoo -- AAPL
```

## Scheduled Snapshots and Telegram Reports

Watchlists live in `config/watchlists.json` and are split by strategy:

- `leaps`: long-term deep ITM call universe.
- `weekly_csp`: short-dated cash-secured put universe.

Run a session snapshot manually:

```bash
npm run snapshot -- --session pre_market
npm run snapshot -- --session open_30m
npm run snapshot -- --session hourly
npm run snapshot -- --session pre_close
```

The snapshot runner:

- Reads the combined watchlist.
- Calls the moomoo fetcher unless `--skip-fetch` is passed.
- Updates `src/data/generated/realOptions.json`.
- Writes `src/data/generated/realOptions.meta.json` for the Dashboard.
- Archives a local snapshot under `data/snapshots/`.
- Writes a Markdown session report under `data/reports/`.

Send the latest generated data to Telegram:

```bash
npm run report:telegram -- --session pre_market
```

Telegram requires `.env` values:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

For dry runs without calling OpenD:

```bash
npm run snapshot -- --session manual --skip-fetch
```

目前 moomoo fetcher 會：

- 用 `get_option_expiration_date` 找 weekly CSP 與 LEAPS 目標到期日。
- 用 `get_option_chain` 取合約代碼並先依 strike range 粗篩。
- 用 `get_market_snapshot` 批量補報價與 Greeks。
- 暫時用 current IV 作為 `IV Proxy`；等累積歷史 snapshot 後再改成真正 IV percentile / IV rank。

注意事項：

- OpenD 必須已登入並完成 API questionnaire / agreement。
- 美股 options data 需要對應 OPRA / option quote right；沒有權限時 snapshot 或 subscription 可能回錯。
- `get_option_chain` 官方限制為 10 requests / 30 seconds，script 內建節流，抓多個 ticker 需要等待。

## Fine-tuning Checklist

- Universe: 決定 watchlist 是固定大型股/ETF，還是從 moomoo screener 動態找標的。
- Strategy windows: 校準 Weekly CSP 的 DTE range，以及 LEAPS 的 DTE range。
- Liquidity filters: 用 moomoo live bid/ask、OI、volume 重新調整最低流動性條件。
- Pricing quality: `moomoo_last_price_proxy` 會被排除，避免沒有 bid/ask 的合約進入候選。
- IV percentile: 累積 run history，從 `IV Proxy` 改成真正 IV percentile / IV rank。
- Scoring weights: 用實際候選清單調整 score 權重，讓排序符合交易直覺。
- Reporting: 把 matched candidates 轉成 Markdown/JSON，交給 Hermes Agent 或 Telegram bot。
