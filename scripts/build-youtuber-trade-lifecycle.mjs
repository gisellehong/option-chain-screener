import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const snapshotsRoot = path.join(root, "data/snapshots");
const tradesPath = path.join(root, "data/youtuber-trades/trades.json");
const outputPath = path.join(root, "data/youtuber-trades/lifecycle.json");
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8")).trades;

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

const snapshots = [];
for (const date of fs.readdirSync(snapshotsRoot).sort()) {
  const directory = path.join(snapshotsRoot, date);
  if (!fs.statSync(directory).isDirectory()) continue;

  for (const filename of fs.readdirSync(directory).sort()) {
    if (!filename.endsWith(".json")) continue;
    const filePath = path.join(directory, filename);
    const snapshot = readSnapshot(filePath);
    snapshots.push({ date, filename, filePath, snapshot });
  }
}

const lifecycle = trades.map((trade) => {
  const entrySnapshot = trade.validation?.nearestAfterSnapshot ?? null;
  const entryAt = entrySnapshot?.generatedAt ?? trade.observedAtSgt;
  const quoteHistory = snapshots
    .map(({ date, filename, filePath, snapshot }) => {
      const contract = contractFor(trade, snapshot);
      if (!contract || snapshot.generatedAt < entryAt) return null;
      return {
        date,
        filename,
        path: path.relative(root, filePath),
        generatedAt: snapshot.generatedAt,
        bid: contract.bid,
        ask: contract.ask,
        mark: trade.action === "buy" ? contract.bid : contract.ask,
        underlyingPrice: contract.underlyingPrice,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));

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

  const expiryClose = snapshots
    .filter(({ date, filename, snapshot }) => date === trade.expiration && filename.startsWith("close-") && snapshot.session === "close")
    .map(({ filePath, snapshot }) => {
      const candidate = snapshot.candidates?.find((row) => row.ticker === trade.ticker);
      return candidate
        ? {
            path: path.relative(root, filePath),
            generatedAt: snapshot.generatedAt,
            underlyingPrice: candidate.underlyingPrice,
          }
        : null;
    })
    .find(Boolean);

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

fs.writeFileSync(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), trades: lifecycle }, null, 2)}\n`,
);

console.log(`Wrote ${path.relative(root, outputPath)} for ${lifecycle.length} trades.`);
