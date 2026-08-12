import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const snapshotsRoot = path.join(root, "data/snapshots");
const tradesPath = path.join(root, "data/youtuber-trades/trades.json");
const outputPath = path.join(root, "data/youtuber-trades/lifecycle.json");
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8")).trades;
const tradeIds = trades.map((trade) => trade.id);
if (tradeIds.some((tradeId) => !tradeId)) {
  throw new Error("Every AAG trade must have a non-empty id.");
}
if (new Set(tradeIds).size !== tradeIds.length) {
  throw new Error("AAG trades contain duplicate ids.");
}

function readSnapshot(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function contractFor(trade, snapshot) {
  return snapshot.candidates?.find(
    (candidate) =>
      candidate.ticker === trade.ticker &&
      candidate.expiration === trade.expiration &&
      candidate.optionType === trade.optionType &&
      Math.abs(candidate.strike - trade.strike) < 0.001,
  );
}

function isOutOfTheMoney(trade, underlyingPrice) {
  return trade.optionType === "put"
    ? underlyingPrice > trade.strike
    : underlyingPrice < trade.strike;
}

const tradeStates = trades.map((trade) => ({
  trade,
  entryAt: trade.validation?.nearestAfterSnapshot?.generatedAt ?? trade.observedAtSgt,
  quoteHistory: [],
  expiryClose: null,
}));

for (const date of fs.readdirSync(snapshotsRoot).sort()) {
  const directory = path.join(snapshotsRoot, date);
  if (!fs.statSync(directory).isDirectory()) continue;

  for (const filename of fs.readdirSync(directory).sort()) {
    if (!filename.endsWith(".json")) continue;
    const filePath = path.join(directory, filename);
    const snapshot = readSnapshot(filePath);

    for (const state of tradeStates) {
      const { trade, entryAt } = state;
      if (snapshot.generatedAt >= entryAt) {
        const contract = contractFor(trade, snapshot);
        if (contract) {
          state.quoteHistory.push({
            date,
            filename,
            path: path.relative(root, filePath),
            generatedAt: snapshot.generatedAt,
            bid: contract.bid,
            ask: contract.ask,
            mark: trade.action === "buy" ? contract.bid : contract.ask,
            underlyingPrice: contract.underlyingPrice,
          });
        }
      }

      if (
        state.expiryClose === null &&
        date === trade.expiration &&
        filename.startsWith("close-") &&
        snapshot.session === "close"
      ) {
        const candidate = snapshot.candidates?.find((row) => row.ticker === trade.ticker);
        if (candidate) {
          state.expiryClose = {
            path: path.relative(root, filePath),
            generatedAt: snapshot.generatedAt,
            underlyingPrice: candidate.underlyingPrice,
          };
        }
      }
    }
  }
}

const lifecycle = tradeStates.map((state) => {
  const { trade, entryAt, expiryClose } = state;
  const entrySnapshot = trade.validation?.nearestAfterSnapshot ?? null;
  const quoteHistory = state.quoteHistory.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));

  const worstQuote = quoteHistory.reduce((worst, quote) => {
    if (worst === null) return quote;
    return trade.action === "buy"
      ? (quote.mark < worst.mark ? quote : worst)
      : (quote.mark > worst.mark ? quote : worst);
  }, null);
  const worstPnl = worstQuote && trade.fillPrice !== null && trade.quantity !== null
    ? Math.min(
        0,
        (trade.action === "buy"
          ? worstQuote.mark - trade.fillPrice
          : trade.fillPrice - worstQuote.mark) *
          trade.quantity *
          100,
      )
    : null;

  const autoExpired = expiryClose ? isOutOfTheMoney(trade, expiryClose.underlyingPrice) : false;

  return {
    tradeId: trade.id,
    entryQuote: {
      generatedAt: entryAt,
      underlyingPrice: entrySnapshot?.underlyingPrice ?? null,
      iv: entrySnapshot?.iv ?? null,
      delta: entrySnapshot?.delta ?? null,
    },
    historical: {
      quoteCount: quoteHistory.length,
      maxLoss: worstPnl,
      worstQuote,
    },
    expiry: expiryClose
      ? {
          ...expiryClose,
          autoExpired,
          outcome: autoExpired ? "auto_expired_assumed" : "assignment_or_close_unknown",
          premiumCollected: autoExpired && trade.grossPremium !== null ? trade.grossPremium : null,
        }
      : null,
  };
});

const lifecycleIds = lifecycle.map((item) => item.tradeId);
const missingLifecycleIds = tradeIds.filter((tradeId) => !lifecycleIds.includes(tradeId));
const unexpectedLifecycleIds = lifecycleIds.filter((tradeId) => !tradeIds.includes(tradeId));
if (missingLifecycleIds.length || unexpectedLifecycleIds.length) {
  throw new Error(
    `AAG trade/lifecycle id mismatch. Missing: ${missingLifecycleIds.join(", ") || "none"}; ` +
    `unexpected: ${unexpectedLifecycleIds.join(", ") || "none"}.`,
  );
}

fs.writeFileSync(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), trades: lifecycle }, null, 2)}\n`,
);

console.log(`Wrote ${path.relative(root, outputPath)} for ${lifecycle.length} trades.`);
