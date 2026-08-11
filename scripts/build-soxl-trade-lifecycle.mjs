import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const snapshotsRoot = path.join(root, "data/snapshots");
const tradesPath = path.join(root, "data/soxl-trades/trades.json");
const outputPath = path.join(root, "data/soxl-trades/lifecycle.json");
const tradesData = JSON.parse(fs.readFileSync(tradesPath, "utf8"));
const trades = tradesData.trades;

const easternDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function easternDate(isoTimestamp) {
  const parts = Object.fromEntries(
    easternDateFormatter
      .formatToParts(new Date(isoTimestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function effectiveEndDate(trade) {
  if (!trade.closeDate) return trade.expiration;
  return trade.closeDate < trade.expiration ? trade.closeDate : trade.expiration;
}

function tradeTimestamp(date, time) {
  if (!date || !time) return null;
  const timestamp = Date.parse(`${date}T${time}`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function matchingSeries(candidate, trade) {
  const optionType = trade.strategy === "CC" ? "call" : "put";
  return (
    candidate.ticker === "SOXL" &&
    candidate.optionType === optionType &&
    candidate.expiration === trade.expiration
  );
}

function matchingContract(candidate, trade) {
  return matchingSeries(candidate, trade) && Math.abs(Number(candidate.strike) - trade.strike) < 0.001;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function quoteFromCandidate(snapshot, marketDate, candidate) {
  const bid = finiteOrNull(candidate.bid);
  const ask = finiteOrNull(candidate.ask);
  return {
    marketDate,
    generatedAt: snapshot.generatedAt,
    bid,
    ask,
    mid: bid !== null && ask !== null ? (bid + ask) / 2 : null,
    underlyingPrice: finiteOrNull(candidate.underlyingPrice),
    iv: finiteOrNull(candidate.iv),
    delta: finiteOrNull(candidate.delta),
    modeled: false,
  };
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function modeledCallQuote(snapshot, marketDate, trade, underlyingPrice) {
  const sigma = finiteOrNull(trade.entryIv);
  if (sigma === null || sigma <= 0 || underlyingPrice <= 0) return null;
  const expirationTime = Date.parse(`${trade.expiration}T20:00:00Z`);
  const snapshotTime = Date.parse(snapshot.generatedAt);
  const yearsToExpiration = Math.max((expirationTime - snapshotTime) / (365.25 * 24 * 60 * 60 * 1000), 1 / (365.25 * 24 * 60));
  const riskFreeRate = finiteOrNull(trade.greeksRiskFreeRate) ?? 0.042;
  const d1 = (
    Math.log(underlyingPrice / trade.strike)
    + (riskFreeRate + sigma * sigma / 2) * yearsToExpiration
  ) / (sigma * Math.sqrt(yearsToExpiration));
  const d2 = d1 - sigma * Math.sqrt(yearsToExpiration);
  const price = Math.max(
    0,
    underlyingPrice * normalCdf(d1)
      - trade.strike * Math.exp(-riskFreeRate * yearsToExpiration) * normalCdf(d2),
  );
  return {
    marketDate,
    generatedAt: snapshot.generatedAt,
    bid: price,
    ask: price,
    mid: price,
    underlyingPrice,
    iv: sigma * 100,
    delta: normalCdf(d1),
    modeled: true,
  };
}

function entryQuoteScore(quote, fillPrice) {
  if (quote.bid === null || quote.ask === null || quote.mid === null) return [Infinity, Infinity];
  const outsideSpread = fillPrice < quote.bid
    ? quote.bid - fillPrice
    : fillPrice > quote.ask
      ? fillPrice - quote.ask
      : 0;
  return [outsideSpread, Math.abs(quote.mid - fillPrice)];
}

function chooseEntryQuote(quotes, trade) {
  const entryDayQuotes = quotes.filter((quote) => quote.marketDate === trade.entryDate);
  return entryDayQuotes.sort((left, right) => {
    const leftScore = entryQuoteScore(left, trade.entryPremium);
    const rightScore = entryQuoteScore(right, trade.entryPremium);
    return leftScore[0] - rightScore[0] || leftScore[1] - rightScore[1];
  })[0] ?? null;
}

function round(value, digits = 6) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

const work = new Map(
  trades.map((trade) => [
    trade.id,
    {
      trade,
      quotes: [],
      availableDates: new Set(),
      matchedDates: new Set(),
    },
  ]),
);

let parsedSnapshotCount = 0;
let earliestSnapshotAt = null;
let latestSnapshotAt = null;

for (const directoryName of fs.readdirSync(snapshotsRoot).sort()) {
  const directoryPath = path.join(snapshotsRoot, directoryName);
  if (!fs.statSync(directoryPath).isDirectory()) continue;

  for (const filename of fs.readdirSync(directoryPath).sort()) {
    if (!filename.endsWith(".json")) continue;
    const filePath = path.join(directoryPath, filename);
    const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!snapshot.generatedAt) continue;

    parsedSnapshotCount += 1;
    earliestSnapshotAt = earliestSnapshotAt === null || snapshot.generatedAt < earliestSnapshotAt
      ? snapshot.generatedAt
      : earliestSnapshotAt;
    latestSnapshotAt = latestSnapshotAt === null || snapshot.generatedAt > latestSnapshotAt
      ? snapshot.generatedAt
      : latestSnapshotAt;

    const marketDate = easternDate(snapshot.generatedAt);
    const candidates = snapshot.candidates ?? [];

    for (const item of work.values()) {
      const { trade } = item;
      if (marketDate < trade.entryDate || marketDate > effectiveEndDate(trade)) continue;
      const snapshotTime = Date.parse(snapshot.generatedAt);
      const entryTime = tradeTimestamp(trade.entryDate, trade.entryTime);
      const closeTime = tradeTimestamp(trade.closeDate, trade.closeTime);
      if (entryTime !== null && snapshotTime < entryTime) continue;
      if (closeTime !== null && snapshotTime > closeTime) continue;

      const seriesRows = candidates.filter((candidate) => matchingSeries(candidate, trade));
      if (seriesRows.length > 0) item.availableDates.add(marketDate);

      const candidate = seriesRows.find((row) => matchingContract(row, trade));
      if (candidate && Number.isFinite(Number(candidate.ask))) {
        item.quotes.push(quoteFromCandidate(snapshot, marketDate, candidate));
        item.matchedDates.add(marketDate);
        continue;
      }

      if (trade.strategy === "CC") {
        const underlyingPrice = candidates
          .filter((row) => row.ticker === "SOXL")
          .map((row) => finiteOrNull(row.underlyingPrice))
          .find((value) => value !== null);
        const modeledQuote = underlyingPrice === undefined
          ? null
          : modeledCallQuote(snapshot, marketDate, trade, underlyingPrice);
        if (modeledQuote) {
          item.availableDates.add(marketDate);
          item.quotes.push(modeledQuote);
          item.matchedDates.add(marketDate);
        }
      }
    }
  }
}

const lifecycleTrades = trades.map((trade) => {
  const item = work.get(trade.id);
  const quotes = item.quotes.sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
  const availableDates = [...item.availableDates].sort();
  const matchedDates = [...item.matchedDates].sort();
  const coverageRatio = availableDates.length > 0 ? matchedDates.length / availableDates.length : 0;
  const startsAfterEntry = matchedDates.length > 0 && matchedDates[0] > trade.entryDate;
  const coverage = quotes.length === 0
    ? "missing"
    : coverageRatio >= 0.8 && matchedDates[0] === availableDates[0] && !startsAfterEntry
      ? "full"
      : "partial";

  const worstQuote = quotes.reduce((worst, quote) => {
    if (quote.ask === null) return worst;
    if (worst === null || worst.ask === null || quote.ask > worst.ask) return quote;
    return worst;
  }, null);
  const latestQuote = [...quotes].reverse().find((quote) => quote.ask !== null) ?? null;

  const entryQuote = chooseEntryQuote([...quotes], trade);
  const usesEstimatedGreeks = trade.entryIv === null || trade.entryDelta === null;
  const entryGreeksSource = trade.entryGreeksSource
    ?? (usesEstimatedGreeks && entryQuote ? "snapshot_estimate" : usesEstimatedGreeks ? "missing" : "sheet");
  const entryIv = trade.entryIv !== null ? trade.entryIv * 100 : entryQuote?.iv ?? null;
  const entryDelta = trade.entryDelta ?? entryQuote?.delta ?? null;
  const entryUnderlying = trade.underlyingAtEntry ?? entryQuote?.underlyingPrice ?? null;
  const maximumUnrealizedLoss = worstQuote?.ask === null || !worstQuote
    ? null
    : Math.min(0, (trade.entryPremium - worstQuote.ask) * trade.contracts * 100);
  const unrealizedProfit = trade.closeDate === null && latestQuote?.ask !== null
    ? (trade.entryPremium - latestQuote.ask) * trade.contracts * 100
    : null;
  const unrealizedRoi = unrealizedProfit !== null && trade.collateral > 0
    ? unrealizedProfit / trade.collateral
    : null;

  const dailyMaxPremium = [...new Set(quotes.map((quote) => quote.marketDate))].map((marketDate) => {
    const dailyWorst = quotes
      .filter((quote) => quote.marketDate === marketDate && quote.ask !== null)
      .sort((left, right) => right.ask - left.ask)[0];
    return {
      marketDate,
      maximumAsk: dailyWorst?.ask ?? null,
      generatedAt: dailyWorst?.generatedAt ?? null,
    };
  });

  const qualityFlags = [trade.entryTime || trade.closeTime ? "timestamp_trade_window" : "date_only_trade_window"];
  if (trade.expirationCorrected) qualityFlags.push("expiration_year_normalized");
  if (coverage === "partial") qualityFlags.push("partial_quote_coverage");
  if (coverage === "missing") qualityFlags.push("missing_quote_history");
  if (entryGreeksSource === "snapshot_estimate" || entryGreeksSource === "model_estimate") qualityFlags.push("entry_greeks_estimated");
  if (entryGreeksSource === "missing") qualityFlags.push("entry_greeks_missing");
  if (quotes.some((quote) => quote.modeled)) qualityFlags.push("modeled_quote_history");
  if (trade.outcome.includes("Assigned")) qualityFlags.push("assignment_lifecycle_unresolved");

  return {
    tradeId: trade.id,
    entryGreeks: {
      iv: round(entryIv),
      delta: round(entryDelta),
      underlyingPrice: round(entryUnderlying),
      source: entryGreeksSource,
      quoteAt: trade.entryQuoteAt ?? (usesEstimatedGreeks ? entryQuote?.generatedAt ?? null : null),
    },
    ...(trade.closeDate === null
      ? {
          openPosition: {
            markPremium: round(latestQuote?.ask ?? null),
            unrealizedProfit: round(unrealizedProfit, 2),
            unrealizedRoi: round(unrealizedRoi),
            quote: latestQuote
              ? {
                  marketDate: latestQuote.marketDate,
                  generatedAt: latestQuote.generatedAt,
                  bid: round(latestQuote.bid),
                  ask: round(latestQuote.ask),
                  underlyingPrice: round(latestQuote.underlyingPrice),
                  iv: round(latestQuote.iv),
                  delta: round(latestQuote.delta),
                  modeled: latestQuote.modeled,
                }
              : null,
          },
        }
      : {}),
    historical: {
      quoteCount: quotes.length,
      modeledQuoteCount: quotes.filter((quote) => quote.modeled).length,
      availableMarketDates: availableDates.length,
      matchedMarketDates: matchedDates.length,
      coverageRatio: round(coverageRatio),
      coverage,
      firstQuoteAt: quotes[0]?.generatedAt ?? null,
      lastQuoteAt: quotes.at(-1)?.generatedAt ?? null,
      maximumPremium: round(worstQuote?.ask ?? null),
      maximumUnrealizedLoss: round(maximumUnrealizedLoss, 2),
      maximumLossPctCollateral: trade.collateral > 0 && maximumUnrealizedLoss !== null
        ? round(Math.abs(maximumUnrealizedLoss) / trade.collateral)
        : null,
      worstQuote: worstQuote
        ? {
            marketDate: worstQuote.marketDate,
            generatedAt: worstQuote.generatedAt,
            bid: round(worstQuote.bid),
            ask: round(worstQuote.ask),
            underlyingPrice: round(worstQuote.underlyingPrice),
            iv: round(worstQuote.iv),
            delta: round(worstQuote.delta),
          }
        : null,
      dailyMaxPremium,
    },
    returns: {
      recordedProfit: round(trade.closedProfit, 2),
      entryRoi: round(trade.entryRoi),
      realizedRoi: round(trade.realizedRoi),
      annualizedRealizedReturn: trade.realizedRoi !== null && trade.daysHeld > 0
        ? round(trade.realizedRoi * 365 / trade.daysHeld)
        : null,
      sourceAnnualReturn: round(trade.sourceAnnualReturn),
    },
    qualityFlags,
  };
});

const summary = {
  tradeCount: lifecycleTrades.length,
  fullCoverageCount: lifecycleTrades.filter((trade) => trade.historical.coverage === "full").length,
  partialCoverageCount: lifecycleTrades.filter((trade) => trade.historical.coverage === "partial").length,
  missingCoverageCount: lifecycleTrades.filter((trade) => trade.historical.coverage === "missing").length,
  estimatedGreeksCount: lifecycleTrades.filter((trade) => ["snapshot_estimate", "model_estimate"].includes(trade.entryGreeks.source)).length,
  missingGreeksCount: lifecycleTrades.filter((trade) => trade.entryGreeks.source === "missing").length,
};

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    snapshotRoot: path.relative(root, snapshotsRoot),
    parsedSnapshotCount,
    earliestSnapshotAt,
    latestSnapshotAt,
    priceConvention: "Maximum premium uses the highest observed ask inside the holding window. Covered calls use Black-Scholes modeled prices when the exact contract quote was not archived.",
  },
  summary,
  trades: lifecycleTrades,
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath: path.relative(root, outputPath), ...summary }, null, 2));
