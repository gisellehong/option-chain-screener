export type ScreenerId = "leaps_deep_itm_call" | "weekly_cash_secured_put";

export type OptionType = "call" | "put";

export type FilterOperator = "between" | "gte" | "lte";

export type DataSourceMode = "mock" | "moomoo";

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

export interface ScreenerScenario {
  id: "best" | "middle";
  name: string;
  shortName: string;
  intent: string;
  filters: FilterRule[];
}

export interface ScreenerConfig {
  id: ScreenerId;
  name: string;
  shortName: string;
  intent: string;
  optionType: OptionType;
  sortDescription: string;
  scenarios: ScreenerScenario[];
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
  priceSource?: string;
  underlyingPriceSource?: string;
  ivPercentileSource?: string;
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

export type TrackingStrategy = "leaps" | "weekly_csp";

export interface TrackingQuote {
  mid: number;
  bid: number;
  ask: number;
  underlyingPrice: number;
  iv: number;
  delta: number;
  spread: number;
  spreadPct: number;
  observedAt?: string;
}

export interface TrackingSignal {
  id: string;
  signalAt: string;
  session: string;
  strategy: TrackingStrategy;
  scenario: string;
  rank: number;
  score: number;
  contractId: string;
  ticker: string;
  companyName: string;
  optionType: OptionType;
  expiration: string;
  dte: number;
  strike: number;
  entry: TrackingQuote;
  latest: TrackingQuote | null;
  outcome: Record<string, number | string | boolean | null>;
  observations: {
    count: number;
    firstObservedAt: string | null;
    lastObservedAt: string | null;
  };
}

export interface TrackingSummary {
  totalSignals?: number;
  weeklyCspSignals?: number;
  weeklyCspOpen?: number;
  weeklyCspHit80?: number;
  weeklyCspHit80Within5D?: number;
  weeklyCspHitRate?: number | null;
  weeklyCspHitWithin5DRate?: number | null;
  weeklyCspAvgDaysTo80?: number | null;
  leapsSignals?: number;
  leapsTracked?: number;
  leapsAvgOptionReturnPct?: number | null;
  leapsAvgRelativeReturnPct?: number | null;
}

export interface TrackingData {
  schemaVersion: number;
  generatedAt: string | null;
  summary: TrackingSummary;
  signals: TrackingSignal[];
}
