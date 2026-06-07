import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MASSIVE_BASE_URL = "https://api.massive.com";
const NASDAQ_QUOTE_URL = "https://api.nasdaq.com/api/quote";
const OUTPUT_PATH = "src/data/generated/realOptions.json";
const DEFAULT_UNIVERSE = ["AAPL", "AMD", "NVDA", "TSLA", "MSFT", "SMH"];
const REQUEST_DELAY_MS = 13_000;

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
    // Environment variables may already be available.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseMoney(value) {
  if (typeof value !== "string") return Number.NaN;
  return Number(value.replace(/[$,%\s,]/g, ""));
}

function daysToExpiration(expirationDate) {
  const expiration = new Date(`${expirationDate}T20:00:00.000Z`);
  const now = new Date();
  return Math.max(0, Math.ceil((expiration.getTime() - now.getTime()) / 86_400_000));
}

async function fetchNasdaqQuote(ticker) {
  for (const assetClass of ["stocks", "etf"]) {
    const url = new URL(`${NASDAQ_QUOTE_URL}/${ticker}/info`);
    url.searchParams.set("assetclass", assetClass);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
    });

    if (!response.ok) continue;
    const payload = await response.json();
    const price = parseMoney(payload.data?.primaryData?.lastSalePrice);
    if (Number.isFinite(price) && price > 0) {
      return {
        ticker,
        price,
        assetClass,
        source: "nasdaq_quote",
        updated: payload.data?.primaryData?.lastTradeTimestamp,
      };
    }
  }

  throw new Error(`Unable to fetch Nasdaq quote for ${ticker}`);
}

function buildMassiveUrl(ticker, params, apiKey) {
  const url = new URL(`/v3/snapshot/options/${ticker}`, MASSIVE_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("apiKey", apiKey);
  return url;
}

async function fetchMassiveSnapshots(ticker, params, apiKey) {
  const response = await fetch(buildMassiveUrl(ticker, params, apiKey));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${ticker} Massive snapshot failed: ${response.status} ${payload.error ?? payload.message ?? ""}`);
  }

  return Array.isArray(payload.results) ? payload.results : [];
}

function mapSnapshot(snapshot, ticker, underlying) {
  const details = snapshot.details;
  const day = snapshot.day;
  const optionType = details?.contract_type;
  const expiration = details?.expiration_date;
  const strike = details?.strike_price;
  const dayClose = day?.close;

  if (!details?.ticker || !optionType || !expiration || !strike || !dayClose) {
    return null;
  }

  const iv = (snapshot.implied_volatility ?? 0) * 100;

  return {
    id: details.ticker,
    ticker,
    companyName: ticker,
    sector: underlying.assetClass === "etf" ? "ETF" : "Unknown",
    optionType,
    expiration,
    dte: daysToExpiration(expiration),
    strike,
    underlyingPrice: underlying.price,
    marketCapB: 10,
    lastPrice: dayClose,
    bid: dayClose,
    ask: dayClose,
    delta: snapshot.greeks?.delta ?? 0,
    gamma: snapshot.greeks?.gamma ?? 0,
    theta: snapshot.greeks?.theta ?? 0,
    vega: snapshot.greeks?.vega ?? 0,
    iv,
    ivPercentile: Math.min(100, Math.max(0, iv)),
    openInterest: snapshot.open_interest ?? 0,
    volume: day.volume ?? 0,
    dayChangePct: day.change_percent ?? 0,
    priceSource: "option_day_close_proxy",
    underlyingPriceSource: underlying.source,
    ivPercentileSource: "current_iv_proxy",
  };
}

async function fetchTickerCandidates(ticker, apiKey) {
  const underlying = await fetchNasdaqQuote(ticker);
  const now = new Date();
  const weeklyStart = toIsoDate(addDays(now, 1));
  const weeklyEnd = toIsoDate(addDays(now, 10));
  const leapsStart = toIsoDate(addDays(now, 540));
  const leapsEnd = toIsoDate(addDays(now, 900));

  const strategyQueries = [
    {
      name: "leaps",
      params: {
        contract_type: "call",
        "expiration_date.gte": leapsStart,
        "expiration_date.lte": leapsEnd,
        "strike_price.gte": Math.round(underlying.price * 0.45),
        "strike_price.lte": Math.round(underlying.price * 0.9),
        limit: 250,
      },
    },
    {
      name: "weeklyCsp",
      params: {
        contract_type: "put",
        "expiration_date.gte": weeklyStart,
        "expiration_date.lte": weeklyEnd,
        "strike_price.gte": Math.round(underlying.price * 0.65),
        "strike_price.lte": Math.round(underlying.price),
        limit: 250,
      },
    },
  ];

  const candidates = [];
  for (const query of strategyQueries) {
    const snapshots = await fetchMassiveSnapshots(ticker, query.params, apiKey);
    for (const snapshot of snapshots) {
      const candidate = mapSnapshot(snapshot, ticker, underlying);
      if (candidate) candidates.push(candidate);
    }
    if (query !== strategyQueries.at(-1)) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return { ticker, underlying, count: candidates.length, candidates };
}

async function main() {
  loadEnv();
  const apiKey = process.env.VITE_MASSIVE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_MASSIVE_API_KEY. Add it to .env first.");
  }

  const universe = process.argv.slice(2);
  const tickers = universe.length > 0 ? universe : DEFAULT_UNIVERSE;
  const allCandidates = [];
  const summaries = [];

  for (const ticker of tickers) {
    const result = await fetchTickerCandidates(ticker, apiKey);
    allCandidates.push(...result.candidates);
    summaries.push({
      ticker,
      underlyingPrice: result.underlying.price,
      underlyingSource: result.underlying.source,
      candidates: result.count,
    });
    if (ticker !== tickers.at(-1)) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(allCandidates, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath: OUTPUT_PATH, summaries, totalCandidates: allCandidates.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
