import type { OptionCandidate } from "../lib/types";

const MASSIVE_BASE_URL = "https://api.massive.com";

interface MassiveSnapshotResult {
  break_even_price?: number;
  details?: {
    contract_type?: "call" | "put";
    expiration_date?: string;
    exercise_style?: string;
    shares_per_contract?: number;
    strike_price?: number;
    ticker?: string;
  };
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
  };
  implied_volatility?: number;
  last_quote?: {
    ask?: number;
    bid?: number;
  };
  last_trade?: {
    price?: number;
    size?: number;
  };
  open_interest?: number;
  underlying_asset?: {
    price?: number;
    ticker?: string;
  };
}

interface MassiveChainResponse {
  results?: MassiveSnapshotResult[];
  next_url?: string;
}

function requireApiKey(): string {
  const apiKey = import.meta.env.VITE_MASSIVE_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error("Missing VITE_MASSIVE_API_KEY. Add it to .env before using Massive data.");
  }

  return apiKey;
}

function daysToExpiration(expirationDate: string): number {
  const expiration = new Date(`${expirationDate}T16:00:00-04:00`);
  const now = new Date();
  return Math.max(0, Math.ceil((expiration.getTime() - now.getTime()) / 86_400_000));
}

function mapSnapshotToCandidate(result: MassiveSnapshotResult, fallbackTicker: string): OptionCandidate | null {
  const details = result.details;
  const optionType = details?.contract_type;
  const expiration = details?.expiration_date;
  const strike = details?.strike_price;
  const underlyingPrice = result.underlying_asset?.price;
  const bid = result.last_quote?.bid;
  const ask = result.last_quote?.ask;

  if (!details?.ticker || !optionType || !expiration || !strike || !underlyingPrice || bid == null || ask == null) {
    return null;
  }

  return {
    id: details.ticker,
    ticker: result.underlying_asset?.ticker ?? fallbackTicker,
    companyName: result.underlying_asset?.ticker ?? fallbackTicker,
    sector: "Unknown",
    optionType,
    expiration,
    dte: daysToExpiration(expiration),
    strike,
    underlyingPrice,
    marketCapB: 0,
    lastPrice: result.last_trade?.price ?? (bid + ask) / 2,
    bid,
    ask,
    delta: result.greeks?.delta ?? 0,
    gamma: result.greeks?.gamma ?? 0,
    theta: result.greeks?.theta ?? 0,
    vega: result.greeks?.vega ?? 0,
    iv: (result.implied_volatility ?? 0) * 100,
    ivPercentile: 0,
    openInterest: result.open_interest ?? 0,
    volume: result.last_trade?.size ?? 0,
    dayChangePct: 0,
  };
}

export async function fetchMassiveOptionChain(underlyingTicker: string): Promise<OptionCandidate[]> {
  const apiKey = requireApiKey();
  const url = new URL(`/v3/snapshot/options/${underlyingTicker}`, MASSIVE_BASE_URL);
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Massive option chain request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as MassiveChainResponse;
  return (payload.results ?? [])
    .map((result) => mapSnapshotToCandidate(result, underlyingTicker))
    .filter((candidate): candidate is OptionCandidate => candidate !== null);
}

export async function fetchMassiveUniverse(tickers: string[]): Promise<OptionCandidate[]> {
  const chains = await Promise.all(tickers.map((ticker) => fetchMassiveOptionChain(ticker)));
  return chains.flat();
}
