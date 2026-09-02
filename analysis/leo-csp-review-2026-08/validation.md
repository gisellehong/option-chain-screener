## Validation Report

### Overall Assessment: Share with caveats

### Methodology Review

報告回答了 entry Greeks、cash requirement、per-trade / annualized return、profit-taking 與現行方法差異。成交價、數量、日期與 displayed profit 以四張截圖為主；Greeks 明確分為 observed、model estimate、model range 與 unavailable，沒有把 TSM 缺失值補成假精確數字。

### Issues Found

1. **Severity: High — winner-selection bias。** Profit screenshot 只顯示獲利平倉，不能用來估真實 win rate、expectancy、drawdown 或 account annual return。
2. **Severity: Medium — TSM underlying 缺失。** TSM 不在本地 watchlist，無法可靠回推出單點 Delta / IV。
3. **Severity: Medium — 15–18 DTE contract archive 缺口。** 現行 fetch window 為 1–10 DTE；較長 DTE 合約只能用 fill 與 underlying snapshots 做模型重建。
4. **Severity: Medium — SPCX Aug 5 opening gap。** 鄰近快照未 bracket $3.99 fill，因此報告使用 S=$108–$115 敏感度範圍，而不是把鄰近 Greek 當 entry Greek。
5. **Severity: Low — annualization。** 所有年化為 simple annualization，未含複利、idle cash、tax 或 loss tail；報告已在數字附近揭露。

### Calculation Spot-Checks

- 可見 collateral：**Verified** — 10 筆 strike × 100 合計 $297,250。
- 可見 premium：**Verified** — 10 筆 fill × 100 合計 $5,959。
- Collateral-weighted entry yield：**Verified** — $5,959 / $297,250 = 2.0047%。
- Exact-pair weighted gross capture：**Verified** — 總 gross profit $2,032 / 總 opening premium $2,095 = 96.9928%。
- Exact-pair displayed net profit：**Verified** — $687.92 + $404.37 + $371.91 + $560.08 = $2,024.28。
- Aug 7 screenshot profit total：**Verified** — 六筆 displayed profit 加總 $3,285.93，與頁首 $3,285.92 差 $0.01，屬逐筆顯示四捨五入。

### Visualization Review

Horizontal bar chart 使用 absolute Delta、零起點與 0.25 dashed reference line；TSM 被排除並在 subtitle 說明。Portable report builder 已在 1440px 與 390px viewports 通過 content、overflow、source dialog 與 external-request checks。

### Suggested Improvements

1. Archive 擴至至少 21 DTE，避免再用模型代替原始 contract snapshot。
2. 加入真正 historical IV Rank / IV Percentile。
3. 收集完整月份的 openings、closings、assignments 與 unrealized P&L，再估 account return。

### Required Caveats for Stakeholders

- Greeks 不是全部 broker-observed；表格的 evidence status 是解讀前提。
- Cash estimate 是資本需求區間，不是可見 account balance。
- Winner screenshots 不足以證明策略年化報酬。

