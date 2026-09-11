# 股票選擇權交易工作台 · Stock Options Trading Desk

新版以三個區塊組織：

1. **Screener**：預設 SOXL 保守 CSP；比較履約價、風險與 Bid 收益，含口數／完整接股現金檢查。LEAPS、Weekly CSP 保留為舊版研究。
2. **第三方 Tracker**：LaoK Wiki 每日推薦 × Screener 比對，以及 AAG，保留訊號來源，不混入個人實現損益。
3. **自己的 P&L**：股票／ETF 選擇權私人帳本，按帳戶、標的與狀態檢視；Patrick GMP 無來源時保持待資料。

ES futures options、2025 ES 績效、Leo 研究不在本版範圍。

## 規則與證據

預設集中於 `config/screeners.json`；前端與 Python 排程都使用 `src/lib/scoring.ts`，經 `scripts/score-options.mjs` 共用計算。UI 自訂門檻只留在當次 session。SOXL 預設 Risk first v1 與舊版老 K Reference 假說分列；9 月新截圖已出現 ITM >5%、Mid 年化 <20% 等例外，Reference 不代表老 K 現行完整規則。v1 尚需前推驗證，不能把低 Delta 或歷史 ITM 比例解讀為保證不被指派。

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
- `src/data/generated/laokComparison.json`
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

## 老 K 每日比對 · Daily comparison

來源以獨立的 `/Users/patrick_giselle/Documents/llm_wiki/LaoK` 為準。人工核對的每日推薦保存在 `data/laok-reference/recommendations.json`，含來源頁、發布時間、圖片位置與 SHA-256；目前 8/24–9/10 共 13 日／54 筆。8/19 單張券商畫面另列 `otherObservations`，沒有可見 Bid/Ask，不混入每日五選。

```bash
npm run compare:laok
# Wiki 位於別處時：
npm run compare:laok -- --wiki /absolute/path/to/LaoK
```

輸出 `analysis/laok-daily-comparison.md` 與 Dashboard 使用的 `src/data/generated/laokComparison.json`。`inventory.needs_transcription` 會指出新來源；分類成 market-note、但標題有推薦的文章也會納入檢查。必須先實際閱讀圖片，不能只看標題生成交易；不清楚的數值填 null，Bid size 不填成 traded volume。每筆推薦必須有 date、ticker、expiration、strike、optionType 與 sourceId；來源具 publishedAt 與圖片 checksum。若有完整無推薦日，仍建立 sources 項目、recommendations 保持零筆。來源異動或缺圖會停止重建，避免靜默覆蓋證據。

比對分兩層：

- **選擇差異**：發文前最近 60 分鐘內、同紐約交易日的正常交易時段快照；以 ticker / expiry / put / strike 配對，分出範圍外、缺合約、缺模型欄位、報價不可用、門檻淘汰及排序差異。老 K 沒列出的到期桶不能推定已被拒絕。截圖時間未知，所以時間對齊只是近似。
- **結果差異**：同標的／到期、相同快照用 Bid 開倉及 Ask 回購的紙上估值，以 strike collateral 正規化。保留 1／3／5 個有共同報價的觀察交易日、80% capture 首次觀察及最差現金報酬；資料缺日不能視為連續交易日。無報價／無平倉／無結算資料保持未知，不把 ITM probability、入選比例或未實現浮盈當成勝率。

既有 `npm run snapshot` 每次**成功重新抓取**後，會以 `--snapshot` 自動保存篩選結果、完整 config、策略版本與 code/config hash 至本機 `data/laok-comparison/decisions/`；同一快照不能覆寫。只有 recordedAt 早於發布、且原快照 checksum 仍一致才算 frozen forward decision。過去沒有凍結紀錄的資料一律標示目前規則回放，不能稱為當時的真實選擇。`--skip-fetch` 不建立前推決策；舊 archives 沒有 quote-level 時間與 freshness 標記，僅供有此限制的回放。快取和決策留在本機，不進公開 bundle。

Fetcher 會保留仍未到期的 LaoK 參考合約與凍結 picks，即使已落在一般 strike range 外；NBIS / LITE 也會補報價。這是結果追蹤，不會自動把它們加入 SOXL 篩選 Universe，也不套用 SOXL 專屬的 historical probability model。資料訂閱不可用時，報價缺口保持可見。

Codex 每日追蹤於新加坡時間 12:30 檢查新截圖、核對转錄、更新比對；每週五檢查是否需要新 shadow experiment。既有 LaunchAgent 繼續取得盤中快照。電腦、Codex 排程環境及 OpenD 需可用；不會因本流程自行發 Telegram、commit、push 或部署。2026-09-11 起線上 GitHub Pages 包含此功能；每日比對更新後，下一次既有成功行情發布會一併發布 laokComparison.json。

Fine-tuning 先區分模仿（selection fidelity）與改善（risk-adjusted outcomes）。9 月資料已有舊假說反例，故保留現行 Risk first 風控，候選變更先凍結成獨立版本，在後續交易日驗證，不能用調參過的同一批截圖宣稱 out-of-sample 成功，也不能把多個同日 SOXL 部位當成獨立樣本。

### 老 K 資料覆蓋擴展（2026-09-11）

資料收集與策略門檻分離：SOXL、NBIS、LITE 與 LaoK 推薦檔新增的股票，提前收集 0–63 DTE 所有掛牌到期日的 Put，履約價為當時股價的 40%–110%。已推薦／凍結合約無論是否超出範圍均持續追蹤至到期。SOXL 策略仍維持原有 42 天與風控條件；其他觀察股票不會自動進入 SOXL 策略。

合約定義快取於本機 `data/option-inventory/`，每個紐約交易日期首次抓取與中午 12:00 後首次抓取更新。行情每次重新請求，正常交易時段每 15 分鐘排程一次；新增的 15／45 分觀察不發 Telegram，也不追加新聞／GEX 更新。排程仍依賴本機在線、OpenD 登入及現有工作鎖，15 分鐘是目標頻率，並非資料完整性的保證。

每次抓取輸出 `.coverage.json` 本機旁檔，記錄合約清單、請求／回傳／可用數量及耗時，並隨成功快照封存。每日比對區分未納入抓取、已請求未回傳、合約清單未列出、報價或必要欄位不完整、缺模型欄位。歷史快照沒有 audit 時保留原因未知，不以今日行情補寫歷史。不把 API 成功當成報價時間新鮮的保證。
