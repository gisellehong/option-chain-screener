import type { FilterRule, MetricField, OptionCandidate, ScoredCandidate, ScreenerConfig } from "./types";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function derive(candidate: OptionCandidate): Omit<
  ScoredCandidate,
  keyof OptionCandidate | "score" | "matched" | "failedFilters" | "warnings"
> {
  const mid = (candidate.bid + candidate.ask) / 2;
  const spread = candidate.ask - candidate.bid;
  const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
  const intrinsicValue =
    candidate.optionType === "call"
      ? Math.max(candidate.underlyingPrice - candidate.strike, 0)
      : Math.max(candidate.strike - candidate.underlyingPrice, 0);
  const extrinsicValue = Math.max(mid - intrinsicValue, 0);
  const intrinsicValuePct = mid > 0 ? (intrinsicValue / mid) * 100 : 0;
  const breakeven = candidate.optionType === "call" ? candidate.strike + mid : candidate.strike - mid;
  const distanceOtmPct =
    candidate.optionType === "put"
      ? ((candidate.underlyingPrice - candidate.strike) / candidate.underlyingPrice) * 100
      : ((candidate.strike - candidate.underlyingPrice) / candidate.underlyingPrice) * 100;
  const percentItm =
    candidate.optionType === "call"
      ? ((candidate.underlyingPrice - candidate.strike) / candidate.underlyingPrice) * 100
      : ((candidate.strike - candidate.underlyingPrice) / candidate.underlyingPrice) * 100;
  const cashRequired = candidate.optionType === "put" ? candidate.strike * 100 : mid * 100;
  const potentialRoi = cashRequired > 0 ? ((mid * 100) / cashRequired) * 100 : 0;
  const annualizedRoi = candidate.dte > 0 ? potentialRoi * (365 / candidate.dte) : 0;
  const leverageRatio = mid > 0 ? candidate.underlyingPrice / mid : 0;

  return {
    mid,
    spread,
    spreadPct,
    intrinsicValue,
    extrinsicValue,
    intrinsicValuePct,
    breakeven,
    distanceOtmPct,
    percentItm,
    cashRequired,
    potentialRoi,
    annualizedRoi,
    leverageRatio,
  };
}

function getComparableValue(candidate: ScoredCandidate, field: MetricField): number {
  const value = candidate[field as keyof ScoredCandidate];
  if (typeof value !== "number") {
    return Number.NaN;
  }

  return value;
}

function passesFilter(candidate: ScoredCandidate, filter: FilterRule): boolean {
  const value = getComparableValue(candidate, filter.field);

  if (!Number.isFinite(value)) {
    return false;
  }

  if (filter.operator === "between") {
    return value >= Number(filter.min) && value <= Number(filter.max);
  }

  if (filter.operator === "gte") {
    return value >= Number(filter.min);
  }

  return value <= Number(filter.max);
}

function hasUsableQuote(candidate: OptionCandidate): boolean {
  return (
    candidate.priceSource !== "moomoo_last_price_proxy" &&
    Number.isFinite(candidate.bid) &&
    Number.isFinite(candidate.ask) &&
    candidate.bid > 0 &&
    candidate.ask > 0 &&
    candidate.ask >= candidate.bid
  );
}

function buildWarnings(candidate: OptionCandidate, derived: ReturnType<typeof derive>): string[] {
  const warnings: string[] = [];

  if (derived.spreadPct > 12) {
    warnings.push("Wide spread");
  }

  if (candidate.earningsDate) {
    warnings.push(`Earnings ${candidate.earningsDate}`);
  }

  if (candidate.openInterest < 500) {
    warnings.push("Thin OI");
  }

  if (candidate.underlyingPriceSource && candidate.underlyingPriceSource !== "moomoo_snapshot") {
    warnings.push(`Underlying from ${candidate.underlyingPriceSource}`);
  }

  if (candidate.ivPercentileSource === "current_iv_proxy") {
    warnings.push("IV proxy; no history yet");
  }

  return warnings;
}

function scoreLeaps(candidate: ScoredCandidate): number {
  const deltaFit = 100 - Math.abs(candidate.delta - 0.8) * 800;
  const intrinsicFit = 100 - Math.abs(candidate.intrinsicValuePct - 78) * 4;
  const lowIvProxy = 100 - candidate.ivPercentile;
  const tightSpread = 100 - candidate.spreadPct * 3;
  const liquidity = clamp(Math.log10(candidate.openInterest + candidate.volume + 1) * 18);

  return clamp(deltaFit * 0.24 + intrinsicFit * 0.26 + lowIvProxy * 0.22 + tightSpread * 0.14 + liquidity * 0.14);
}

function scoreWeeklyCsp(candidate: ScoredCandidate): number {
  const highIvProxy = clamp(candidate.ivPercentile);
  const liquidity = clamp(Math.log10(candidate.volume + candidate.openInterest + 1) * 16);
  const tightSpread = 100 - candidate.spreadPct * 3.5;
  const premium = clamp(candidate.annualizedRoi / 8);
  const otmBuffer = clamp(candidate.distanceOtmPct * 9);
  const dteFit = 100 - Math.abs(candidate.dte - 5) * 10;

  return clamp(highIvProxy * 0.24 + liquidity * 0.2 + tightSpread * 0.18 + premium * 0.18 + otmBuffer * 0.12 + dteFit * 0.08);
}

export function scoreCandidates(
  config: ScreenerConfig,
  filters: FilterRule[],
  candidates: OptionCandidate[],
  showAll = false,
): ScoredCandidate[] {
  return candidates
    .filter(hasUsableQuote)
    .filter((candidate) => candidate.optionType === config.optionType)
    .map((candidate) => {
      const derived = derive(candidate);
      const scoredBase = {
        ...candidate,
        ...derived,
        score: 0,
        matched: false,
        failedFilters: [],
        warnings: buildWarnings(candidate, derived),
      };
      const failedFilters = filters
        .filter((filter) => !passesFilter(scoredBase, filter))
        .map((filter) => filter.label);
      const score = config.id === "leaps_deep_itm_call" ? scoreLeaps(scoredBase) : scoreWeeklyCsp(scoredBase);

      return {
        ...scoredBase,
        score,
        matched: failedFilters.length === 0,
        failedFilters,
      };
    })
    .filter((candidate) => showAll || candidate.matched)
    .sort((left, right) => right.score - left.score);
}
