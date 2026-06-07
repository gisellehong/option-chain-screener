import { readFileSync } from "node:fs";

const MASSIVE_BASE_URL = "https://api.massive.com";
const DEFAULT_TICKERS = ["AAPL", "AMD", "SMH"];

function loadEnv() {
  try {
    const text = readFileSync(".env", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index);
      const value = trimmed.slice(index + 1);
      process.env[key] = process.env[key] ?? value;
    }
  } catch {
    // Environment variables may already be provided by the shell.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function summarizeFieldCoverage(results) {
  const total = results.length;
  const counts = {
    day: 0,
    details: 0,
    greeks: 0,
    impliedVolatility: 0,
    openInterest: 0,
    lastQuote: 0,
    bidAsk: 0,
    lastTrade: 0,
    underlyingTicker: 0,
    underlyingPrice: 0,
  };

  if (total === 0) {
    return Object.fromEntries(Object.keys(counts).map((key) => [key, "0/0"]));
  }

  for (const result of results) {
    if (result.day) counts.day += 1;
    if (result.details) counts.details += 1;
    if (result.greeks) counts.greeks += 1;
    if (hasNumber(result.implied_volatility)) counts.impliedVolatility += 1;
    if (hasNumber(result.open_interest)) counts.openInterest += 1;
    if (result.last_quote) counts.lastQuote += 1;
    if (hasNumber(result.last_quote?.bid) && hasNumber(result.last_quote?.ask)) counts.bidAsk += 1;
    if (result.last_trade) counts.lastTrade += 1;
    if (result.underlying_asset?.ticker) counts.underlyingTicker += 1;
    if (hasNumber(result.underlying_asset?.price)) counts.underlyingPrice += 1;
  }

  return Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [key, `${count}/${total}`]),
  );
}

function pickExample(results) {
  const result = results.find((item) => item.details && item.greeks && item.last_quote) ?? results[0];
  if (!result) return null;

  return {
    optionTicker: result.details?.ticker,
    contractType: result.details?.contract_type,
    expiration: result.details?.expiration_date,
    strike: result.details?.strike_price,
    delta: result.greeks?.delta,
    iv: result.implied_volatility,
    openInterest: result.open_interest,
    bid: result.last_quote?.bid,
    ask: result.last_quote?.ask,
    dayClose: result.day?.close,
    dayVolume: result.day?.volume,
    underlyingTicker: result.underlying_asset?.ticker,
    underlyingPrice: result.underlying_asset?.price,
  };
}

async function fetchChain(ticker, apiKey) {
  const url = new URL(`/v3/snapshot/options/${ticker}`, MASSIVE_BASE_URL);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("limit", "25");

  const response = await fetch(url);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 240) };
  }

  return {
    ticker,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    requestId: payload.request_id,
    resultCount: Array.isArray(payload.results) ? payload.results.length : 0,
    nextUrlPresent: Boolean(payload.next_url),
    error: payload.error ?? payload.message,
    coverage: summarizeFieldCoverage(payload.results ?? []),
    example: pickExample(payload.results ?? []),
  };
}

async function main() {
  loadEnv();
  const apiKey = process.env.VITE_MASSIVE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_MASSIVE_API_KEY. Add it to .env first.");
  }

  const tickers = process.argv.slice(2);
  const universe = tickers.length > 0 ? tickers : DEFAULT_TICKERS;
  const summaries = [];

  for (const ticker of universe) {
    summaries.push(await fetchChain(ticker, apiKey));
    if (ticker !== universe.at(-1)) {
      await sleep(13_000);
    }
  }

  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), universe, summaries }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
