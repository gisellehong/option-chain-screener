import type { ScreenerConfig } from "../lib/types";

export const screenerConfigs: ScreenerConfig[] = [
  {
    id: "leaps_deep_itm_call",
    name: "Deep ITM LEAPS Call",
    shortName: "LEAPS Call",
    intent: "尋找可替代正股持倉的深度價內長天期 Call，偏重低時間價值、足夠流動性與穩定 Delta。",
    optionType: "call",
    sortDescription: "Score favors lower IV proxy, higher intrinsic value share, tighter spreads, and Delta near 0.80.",
    scenarios: [
      {
        id: "best",
        name: "Best case",
        shortName: "Best",
        intent: "理想 LEAPS 替代正股條件：Delta 穩、深度價內、OI 和成交量都足夠，IV proxy 不偏高。",
        filters: [
          { field: "dte", label: "Days to Expiration", operator: "between", min: 365, max: 600, unit: "D" },
          { field: "marketCapB", label: "Market Cap", operator: "gte", min: 10, unit: "B" },
          { field: "delta", label: "Delta", operator: "between", min: 0.75, max: 0.85 },
          { field: "openInterest", label: "Contract OI", operator: "gte", min: 500 },
          { field: "volume", label: "Contract Volume", operator: "gte", min: 10 },
          { field: "intrinsicValuePct", label: "% Intrinsic Value", operator: "between", min: 70, max: 85, unit: "%" },
          { field: "vega", label: "Vega", operator: "gte", min: 0.2 },
          { field: "ivPercentile", label: "IV Proxy", operator: "lte", max: 40, unit: "%" },
          { field: "percentItm", label: "% ITM", operator: "gte", min: 20, unit: "%" },
          { field: "potentialRoi", label: "Potential ROI", operator: "gte", min: 0, unit: "%" },
          { field: "annualizedRoi", label: "Potential Annualized ROI", operator: "gte", min: 0, unit: "%" },
        ],
      },
      {
        id: "middle",
        name: "Middle case",
        shortName: "Middle",
        intent: "次要但可研究條件：放寬 Delta、流動性與 IV proxy，用來找接近理想區間的替代候選。",
        filters: [
          { field: "dte", label: "Days to Expiration", operator: "between", min: 365, max: 900, unit: "D" },
          { field: "marketCapB", label: "Market Cap", operator: "gte", min: 10, unit: "B" },
          { field: "delta", label: "Delta", operator: "between", min: 0.65, max: 0.9 },
          { field: "openInterest", label: "Contract OI", operator: "gte", min: 100 },
          { field: "volume", label: "Contract Volume", operator: "gte", min: 1 },
          { field: "intrinsicValuePct", label: "% Intrinsic Value", operator: "between", min: 60, max: 90, unit: "%" },
          { field: "vega", label: "Vega", operator: "gte", min: 0.1 },
          { field: "ivPercentile", label: "IV Proxy", operator: "lte", max: 55, unit: "%" },
          { field: "percentItm", label: "% ITM", operator: "gte", min: 10, unit: "%" },
          { field: "potentialRoi", label: "Potential ROI", operator: "gte", min: 0, unit: "%" },
          { field: "annualizedRoi", label: "Potential Annualized ROI", operator: "gte", min: 0, unit: "%" },
        ],
      },
    ],
  },
  {
    id: "weekly_cash_secured_put",
    name: "IV Expansion for Weekly CSP",
    shortName: "Weekly CSP",
    intent: "尋找短天期、高 IV、可賣出週權利金的 Cash Secured Put，偏重流動性、價外距離與可成交價差。",
    optionType: "put",
    sortDescription: "Score favors high IV proxy, strong volume, tighter spreads, better annualized premium, and safer OTM distance.",
    scenarios: [
      {
        id: "best",
        name: "Best case",
        shortName: "Best",
        intent: "理想 CSP 條件：短天期、高 IV proxy、Delta 淺、成交活躍且 bid/ask spread 可接受。",
        filters: [
          { field: "lastPrice", label: "Last Price", operator: "gte", min: 2.5 },
          { field: "delta", label: "Delta", operator: "between", min: -0.12, max: 0 },
          { field: "dte", label: "Days to Expiration", operator: "between", min: 1, max: 10, unit: "D" },
          { field: "volume", label: "Contract Volume", operator: "gte", min: 200 },
          { field: "ivPercentile", label: "IV Proxy", operator: "gte", min: 50, unit: "%" },
          { field: "distanceOtmPct", label: "% OTM", operator: "gte", min: 0, unit: "%" },
          { field: "iv", label: "IV", operator: "gte", min: 30, unit: "%" },
          { field: "spread", label: "Bid-Ask Spread", operator: "lte", max: 0.5 },
          { field: "potentialRoi", label: "Potential ROI", operator: "gte", min: 0, unit: "%" },
          { field: "annualizedRoi", label: "Potential Annualized ROI", operator: "gte", min: 0, unit: "%" },
          { field: "dayChangePct", label: "% Chg", operator: "gte", min: 0, unit: "%" },
        ],
      },
      {
        id: "middle",
        name: "Middle case",
        shortName: "Middle",
        intent: "次要 CSP 條件：放寬 premium、Delta、DTE、volume 與 spread，保留 IV 和 OTM buffer 的基本要求。",
        filters: [
          { field: "lastPrice", label: "Last Price", operator: "gte", min: 1 },
          { field: "delta", label: "Delta", operator: "between", min: -0.25, max: -0.03 },
          { field: "dte", label: "Days to Expiration", operator: "between", min: 1, max: 14, unit: "D" },
          { field: "volume", label: "Contract Volume", operator: "gte", min: 50 },
          { field: "ivPercentile", label: "IV Proxy", operator: "gte", min: 35, unit: "%" },
          { field: "distanceOtmPct", label: "% OTM", operator: "gte", min: 0, unit: "%" },
          { field: "iv", label: "IV", operator: "gte", min: 25, unit: "%" },
          { field: "spread", label: "Bid-Ask Spread", operator: "lte", max: 1 },
          { field: "potentialRoi", label: "Potential ROI", operator: "gte", min: 0, unit: "%" },
          { field: "annualizedRoi", label: "Potential Annualized ROI", operator: "gte", min: 0, unit: "%" },
        ],
      },
    ],
  },
  {
    id: "soxl_conservative_csp",
    name: "SOXL Conservative CSP · 老 K",
    shortName: "SOXL Conservative",
    intent: "依照老 K 24 筆公開樣本建立的保守型 Cash-Secured Put：先控制到期價內機率，再從未來五個週五到期日各選一張兼顧報酬與流動性的合約。",
    optionType: "put",
    tickerWhitelist: ["SOXL"],
    maxResultsPerExpiration: 1,
    maxExpirations: 5,
    sortDescription: "Hard gate: expiry ITM probability <= 5% and midpoint annualized ROI >= 20%; rank by probability-adjusted premium and liquidity.",
    scenarios: [
      {
        id: "conservative",
        name: "老 K Conservative",
        shortName: "Conservative",
        intent: "每個週五到期桶只保留一張；Delta 與 OTM 距離是護欄，Bid-Ask Spread 只列警示、不直接淘汰。",
        filters: [
          { field: "soxlFridayBucket", label: "Friday Expiry Bucket", operator: "between", min: 1, max: 5 },
          { field: "dte", label: "Days to Expiration", operator: "between", min: 1, max: 42, unit: "D" },
          { field: "expiryItmProbability", label: "Expiry ITM Probability", operator: "lte", max: 5, unit: "%" },
          { field: "midAnnualizedRoi", label: "Mid Annualized ROI", operator: "gte", min: 20, unit: "%" },
          { field: "delta", label: "Delta Guardrail", operator: "between", min: -0.1, max: -0.02 },
          { field: "distanceOtmPct", label: "% OTM", operator: "between", min: 20, max: 45, unit: "%" },
          { field: "openInterest", label: "Contract OI", operator: "gte", min: 250 },
        ],
      },
    ],
  },
];

export function getScreenerConfig(id: string): ScreenerConfig {
  const config = screenerConfigs.find((item) => item.id === id);
  if (!config) {
    throw new Error(`Unknown screener config: ${id}`);
  }

  return config;
}
