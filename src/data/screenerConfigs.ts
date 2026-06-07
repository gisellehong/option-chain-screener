import type { ScreenerConfig } from "../lib/types";

export const screenerConfigs: ScreenerConfig[] = [
  {
    id: "leaps_deep_itm_call",
    name: "Deep ITM LEAPS Call",
    shortName: "LEAPS Call",
    intent: "尋找可替代正股持倉的深度價內長天期 Call，偏重低時間價值、足夠流動性與穩定 Delta。",
    optionType: "call",
    sortDescription: "Score favors lower IV percentile, higher intrinsic value share, tighter spreads, and Delta near 0.80.",
    filters: [
      { field: "dte", label: "Days to Expiration", operator: "between", min: 540, max: 900, unit: "D" },
      { field: "marketCapB", label: "Market Cap", operator: "gte", min: 10, unit: "B" },
      { field: "delta", label: "Delta", operator: "between", min: 0.75, max: 0.85 },
      { field: "openInterest", label: "Contract OI", operator: "gte", min: 500 },
      { field: "volume", label: "Contract Volume", operator: "gte", min: 10 },
      { field: "intrinsicValuePct", label: "% Intrinsic Value", operator: "between", min: 70, max: 85, unit: "%" },
      { field: "vega", label: "Vega", operator: "gte", min: 0.2 },
      { field: "ivPercentile", label: "IV Percentile", operator: "lte", max: 40, unit: "%" },
      { field: "percentItm", label: "% ITM", operator: "gte", min: 20, unit: "%" },
      { field: "potentialRoi", label: "Potential ROI", operator: "gte", min: 0, unit: "%" },
      { field: "annualizedRoi", label: "Potential Annualized ROI", operator: "gte", min: 0, unit: "%" },
    ],
  },
  {
    id: "weekly_cash_secured_put",
    name: "IV Expansion for Weekly CSP",
    shortName: "Weekly CSP",
    intent: "尋找短天期、高 IV、可賣出週權利金的 Cash Secured Put，偏重流動性、價外距離與可成交價差。",
    optionType: "put",
    sortDescription: "Score favors high IV percentile, strong volume, tighter spreads, better annualized premium, and safer OTM distance.",
    filters: [
      { field: "lastPrice", label: "Last Price", operator: "gte", min: 2.5 },
      { field: "delta", label: "Delta", operator: "between", min: -0.12, max: 0 },
      { field: "dte", label: "Days to Expiration", operator: "between", min: 1, max: 10, unit: "D" },
      { field: "volume", label: "Contract Volume", operator: "gte", min: 200 },
      { field: "ivPercentile", label: "IV Percentile", operator: "gte", min: 50, unit: "%" },
      { field: "distanceOtmPct", label: "% OTM", operator: "gte", min: 0, unit: "%" },
      { field: "iv", label: "IV", operator: "gte", min: 30, unit: "%" },
      { field: "spread", label: "Bid-Ask Spread", operator: "lte", max: 0.5 },
      { field: "potentialRoi", label: "Potential ROI", operator: "gte", min: 0, unit: "%" },
      { field: "annualizedRoi", label: "Potential Annualized ROI", operator: "gte", min: 0, unit: "%" },
      { field: "dayChangePct", label: "% Chg", operator: "gte", min: 0, unit: "%" },
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
