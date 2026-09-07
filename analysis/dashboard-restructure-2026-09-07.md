# 股票選擇權 Dashboard 整合紀錄（2026-09-07）

## 範圍與分支盤點

本次以最新遠端 main 為基底，依使用者要求整合歷來已提交／推送的功能，重整為 Screener、第三方 Tracker、自己的 P&L。ES／MES 期貨選擇權、2025 ES 績效與 Leo 研究不進入新版流程；歷史價格風險模型仍保留多年樣本，與交易績效期間不同。

2026-09-07 執行 fetch --all --tags，另用 HTTPS fetch 與 ls-remote --heads --tags 核對。遠端只有 main、codex/soxl-trading-dashboard、gh-pages，沒有 tags。以下是整合前凍結的 refs：

| 分支 | 提交 | 與最新 main 的關係／處置 |
|---|---|---|
| origin/main | 911bc823c74703e5520753bae6bac3ff3b6a80aa | 整合基底；保留最新 SOXL 交易、轉倉與生命周期修正 |
| 本機 main | abb50e3cf94c026292629f1e8169efd78a898eb2 | 落後 280 個提交，無獨有提交 |
| codex/soxl-trade-20260810 | 96917459a9d95398de0e2989e7cc6a25e78a4c2a | main 已涵蓋，落後 278 |
| codex/soxl-open-unrealized-pnl | 932b58d695d2017aa0cf33ce6f0095b9f30b11df | main 已涵蓋，落後 277 |
| codex/soxl-trade-20260811-102p | c7a9d2a662beafdc2afae3f0fe7ce7251bd3bc79 | main 已涵蓋，落後 276 |
| 本機／origin codex/soxl-trading-dashboard | 72b720f07dc1fc905fdb01f1396f8b816b00e231 | 原始圖譜相差 main 279／分支 49 個提交；依 patch-equivalence 與逐檔差異選擇性整合 |
| origin/gh-pages | bba000ffe57e2e32168c1e21cb1bd760621e323f | 靜態部署產物，不當作原始碼分支合併 |

分支不能整包覆蓋 main：72b720f 的 SOXL 主表較舊，會丟掉 main 的 8/14 後平倉、8/22 轉倉資料。採用 main 的 `SoxlTracker.tsx`、交易主表與 lifecycle builder，從 feature branch 收回老 K 24 筆推薦證據、SOXL 五個週五到期桶、八年 rolling-path 歷史機率、SOXL watchlist 與篩選欄位。保留 main 明確的 `openQuote !== null && openQuote.ask !== null` 檢查；不引入 feature branch 的 optional-chain 回歸。AAG 主表兩端內容相同，保留 main；其較新的隔離發布流程同樣保留。

新的整合分支：`codex/dashboard-restructure-20260907`。在獨立 worktree 完成實作後，原始工作目錄已 fast-forward 至整合後的 main。8 個原有未提交行情／lifecycle 檔案先備份及 stash，再逐位元組還原至工作目錄，並保留 stash 與備份。沒有刪除歷史分支或重寫 Git 歷史。

## 三區塊

### 1. Screener

預設 SOXL 保守 CSP，LEAPS 與 Weekly CSP 保留為舊版研究。預設 v1 採到期價內歷史比例 ≤5%、期間觸及 ≤10%、Delta −0.10 至 −0.02、OTM 20–45%、OI ≥250、相對價差 ≤25%、未來五個週五與 DTE 1–42；不強制 Mid 年化收益 ≥20%。排序先比較到期 ITM、再 Touch，才比較 Bid 收益與 OI。每个到期日最多一個合約，未通過就留白。

這是依保守偏好提出的待驗證規則，不是已證明能避免指派的策略。老 K 原始門檻另列 Reference。24 筆歷史推薦只驗證規則重現，不是 24 筆獲利、也不是新的 v1 回測。歷史 path 比例不是選擇權實際 assignment probability；樣本相互重疊且未給出信賴區間，UI 保留模型與樣本數。

`config/screeners.json` 為唯一預設；網頁與排程共用 `src/lib/scoring.ts`（Python 經 Node CLI 呼叫），避免兩套門檻分歧。UI 調整只影響當次比較，不改排程；下單前檢查仍使用預設風險門檻。

新增口數、可用現金、預估费用、既有 CSP 接股義務與到期跌幅情境。現金口徑為履約價 × 100 × 口數，不能用低 Delta 當作更多 margin 可用的理由。快照超過 24 小時會要求重查；此閾值刻意包含週末假日，並非宣称行情系統故障。

SOXL v1 前推訊號以 Bid 假設開倉、Ask 觀察平倉，同一紐約交易日／規則版本／合約只保留首次訊號，追蹤 50／70／80% 首次達標、最佳／最差觀察 capture。缺失、代理或交叉報價不產生達標；到期按紐約日期判定，settlement 保持 unverified。既有 Mid 策略不改寫為 v1，也不把訊號達標頻率稱為 winning percentage。缺漏快照仍可能漏掉盤中達標。

### 2. 第三方 Tracker

老 K SOXL 推薦與 AAG 分開來源。老 K 顯示原始日期、合約與風險／收益證據；沒有完整開平倉資料時不計實現損益。AAG 保留既有 Greeks／報價路徑與來源。第三方訊號不計入個人 P&L，Leo 不在導覽或新資料流程中。

### 3. 自己的 P&L

私人 Google Sheet 快照由 `scripts/import-option-ledger.mjs` 正規化，支援 Giselle、Ludi 及 Patrick GMP 帳戶標籤。匯入會排除期貨及第三方 Rich，對齊既有核對紀錄、重算 DTE、標示金額差異與重複列；不自動刪除可能是分批交易的資料。保留轉倉舊倉虧損，不用新倉權利金抵銷已實現虧損。實現損益依 Sheet Closed Profit 口徑，不另扣一次費用。

私人原始快照與正規化帳本置於被 Git 忽略的 `data/private/`；開發伺服器只在 loopback 提供帳本，靜態公開網站不內嵌私人帳本。線上版使用者可自行匯入 normalized JSON，僅儲存在當前瀏覽器。這次是已驗證的一次同步，不是 Google Sheet 自動持續同步。

Patrick GMP 尚未取得來源，顯示待資料而非零損益。未實現損益只加總有精確合約報價的部分並顯示覆蓋率，缺少合約行情不當成零。CC 只計選擇權腿，未納入正股成本；不使用含 ES 的 NLV_Weekly 計算股票策略帳戶報酬。來源列 ID 對應當次 Sheet 列號，未聲稱為券商永久交易 ID。

## 驗證與操作

- `npm test`：Node 6 項、Python 5 項，含風險門檻、共用引擎、資料排除、DTE、重複列／轉倉對帳、Bid/Mid 相容性、缺失報價與時區。
- `npm run build`：TypeScript 與 production build。
- `npm run validate:lao-k`：24 筆 Reference 推薦規則回放（16 校準／8 樣本外），不代表新 v1 績效。
- 本機瀏覽器確認三區塊、私人帳本讀取及待資料狀態。
- 尚未用新規則執行真實 OpenD 抓取或發送 Telegram；既有自動排程仍使用原來路徑，該路徑已更新至 main 的新版程式，私人帳本也已複製至其忽略目錄。

## 參考連結

- [Moomoo OpenAPI — Get Option Chain（英文）](https://openapi.moomoo.com/moomoo-api-doc/en/quote/get-option-chain.html)：官方標示的 option-chain 標的範圍為港／美股與指定指數，未列 ES futures options。一般 futures 報價支援不能推論為 ES options chain 支援；因此本版不依賴 ES。
- [Moomoo OpenAPI — Quote Overview（英文）](https://openapi.moomoo.com/moomoo-api-doc/en/quote/overview.html)
