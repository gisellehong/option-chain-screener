# 股票選擇權交易工作台 · Stock Options Trading Desk

新版以三個區塊組織：

1. **Screener**：預設 SOXL 保守 CSP；比較履約價、風險與 Bid 收益，含口數／完整接股現金檢查。LEAPS、Weekly CSP 保留為舊版研究。
2. **第三方 Tracker**：老 K SOXL 推薦與 AAG，保留訊號來源，不混入個人實現損益。
3. **自己的 P&L**：股票／ETF 選擇權私人帳本，按帳戶、標的與狀態檢視；Patrick GMP 無來源時保持待資料。

ES futures options、2025 ES 績效、Leo 研究不在本版範圍。

## 規則與證據

預設集中於 `config/screeners.json`；前端與 Python 排程都使用 `src/lib/scoring.ts`，經 `scripts/score-options.mjs` 共用計算。UI 自訂門檻只留在當次 session。SOXL 預設 Risk first v1 與老 K Reference 分列；v1 尚需前推驗證，不能把低 Delta 或歷史 ITM 比例解讀為保證不被指派。

完整分支盤點、整合處置與資料口徑見 [整合紀錄](analysis/dashboard-restructure-2026-09-07.md)。

## 私人帳本

Google Sheets connector 讀取 `Tracker` 的 `A1:AT400`，使用 `UNFORMATTED_VALUE`；當資料超過此範圍時應延伸並確認最後交易列。將回傳值存為本機 `data/private/google-sheet.local.json`，結構為 `{fetchedAt, spreadsheetUrl, tracker: {values: [...]}}`，再執行：

```bash
npm run import:ledger -- data/private/google-sheet.local.json
npm run dev
```

正規化輸出 `data/private/ledger.local.json`。此目錄被 Git 忽略，不進入公開 bundle。本機開發版自動讀取一次快照；線上靜態版可匯入正規化 JSON，僅儲存在當前瀏覽器。尚未建立 Google Sheet 持續自動同步。匯入 schema 可參考 `LedgerTrade`（`src/features/Portfolio.tsx`）；請勿將私人檔案複製到 `src/` 或 `public/`。

帳本保留 Sheet Closed Profit、券商核對差額、轉倉群組與來源列。未實現僅包含有精確合約報價的部位，CC 不含正股腿。帳戶淨值 NLV 與股票選擇權損益不同，這裡不混算。

## 驗證

```bash
npm ci
npm test
npm run validate:lao-k
npm run build
```

老 K 驗證腳本是 Reference 歷史推薦重現，不是 v1 勝率。SOXL v1 排程採同紐約交易日／版本／合約去重與 Bid → Ask 達標觀察；舊策略保持 Mid 假設。

## Local Commands

```bash
npm install
npm run dev
npm run build
npm run fetch:watchlist-news
npm run fetch:gex -- SPX
npm run fetch:moomoo -- AAPL AMD NVDA TSLA MSFT SMH
npm run snapshot -- --session pre_market
npm run snapshot -- --session half_hourly
npm run report:telegram -- --session pre_market
```

## GitHub Pages

This app can be deployed as a static GitHub Pages site. The deployed page shows the latest committed `src/data/generated/realOptions.json`; GitHub Pages does not call moomoo OpenD directly.

Deployment flow:

```bash
npm run fetch:moomoo -- AAPL AMD NVDA TSLA MSFT SMH
npm run build
git add src/data/generated/realOptions.json src/data/generated/realOptions.meta.json
git commit -m "Update moomoo screener data"
git push origin main
```

After pushing, GitHub Actions runs `.github/workflows/deploy-pages.yml` and publishes `dist/` to Pages.

Local scheduled snapshots can also publish fresh generated data automatically. Set this in `.env`:

```bash
AUTO_PUBLISH_GITHUB=true
GITHUB_PUBLISH_BRANCH=main
```

When enabled, successful non-`--skip-fetch` snapshot runs will commit and push only:

- `src/data/generated/realOptions.json`
- `src/data/generated/realOptions.meta.json`
- `src/data/generated/tracking.json`
- `src/data/generated/gex.json`
- `src/data/generated/gex-SOXL.json`
- `src/data/generated/watchlistNews.json`
- `data/youtuber-trades/lifecycle.json`
- `data/soxl-trades/lifecycle.json`

Publishing uses an isolated temporary worktree based on `GITHUB_PUBLISH_BRANCH`
(default: `main`). Lifecycle files are rebuilt inside that worktree from the canonical
trade tables on the target branch, using the local archived snapshots. This keeps
scheduled snapshots from reverting manually maintained trades when another feature
branch happens to be checked out locally.

GitHub Actions then rebuilds and redeploys the GitHub Pages dashboard. Other local code or config edits are not included in those automatic data commits.

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

SPX GEX data is refreshed from InsiderFinance during scheduled snapshots and written to
`src/data/generated/gex.json`, with timestamped local archives under `data/gex/`.
SOXL GEX data is written to `src/data/generated/gex-SOXL.json`.
You can refresh them manually:

```bash
npm run fetch:gex -- SPX
npm run gex:update -- SPX --send-telegram
npm run gex:update -- SOXL --send-telegram
```

Run a session snapshot manually:

```bash
npm run snapshot -- --session pre_market
npm run snapshot -- --session half_hourly
npm run snapshot -- --session pre_close
npm run snapshot -- --session close
```

The snapshot runner:

- Reads the combined watchlist.
- Calls the moomoo fetcher unless `--skip-fetch` is passed.
- Updates `src/data/generated/realOptions.json`.
- Writes `src/data/generated/realOptions.meta.json` for the Dashboard.
- Updates `src/data/generated/tracking.json` with compact screener signals and outcomes.
- Refreshes `src/data/generated/gex.json` from InsiderFinance unless `--skip-gex` is passed.
- Refreshes `src/data/generated/watchlistNews.json` from English Yahoo Finance RSS unless `--skip-news` is passed.
- Sends SPX GEX Telegram updates from the scheduler every 30 minutes during regular trading hours and every 60 minutes during SPX's near-24x5 week.
- Sends SOXL GEX Telegram updates at 09:00 ET, every 30 minutes from 09:30 through 15:30 ET, and once at 16:00 ET.
- Archives a local snapshot under `data/snapshots/`.
- Writes a Markdown session report under `data/reports/`.

Send the latest generated data to Telegram:

```bash
npm run report:telegram -- --session pre_market
```

Refresh only the Watchlist news feed:

```bash
npm run fetch:watchlist-news
```

Telegram requires `.env` values:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
GEX_TELEGRAM_BOT_TOKEN=...
GEX_TELEGRAM_CHAT_ID=...
GEX_TICKER=SPX
DASHBOARD_URL=https://gisellehong.github.io/option-chain-screener/
AUTO_PUBLISH_GITHUB=true
```

`GEX_TELEGRAM_*` is optional. When it is blank, GEX updates reuse the existing `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, so the same Option Pro channel receives both option snapshots and GEX messages. Add a separate GEX bot/channel later by filling those two variables.

For dry runs without calling OpenD:

```bash
npm run snapshot -- --session manual --skip-fetch
```

## macOS Auto Schedule

The scheduler is installed as a user LaunchAgent. Launchd wakes it every 5 minutes; `scripts/run-due-snapshot.py` then checks New York time and only runs once for each due session.

Configured session times:

- `pre_market`: 09:00 ET.
- `half_hourly`: every 30 minutes from 09:30 through 15:00 ET.
- `pre_close`: 15:30 ET.
- `close`: 16:00 ET.

Install or update the scheduler:

```bash
npm run scheduler:install
```

Check status:

```bash
npm run scheduler:status
```

Stop and remove it:

```bash
npm run scheduler:uninstall
```

Logs are written to `data/logs/`, and run state is stored under `data/scheduler/`.

### Signal tracking

Each scheduled snapshot records the top ranked matched contracts as compact signals in `src/data/generated/tracking.json`.

- Weekly CSP outcome tracks whether the contract can be bought back at or below 20% of entry credit, which marks 80% premium capture within the next five days.
- LEAPS outcome tracks mark-to-market option return, underlying return, relative return, delta drift, and IV change.
- Full raw option-chain archives remain local under `data/snapshots/`; the publishable dashboard reads only the compact generated tracking file.

目前 moomoo fetcher 會：

- 用 `get_option_expiration_date` 找 weekly CSP 與 LEAPS 目標到期日。
- 用 `get_option_chain` 取合約代碼並先依 strike range 粗篩。
- 強制保留 `data/youtuber-trades/trades.json` 內仍有效的 AAG tracked contracts，即使合約位於 screener 的一般 strike range 之外。
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
