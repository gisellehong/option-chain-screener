export type ScreenerId = "leaps_deep_itm_call" | "weekly_cash_secured_put";

export type OptionType = "call" | "put";

export type FilterOperator = "between" | "gte" | "lte";

export type DataSourceMode = "mock" | "massive";

export type MetricField =
  | keyof OptionCandidate
  | "mid"
  | "spread"
  | "spreadPct"
  | "intrinsicValue"
  | "extrinsicValue"
  | "intrinsicValuePct"
  | "breakeven"
  | "distanceOtmPct"
  | "percentItm"
  | "cashRequired"
  | "potentialRoi"
  | "annualizedRoi"
  | "leverageRatio";

export interface FilterRule {
  field: MetricField;
  label: string;
  operator: FilterOperator;
  min?: number;
  max?: number;
  unit?: string;
}

export interface ScreenerConfig {
  id: ScreenerId;
  name: string;
  shortName: string;
  intent: string;
  optionType: OptionType;
  filters: FilterRule[];
  sortDescription: string;
}

export interface OptionCandidate {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  optionType: OptionType;
  expiration: string;
  dte: number;
  strike: number;
  underlyingPrice: number;
  marketCapB: number;
  lastPrice: number;
  bid: number;
  ask: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  ivPercentile: number;
  openInterest: number;
  volume: number;
  dayChangePct: number;
  earningsDate?: string;
}

export interface ScoredCandidate extends OptionCandidate {
  score: number;
  matched: boolean;
  failedFilters: string[];
  mid: number;
  spread: number;
  spreadPct: number;
  intrinsicValue: number;
  extrinsicValue: number;
  intrinsicValuePct: number;
  breakeven: number;
  distanceOtmPct: number;
  percentItm: number;
  cashRequired: number;
  potentialRoi: number;
  annualizedRoi: number;
  leverageRatio: number;
  warnings: string[];
}
