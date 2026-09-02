# Leo Cash-Secured Put 交易重建報告

## Executive Summary

- **他的 entry 並不是固定低 Delta。** 9 筆可估交易的中位數約為 **-0.346 Delta**，範圍約 **-0.225 至 -0.446**；其中 8/9 筆比你目前 `Middle case` 的 `-0.25` 上限更進取。TSM 因本地沒有 underlying snapshot，無法可靠回推出單一 Greeks。
- **他較像追求 premium/collateral yield，而不是只做高 IV。** 10 筆可見 CSP 共收取 **$5,959 gross premium**、需要 **$297,250 strike collateral**，加權 entry yield 為 **2.00%**，單筆中位數為 **2.53%**。可估 IV 從 SPY 的 **15.5%** 到 SPCX 的 **220.8%**，不是統一的高 IV 門檻。
- **可見部位顯示至少約 $384k–$418k 的峰值資本需求。** 僅 10 筆可見開倉即需 $297,250；再加 Aug 7 平倉但 entry 未出現在截圖的 TSLA/AVGO（$66,500）、INTC assignment（$20,000），以及可能重疊的裁切 340 Put（$34,000），合理區間為 **$383,750–$417,750**。若保留 10%–20% cash buffer，帳戶現金較可能在 **$460k–$520k**，但這不是可直接觀察的 account balance。
- **他的獲利平倉不是 70%–80%，而是接近榨乾 premium。** 4 組可精確配對的 entry/exit，gross premium capture 為 **93.7%–98.1%**，加權平均 **97.0%**、中位數 **97.5%**。另外兩筆只可反推 entry credit 的 TSLA/AVGO，亦約為 **94.0% / 96.5%**。

## 1. Entry Greeks：大多數 strike 比你目前方法更靠近 ATM

### 口徑

- **Observed nearby snapshot**：同一張合約在成交前後 20 分鐘內有 Moomoo archive，直接採其 Greeks。
- **Black–Scholes estimate**：該合約未被 archive，但同 ticker 的 underlying 有快照；用截圖 fill price 反推 implied volatility（IV），再計算 Delta。
- **Model range**：成交發生在快速跳空時段，鄰近快照不能合理 bracket 成交，改給敏感度區間。
- **Unavailable**：沒有足夠 underlying price，不提供虛假單點值。

> IV 是 annualized implied volatility；不是 IV Rank / IV Percentile。你目前資料中的 `ivPercentile` 實際仍是 `current_iv_proxy`。

| Entry（ET） | Contract | Fill | DTE | Delta | IV | 證據狀態 |
|---|---|---:|---:|---:|---:|---|
| Jul 30 10:08 | NVDA Aug 14 190P | $4.17 | 15 | **-0.346** | **42.9%** | Black–Scholes estimate；underlying 約 $195.65 |
| Jul 30 10:07 | SPY Aug 14 730P | $5.73 | 15 | **-0.356** | **15.5%** | Black–Scholes estimate；underlying 約 $737.28 |
| Jul 30 10:07 | NVDA Aug 7 195P | $4.60 | 8 | **-0.446** | **42.9%** | Observed，成交後 6.4 分鐘 |
| Jul 30 10:06 | QQQ Aug 14 660P | $7.06 | 15 | **-0.286** | **27.7%** | Black–Scholes estimate；underlying 約 $679.43 |
| Aug 3 15:00 | PLTR Aug 7 122P | $5.28 | 4 | **-0.391** | **135.9%** | Observed，成交前 13.0 分鐘 |
| Aug 3 12:37 | TSM Aug 14 390P | $8.46 | 11 | — | — | **Unavailable**；TSM 不在本地 watchlist |
| Aug 3 10:49 | TSLA Aug 21 310P | $8.37 | 18 | **-0.361** | **45.1%** | Black–Scholes estimate；underlying 約 $319.05 |
| Aug 3 09:40 | MRVL Aug 14 172.5P | $8.40 | 11 | **-0.319** | **111.8%** | Black–Scholes estimate；underlying 約 $185.42 |
| Aug 4 10:16 | SPCX Aug 7 103P | $3.53 | 3 | **-0.225** | **220.8%** | Observed，成交後 2.2 分鐘 |
| Aug 5 09:31 | SPCX Aug 14 100P | $3.99 | 9 | **-0.254** | **131.2%** | Model point；合理範圍 Delta -0.299 至 -0.232、IV 111%–143% |

**解讀：**這 9 筆可估交易沒有任何一筆接近你 `Best case` 的 `-0.12 至 0`。只有 SPCX 103P 明確落在 `Middle case` 的 `-0.25 至 -0.03`；SPCX 100P 位於邊界且模型誤差可使它通過或失敗。其餘交易明顯更接近 ATM，因此 premium 高，但被 assignment 或短期反向波動擊中的機率也更高。

TSM 的敏感度足以說明為何不能硬填一個 Greeks：若 entry underlying 是 $400、$410、$420、$430，模型分別約為 Delta `-0.36 / -0.30 / -0.25 / -0.22`，IV 約 `47% / 60% / 71% / 82%`。少一個 spot price，結論可以跨越你的整個風險分層。

## 2. 資金估算：實際 cash 很可能在 $400k 以上

### 可見 10 筆 CSP 的 strike collateral

| 開倉日 | 新增 CSP collateral | 累積可見 collateral（假設未提前關倉） |
|---|---:|---:|
| Jul 30 | $177,500 | $177,500 |
| Aug 3 | $99,450 | $276,950 |
| Aug 4 | $10,300 | $287,250 |
| Aug 5 | $10,000 | **$297,250** |

Aug 7 的 profit screenshot 另顯示兩張沒有對應 entry 截圖的 CSP：TSLA 300P（$30,000）與 AVGO 365P（$36,500）。若它們與可見部位重疊，CSP collateral 至少 **$363,750**。Jul 25 的 INTC 100P assignment ×2 代表另有 **$20,000** 已轉為 shares；裁切的 Aug 28 340P 若也是 CSP 且同期未平倉，再加 **$34,000**。

因此可用三層估計：

1. **硬下限（hard lower bound）：$297,250**，只算清楚可見的 10 張 CSP 開倉。
2. **較可能峰值（likely peak）：$383,750–$417,750**，加入 Aug 7 已平倉的隱藏 entry、INTC assignment，以及可選的 340P。
3. **較健康的 account cash：$460k–$520k**，假設 Cash-Secured Put 不把現金使用率長期推到 100%，保留 10%–20% buffer。

這只能估資本需求，不能證明他的 broker cash balance；若使用 portfolio margin，畫面上的 buying-power requirement 也會不同。

## 3. 報酬率：單筆約 2%–2.5%，但 headline annualization 過度樂觀

報酬定義如下：

`Entry yield = premium / strike`

`Simple annualized entry yield = entry yield × 365 / DTE`

| Contract | Entry yield | Simple annualized entry yield |
|---|---:|---:|
| NVDA Aug 14 190P | 2.19% | 53.4% |
| SPY Aug 14 730P | 0.78% | 19.1% |
| NVDA Aug 7 195P | 2.36% | 107.6% |
| QQQ Aug 14 660P | 1.07% | 26.0% |
| PLTR Aug 7 122P | 4.33% | 394.9% |
| TSM Aug 14 390P | 2.17% | 72.0% |
| TSLA Aug 21 310P | 2.70% | 54.7% |
| MRVL Aug 14 172.5P | 4.87% | 161.6% |
| SPCX Aug 7 103P | 3.43% | 417.0% |
| SPCX Aug 14 100P | 3.99% | 161.8% |

整體統計：

- **單筆中位 entry yield：2.53%**。
- **按 collateral 加權的 entry yield：2.00%**。
- **capital-weighted DTE：13.0 天**。
- **按 collateral-days 計算的 gross annualized premium pace：56.2%**。
- **單筆 annualized yield 中位數：89.8%**；此數字被 3–4 DTE 的 PLTR/SPCX 顯著拉高，不適合當成帳戶年報酬預期。

4 組可精確配對的 winner，在持有期間產生 **$2,024.28 net profit**，相對 $168,000 collateral 為 **1.20%**；按實際 collateral-days 簡單年化為 **57.5%**。這個數字與 entry premium pace 相近，但仍不能當作真實 annual account return，原因是截圖只有 winners，沒有 assignment 後的 drawdown、未平倉虧損、idle cash 或 losing trades。

**最合理的推論：**他選單時大概願意接受每筆 **約 2%–4% gross premium / collateral**，大標的 ETF 可低至 0.8%–1.1%；若硬要轉成年化，其 deployed-collateral gross pace 約 **50%–60%**。真實 account-level annual return 無法由這組截圖可靠估計。

## 4. Profit 平倉：接近 95%–98%，不是 70%–80%

| Contract | Entry credit | Buy-to-close | Gross capture | 顯示 net profit | 持有日數 |
|---|---:|---:|---:|---:|---:|
| QQQ Aug 14 660P | $7.06 | $0.16 | **97.7%** | $687.92 | 8 |
| NVDA Aug 14 190P | $4.17 | $0.11 | **97.4%** | $404.37 | 8 |
| SPCX Aug 14 100P | $3.99 | $0.25 | **93.7%** | $371.91 | 2 |
| SPY Aug 14 730P | $5.73 | $0.11 | **98.1%** | $560.08 | 8 |

四筆 exact pairs 的 weighted gross capture 是 **97.0%**。TSLA 與 AVGO 的 opening screenshot 缺失，但由 displayed P&L、closing debit 與佣金反推，entry credit 約 $5.85 / $7.41，gross capture 約 **94.0% / 96.5%**。

這比較像以下 exit rule：

- 等 option debit 降到約 **$0.10–$0.35**；或
- 收走約 **95%+ premium**；或
- 在剩餘 7 DTE 左右集中清掉已大幅獲利的部位。

代價是：從 80% 等到 97%，只多賺原始 premium 的 17%，卻繼續承擔短 gamma、overnight gap 與 event risk。對 SPY/QQQ/NVDA 這類流動性高的 ETF/mega-cap 尚可理解；對 SPCX/PLTR 這類高波動標的，尾端風險更不對稱。

## 5. 與你目前 Weekly CSP 方法的差異

| 維度 | Leo 截圖行為 | 你目前 screener | 實務差異 |
|---|---|---|---|
| Delta | 中位約 -0.346；8/9 筆估計值超過 |Delta| 0.25 | Best `-0.12–0`；Middle `-0.25–-0.03` | Leo 更靠近 ATM，premium 與 assignment probability 都更高 |
| DTE | 3–18 DTE；40% 超過 14 DTE | Best 1–10；Middle 1–14 | 你會漏掉 15–18 DTE 的 NVDA/SPY/QQQ/TSLA |
| IV | 約 15.5%–220.8%；SPY/QQQ 低 IV 也做 | Best IV proxy ≥50；Middle ≥35 | Leo 不像單純 IV-expansion strategy，更重視 fill premium 與標的 |
| Premium yield | 中位 2.53%；加權 2.00% | 有 `Potential ROI`，但最低門檻目前為 0 | 你的 ranking 有 annualized ROI 權重，但 filter 沒把最低 premium yield 固定成策略門檻 |
| Liquidity | 可見 observed trades spread 尚可；MRVL/部分個股可能接受較薄 OI | Best volume ≥200、spread ≤0.5；Middle volume ≥50、spread ≤1 | 你在 liquidity 控制上更明確，較不容易被高 premium 誘導 |
| Profit target | 約 94%–98%，多數接近 97% | Tracking 以 5 日內達 80% capture 為 outcome | 你較早回收 tail risk；目前 tracker 無法描述 Leo 的 95%+ exit style |
| Assignment | INTC 2 contracts 已被 assigned；SPCX call 顯示可能有 wheel/covered-call 後續，但無法證明 | CSP screener 主要評估開倉候選 | Leo 顯然願意讓 CSP 轉 shares；你的流程尚未把 assignment/repair path 納入同一風險框架 |
| IV percentile | 無法從截圖判定 | 目前 `ivPercentile` 仍是 current IV proxy | 兩邊都沒有真正 historical IV Rank 證據，不能把 absolute IV 當 percentile |

## 6. 建議你怎麼吸收，而不是直接照抄

1. **保留你現有的低 Delta Best case。** Leo 的 winner screenshots 證明 premium 可以很漂亮，沒有證明 drawdown-adjusted return 更好。把 `-0.25 至 -0.45` 做成獨立的 `Aggressive / Wheel-ready` scenario，不要混進 Best case。
2. **把抓取範圍從 10 DTE 擴到至少 21 DTE。** UI 仍可維持 1–10 / 1–14 filters，但 archive 應涵蓋 21 DTE，否則無法回溯 15–18 DTE entry Greeks，也無法公平比較不同週期。
3. **新增真正的 premium yield 門檻。** 建議至少同時看 `credit / strike`、break-even distance、Delta 與 liquidity；不要只靠 annualized ROI，因為 3 DTE 會產生 400%+ 的誤導性年化。
4. **把 exit tracker 改成多里程碑。** 同時記錄 `50% / 80% / 90% / 95%` capture 的首次達成時間、最大 adverse excursion（MAE）與 assignment outcome，才能比較早平倉和榨到 95% 的真實風險報酬。
5. **把 portfolio collateral 與 correlation 放進 dashboard。** SPY + QQQ 已佔可見 collateral 的約 47%，其他多為半導體/高 beta tech；ticker 分散不等於 factor 分散。
6. **為 assignment 建立明確規則。** 若要學 Leo 的風格，需先定義願意接股的標的、最大單一 underlying 資本比例、被 assigned 後 covered call strike，以及何時停損而不是無限 wheel。

## 7. Further Questions

- TSLA 300P 與 AVGO 365P 的實際 entry date、fill、Delta/IV 是多少？這會改變資金峰值與 holding-period annualization。
- Aug 5 裁切的 340P ticker 是什麼？它可能再增加 $34,000 CSP collateral。
- INTC assignment 後 shares 是否仍持有、是否有 covered call？若已賣出，資金峰值會降低。
- 截圖是否只挑 winners？需要至少一個完整月份的所有 opening、closing、assignment 與 unrealized P&L，才可估真實 win rate、expectancy、drawdown 與 annual return。

## 8. Caveats and Assumptions

- 截圖交易時間按美東時間（ET）處理；本地 archive 是新加坡時間（SGT），2026 年 7–8 月相差 12 小時。
- Black–Scholes estimates 使用 4% risk-free rate、簡化 dividend yield，且未納入 intraday skew、early-exercise premium、borrow 或 discrete dividends；適合粗略重建，不是 broker 原始 Greek。
- 本地 archive 的相同合約快照頻率約 30 分鐘；高速行情中，Greeks 可以在數分鐘內顯著變動。
- TSM 不在 `config/watchlists.json`，因此不提供單點 Greek。公開網路搜尋也沒有取得可核對的 2026-08-03 intraday price。
- 可見 profit 截圖存在 selection bias（選擇偏誤）；所有 annualized numbers 都是 simple annualization，沒有複利，也沒有扣除 portfolio idle cash、tax、assignment loss 或 tail loss。
- 本報告分析的是交易風格與資本需求，不是投資建議（investment advice）。

