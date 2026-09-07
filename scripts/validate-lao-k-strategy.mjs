import fs from "node:fs";
import path from "node:path";

const fixturePath = path.resolve("analysis/lao-k-soxl-csp-2026-08/recommendations.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const rows = fixture.recommendations;
const calibration = rows.filter((row) => row.date <= "2026-08-28");
const validation = rows.filter((row) => row.date >= "2026-08-31");

const conservativeGate = (row) =>
  row.expiryItmPct <= 5 &&
  row.midAnnualizedRoiPct >= 20 &&
  row.delta >= -0.1 &&
  row.delta <= -0.02 &&
  row.otmPct >= 20 &&
  row.otmPct <= 45;

const failures = rows.filter((row) => !conservativeGate(row));
const rejectedFailures = fixture.rejectedBuckets.filter((row) => row.minimumExpiryItmPct <= 5);
const bidBelowTwenty = rows.filter((row) => row.bidAnnualizedRoiPct < 20);

if (calibration.length !== 16 || validation.length !== 8) {
  throw new Error(`Expected 16 calibration and 8 validation rows; got ${calibration.length}/${validation.length}`);
}
if (failures.length > 0) {
  throw new Error(`Conservative gate rejected known recommendations: ${JSON.stringify(failures)}`);
}
if (rejectedFailures.length > 0) {
  throw new Error(`ITM hard gate accepted known empty buckets: ${JSON.stringify(rejectedFailures)}`);
}
if (bidBelowTwenty.length === 0) {
  throw new Error("Fixture no longer disproves a 20% bid-annualized hard gate");
}

const values = (field) => rows.map((row) => row[field]).sort((a, b) => a - b);
const median = (items) => {
  const mid = Math.floor(items.length / 2);
  return items.length % 2 ? items[mid] : (items[mid - 1] + items[mid]) / 2;
};
const range = (field) => {
  const items = values(field);
  return { min: items[0], median: median(items), max: items.at(-1) };
};

console.log(JSON.stringify({
  fixture: fixturePath,
  calibrationRows: calibration.length,
  outOfSampleRows: validation.length,
  acceptedByRevisedGate: rows.length - failures.length,
  rejectedBucketsBlockedByItmGate: fixture.rejectedBuckets.length - rejectedFailures.length,
  bidAnnualizedBelowTwentyExamples: bidBelowTwenty.map((row) => `${row.date} ${row.expiration} ${row.strike}P`),
  ranges: {
    dte: range("dte"),
    otmPct: range("otmPct"),
    expiryItmPct: range("expiryItmPct"),
    touchPct: range("touchPct"),
    delta: range("delta"),
    bidAnnualizedRoiPct: range("bidAnnualizedRoiPct"),
    midAnnualizedRoiPct: range("midAnnualizedRoiPct")
  }
}, null, 2));
