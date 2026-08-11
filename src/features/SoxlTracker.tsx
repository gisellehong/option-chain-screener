import { useMemo, useState } from "react";
import { Activity, ClipboardList, Filter, Percent, ShieldAlert } from "lucide-react";
import tradesRaw from "../../data/soxl-trades/trades.json";
import lifecycleRaw from "../../data/soxl-trades/lifecycle.json";
import { formatCurrency, formatNumber } from "../lib/format";

type Trader = "G" | "L";
type Strategy = "CSP" | "CC";
type Coverage = "full" | "partial" | "missing";
type TraderFilter = "All" | Trader;
type StrategyFilter = "All" | Strategy;
type StatusFilter = "All" | "Open" | "Closed";
type EntryGreeksSource = "sheet" | "snapshot_exact" | "snapshot_estimate" | "model_estimate" | "missing";

interface SoxlTrade {
  id: string;
  sourceRow: number | null;
  sourceType?: "google_sheets" | "broker_screenshot";
  trader: Trader;
  traderName: string;
  strategy: Strategy;
  entryDate: string;
  sourceContractLabel: string;
  expiration: string;
  expirationCorrected: boolean;
  underlyingAtEntry: number | null;
  strike: number;
  entryPremium: number;
  dte: number;
  contracts: number;
  grossPremium: number;
  collateral: number;
  entryRoi: number;
  sourceAnnualReturn: number;
  entryIv: number | null;
  entryDelta: number | null;
  notes: string | null;
  closeDate: string | null;
  daysHeld: number | null;
  closePrice: number | null;
  closedProfit: number | null;
  roundTripCommission: number | null;
  premiumCapture: number | null;
  outcome: string;
  realizedRoi: number | null;
}

interface SoxlLifecycle {
  tradeId: string;
  entryGreeks: {
    iv: number | null;
    delta: number | null;
    underlyingPrice: number | null;
    source: EntryGreeksSource;
    quoteAt: string | null;
  };
  openPosition?: {
    markPremium: number | null;
    unrealizedProfit: number | null;
    unrealizedRoi: number | null;
    quote: {
      marketDate: string;
      generatedAt: string;
      bid: number | null;
      ask: number;
      underlyingPrice: number | null;
      iv: number | null;
      delta: number | null;
      modeled: boolean;
    } | null;
  };
  historical: {
    quoteCount: number;
    availableMarketDates: number;
    matchedMarketDates: number;
    coverageRatio: number;
    coverage: Coverage;
    firstQuoteAt: string | null;
    lastQuoteAt: string | null;
    maximumPremium: number | null;
    maximumUnrealizedLoss: number | null;
    maximumLossPctCollateral: number | null;
    worstQuote: {
      marketDate: string;
      generatedAt: string;
      bid: number | null;
      ask: number;
      underlyingPrice: number | null;
      iv: number | null;
      delta: number | null;
    } | null;
  };
  returns: {
    recordedProfit: number | null;
    entryRoi: number;
    realizedRoi: number | null;
    annualizedRealizedReturn: number | null;
    sourceAnnualReturn: number;
  };
  qualityFlags: string[];
}

interface SoxlTradesData {
  schemaVersion: number;
  updatedAt: string;
  source: { url: string; sheetName: string; rowRange: string };
  trades: SoxlTrade[];
}

interface SoxlLifecycleData {
  schemaVersion: number;
  generatedAt: string;
  source: {
    parsedSnapshotCount: number;
    earliestSnapshotAt: string | null;
    latestSnapshotAt: string | null;
    priceConvention: string;
  };
  summary: {
    tradeCount: number;
    fullCoverageCount: number;
    partialCoverageCount: number;
    missingCoverageCount: number;
    estimatedGreeksCount: number;
    missingGreeksCount: number;
  };
  trades: SoxlLifecycle[];
}

interface JoinedTrade {
  trade: SoxlTrade;
  lifecycle: SoxlLifecycle;
}

const tradesData = tradesRaw as unknown as SoxlTradesData;
const lifecycleData = lifecycleRaw as unknown as SoxlLifecycleData;
const PROFIT_MONTHS = [
  { key: "2026-06", label: "Jun" },
  { key: "2026-07", label: "Jul" },
  { key: "2026-08", label: "Aug" },
] as const;

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatTimestamp(value: string | null): string {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatFraction(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${formatNumber(value * 100, digits)}%`;
}

function formatMaybeCurrency(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "N/A" : formatCurrency(value, digits);
}

function formatMaybeNumber(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? "N/A" : formatNumber(value, digits);
}

function formatRatio(value: number | null): string {
  if (value === null) return "N/A";
  if (value === Number.POSITIVE_INFINITY) return "∞";
  return Number.isFinite(value) ? formatNumber(value, 2) : "N/A";
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function premiumCaptured(trade: SoxlTrade): number | null {
  if (trade.entryPremium <= 0) return null;
  if (trade.closePrice !== null) return (trade.entryPremium - trade.closePrice) / trade.entryPremium;
  if (trade.outcome.includes("Assigned")) return 1;
  return null;
}

function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values);
  if (mean === null) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function tradeSharpe(values: number[]): number | null {
  const mean = average(values);
  const deviation = sampleStandardDeviation(values);
  if (mean === null || deviation === null || deviation === 0) return null;
  return mean / deviation;
}

function tradeSortino(values: number[]): number | null {
  const mean = average(values);
  if (mean === null || values.length === 0) return null;
  const downsideDeviation = Math.sqrt(
    values.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / values.length,
  );
  if (downsideDeviation === 0) return mean > 0 ? Number.POSITIVE_INFINITY : null;
  return mean / downsideDeviation;
}

function SummaryMetric({ label, value, subValue }: { label: string; value: string; subValue: string }) {
  return (
    <section className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{subValue}</small>
    </section>
  );
}

function traderStats(rows: JoinedTrade[], trader: Trader) {
  const traderRows = rows.filter((row) => row.trade.trader === trader);
  const realizedReturns = traderRows
    .map((row) => row.trade.realizedRoi)
    .filter((value): value is number => value !== null);
  const annualizedReturns = traderRows
    .map((row) => row.lifecycle.returns.annualizedRealizedReturn)
    .filter((value): value is number => value !== null);
  const losses = traderRows
    .map((row) => row.lifecycle.historical.maximumUnrealizedLoss)
    .filter((value): value is number => value !== null);
  return {
    trader,
    trades: traderRows.length,
    recordedProfit: traderRows.reduce((sum, row) => sum + (row.trade.closedProfit ?? 0), 0),
    averageRoi: average(realizedReturns),
    averageAnnualized: average(annualizedReturns),
    worstLoss: losses.length > 0 ? Math.min(...losses) : null,
    sharpe: tradeSharpe(realizedReturns),
    sortino: tradeSortino(realizedReturns),
    monthlyProfit: PROFIT_MONTHS.map((month) => ({
      ...month,
      value: traderRows.reduce((sum, row) => (
        row.trade.closeDate?.startsWith(month.key) ? sum + (row.trade.closedProfit ?? 0) : sum
      ), 0),
    })),
  };
}

function TraderComparison({ rows }: { rows: JoinedTrade[] }) {
  const stats = (["G", "L"] as Trader[]).map((trader) => traderStats(rows, trader));
  const maxMonthlyProfit = Math.max(
    ...stats.flatMap((item) => item.monthlyProfit.map((month) => Math.abs(month.value))),
    1,
  );
  const hasNegativeMonth = stats.some((item) => item.monthlyProfit.some((month) => month.value < 0));
  const zeroLine = hasNegativeMonth ? 50 : 0;
  const maxBarHeight = hasNegativeMonth ? 46 : 96;

  return (
    <section className="soxlComparison">
      <div className="soxlPanelHead">
        <div>
          <span className="soxlKicker">Trader summary</span>
          <h3>G / L</h3>
        </div>
        <small className="soxlRatioDefinition">Per-trade Realized ROI · Rf / MAR = 0 · not annualized</small>
      </div>
      <div className="soxlCompareGrid">
        {stats.map((item) => (
          <article key={item.trader} className="soxlTraderCard">
            <div className="soxlTraderTitle">
              <span className={`traderBadge trader${item.trader}`}>{item.trader}</span>
              <div>
                <strong>{item.trader}</strong>
                <small>{item.trades} trades</small>
              </div>
            </div>
            <dl className="soxlMiniFacts">
              <div><dt>Recorded P&amp;L</dt><dd>{formatCurrency(item.recordedProfit, 0)}</dd></div>
              <div><dt>Avg realized ROI</dt><dd>{formatFraction(item.averageRoi)}</dd></div>
              <div><dt>Avg annualized</dt><dd>{formatFraction(item.averageAnnualized, 1)}</dd></div>
              <div><dt>Worst observed</dt><dd>{formatMaybeCurrency(item.worstLoss, 0)}</dd></div>
              <div><dt title="Mean realized ROI divided by sample standard deviation">Trade Sharpe</dt><dd>{formatRatio(item.sharpe)}</dd></div>
              <div><dt title="Mean realized ROI divided by downside deviation below 0%">Trade Sortino</dt><dd>{formatRatio(item.sortino)}</dd></div>
            </dl>
            <section className={`soxlMonthlyProfit chart${item.trader}`} aria-label={`${item.trader} profit by close month`}>
              <div className="soxlMonthlyHead">
                <strong>Profit by close month</strong>
                <small>Recorded P&amp;L · Jun–Aug 2026</small>
              </div>
              <div className="soxlMonthlyBars">
                {item.monthlyProfit.map((month) => {
                  const height = Math.abs(month.value) / maxMonthlyProfit * maxBarHeight;
                  return (
                    <div key={month.key} className="soxlMonthColumn">
                      <strong>{formatCurrency(month.value, 0)}</strong>
                      <div className="soxlMonthPlot">
                        <span className="soxlZeroLine" style={{ bottom: `${zeroLine}%` }} />
                        <i
                          className={month.value < 0 ? "negative" : ""}
                          style={{
                            bottom: `${zeroLine}%`,
                            height: `${height}%`,
                            minHeight: month.value === 0 ? 0 : 2,
                            transform: month.value < 0 ? "translateY(100%)" : undefined,
                          }}
                        />
                      </div>
                      <span>{month.label}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </article>
        ))}
      </div>
    </section>
  );
}

export function SoxlTracker() {
  const [traderFilter, setTraderFilter] = useState<TraderFilter>("All");
  const [strategyFilter, setStrategyFilter] = useState<StrategyFilter>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");

  const lifecycleByTrade = useMemo(
    () => new Map(lifecycleData.trades.map((lifecycle) => [lifecycle.tradeId, lifecycle])),
    [],
  );
  const joinedRows = useMemo(
    () => tradesData.trades.flatMap((trade) => {
      const lifecycle = lifecycleByTrade.get(trade.id);
      return lifecycle ? [{ trade, lifecycle }] : [];
    }).sort((left, right) => (
      right.trade.entryDate.localeCompare(left.trade.entryDate)
      || (right.trade.sourceRow ?? 0) - (left.trade.sourceRow ?? 0)
    )),
    [lifecycleByTrade],
  );

  const filteredRows = useMemo(() => joinedRows.filter(({ trade }) => {
    if (traderFilter !== "All" && trade.trader !== traderFilter) return false;
    if (strategyFilter !== "All" && trade.strategy !== strategyFilter) return false;
    if (statusFilter === "Open" && trade.closeDate !== null) return false;
    if (statusFilter === "Closed" && trade.closeDate === null) return false;
    return true;
  }), [joinedRows, statusFilter, strategyFilter, traderFilter]);

  const totalProfit = filteredRows.reduce((sum, row) => sum + (row.trade.closedProfit ?? 0), 0);
  const averageRoi = average(filteredRows.map((row) => row.trade.realizedRoi).filter((value): value is number => value !== null));
  const averageAnnualized = average(filteredRows
    .map((row) => row.lifecycle.returns.annualizedRealizedReturn)
    .filter((value): value is number => value !== null));
  const observedLosses = filteredRows
    .map((row) => row.lifecycle.historical.maximumUnrealizedLoss)
    .filter((value): value is number => value !== null);
  const worstObservedLoss = observedLosses.length > 0 ? Math.min(...observedLosses) : null;
  const openCount = filteredRows.filter((row) => row.trade.closeDate === null).length;
  const closedCount = filteredRows.length - openCount;

  return (
    <section className="wideWorkspace soxlWorkspace">
      <section className="sectionHead soxlHeader">
        <div>
          <div className="titleLine">
            <ClipboardList size={19} />
            <h2>SOXL Trade Tracker</h2>
          </div>
          <p>
            G／L 的實際 SOXL CSP 與 Covered Call 歷史。Maximum Premium 使用持有區間內的最高 Ask；
            CC 缺少完整合約報價時使用模型估算。
          </p>
        </div>
      </section>

      <section className="overview reportOverview soxlOverview">
        <SummaryMetric label="Trades" value={String(filteredRows.length)} subValue={`${openCount} open · ${closedCount} closed`} />
        <SummaryMetric label="Recorded P&L" value={formatCurrency(totalProfit, 0)} subValue="Closed trades; commissions included" />
        <SummaryMetric label="Avg Realized ROI" value={formatFraction(averageRoi)} subValue="Recorded profit ÷ collateral" />
        <SummaryMetric label="Avg Annualized" value={formatFraction(averageAnnualized, 1)} subValue="Realized ROI × 365 ÷ days held" />
        <SummaryMetric label="Worst Max Loss" value={formatMaybeCurrency(worstObservedLoss, 0)} subValue="Highest observed Ask convention" />
      </section>

      <TraderComparison rows={filteredRows} />

      <section className="soxlFilters" aria-label="SOXL trade filters">
        <Filter size={18} />
        <div className="soxlFilterGroup">
          <span>Trader</span>
          {(["All", "G", "L"] as TraderFilter[]).map((value) => (
            <button key={value} type="button" className={traderFilter === value ? "active" : ""} onClick={() => setTraderFilter(value)}>{value}</button>
          ))}
        </div>
        <div className="soxlFilterGroup">
          <span>Strategy</span>
          {(["All", "CSP", "CC"] as StrategyFilter[]).map((value) => (
            <button key={value} type="button" className={strategyFilter === value ? "active" : ""} onClick={() => setStrategyFilter(value)}>{value}</button>
          ))}
        </div>
        <div className="soxlFilterGroup">
          <span>Status</span>
          {(["All", "Open", "Closed"] as StatusFilter[]).map((value) => (
            <button key={value} type="button" className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>{value}</button>
          ))}
        </div>
      </section>

      <section className="tradeGroup soxlTradeGroup">
        <div className="tradeGroupHead">
          <div>
            <h3>Trade records</h3>
            <p>Entry Greeks 以 Sheet 為主；缺漏時選用開倉日中與成交 Premium 最接近的歷史快照。</p>
          </div>
          <div className="tradeGroupSummary">
            <span>Visible records</span>
            <strong>{filteredRows.length}</strong>
            <small>Source updated {formatDate(tradesData.updatedAt)}</small>
          </div>
        </div>

        <div className="tableWrap">
          <table className="soxlTradeTable">
            <thead>
              <tr>
                <th>Trade</th>
                <th>Contract</th>
                <th>Entry</th>
                <th>Entry Greeks</th>
                <th>Status / Close</th>
                <th>Maximum Premium</th>
                <th>Max Unrealized Loss</th>
                <th>ROI / Annualized</th>
                <th>Premium Captured</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ trade, lifecycle }) => {
                const assigned = trade.outcome.includes("Assigned");
                const open = trade.closeDate === null;
                const captured = premiumCaptured(trade);
                const unrealizedProfit = lifecycle.openPosition?.unrealizedProfit ?? null;
                const unrealizedStatus = unrealizedProfit === null
                  ? "Open · quote unavailable"
                  : unrealizedProfit > 0.005
                    ? "Unrealized gain"
                    : unrealizedProfit < -0.005
                      ? "Unrealized loss"
                      : "Flat";
                const unrealizedClass = unrealizedProfit === null
                  ? ""
                  : unrealizedProfit < 0
                    ? "negativeText"
                    : "positiveText";
                return (
                  <tr key={trade.id}>
                    <td>
                      <div className="soxlTradeIdentity">
                        <span className={`traderBadge trader${trade.trader}`}>{trade.trader}</span>
                        <div>
                          <strong>{formatDate(trade.entryDate)}</strong>
                          <small>{open ? "Open position" : `Closed ${formatDate(trade.closeDate)} · ${trade.daysHeld} days`}</small>
                          <small>{trade.sourceType === "broker_screenshot" ? "Broker screenshot" : `Sheet row ${trade.sourceRow}`}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>SOXL {formatCurrency(trade.strike, 0)} {trade.strategy === "CC" ? "CALL" : "PUT"}</strong>
                      <small>{trade.strategy === "CC" ? "Covered Call" : "Cash-Secured Put"}</small>
                      <small>Exp {formatDate(trade.expiration)} · {trade.contracts} contract{trade.contracts === 1 ? "" : "s"}</small>
                      <small>{trade.expirationCorrected ? `Normalized from ${trade.sourceContractLabel}` : `${trade.dte} DTE at entry`}</small>
                    </td>
                    <td>
                      <strong>{formatCurrency(trade.entryPremium)} credit</strong>
                      <small>{formatCurrency(trade.grossPremium, 0)} gross · {formatCurrency(trade.collateral, 0)} collateral</small>
                      <small>SOXL {formatMaybeCurrency(lifecycle.entryGreeks.underlyingPrice)}</small>
                    </td>
                    <td>
                      <strong>Δ {formatMaybeNumber(lifecycle.entryGreeks.delta, 4)}</strong>
                      <small>IV {lifecycle.entryGreeks.iv === null ? "N/A" : `${formatNumber(lifecycle.entryGreeks.iv, 1)}%`}</small>
                      <small>{lifecycle.entryGreeks.source === "sheet" ? "Sheet entry" : lifecycle.entryGreeks.source === "snapshot_exact" ? `Snapshot · ${formatTimestamp(lifecycle.entryGreeks.quoteAt)}` : lifecycle.entryGreeks.source === "model_estimate" ? "Model estimate" : lifecycle.entryGreeks.source === "snapshot_estimate" ? `Estimated · ${formatTimestamp(lifecycle.entryGreeks.quoteAt)}` : "Missing"}</small>
                    </td>
                    <td>
                      <strong className={open ? unrealizedClass : ""}>{open ? unrealizedStatus : assigned ? "Assigned" : formatMaybeCurrency(trade.closePrice)}</strong>
                      <small>{open ? lifecycle.openPosition?.markPremium !== null && lifecycle.openPosition?.markPremium !== undefined ? `Current premium ${formatCurrency(lifecycle.openPosition.markPremium)} · latest Ask` : "Current premium unavailable" : assigned ? "No buy-to-close price" : "Buy-to-close price"}</small>
                      <small className={open ? unrealizedClass : trade.closedProfit !== null && trade.closedProfit < 0 ? "negativeText" : "positiveText"}>
                        {open
                          ? unrealizedProfit === null
                            ? "Awaiting latest quote"
                            : `${formatCurrency(unrealizedProfit, 0)} unrealized P&L · ${formatFraction(lifecycle.openPosition?.unrealizedRoi ?? null)} ROI`
                          : trade.closedProfit === null
                            ? "Realized P&L pending"
                            : `${formatCurrency(trade.closedProfit, 0)} recorded P&L`}
                      </small>
                      {open && lifecycle.openPosition?.quote && (
                        <small>{lifecycle.openPosition.quote.modeled ? "Model estimate" : "Snapshot Ask"} · {formatTimestamp(lifecycle.openPosition.quote.generatedAt)}</small>
                      )}
                    </td>
                    <td>
                      <strong>{formatMaybeCurrency(lifecycle.historical.maximumPremium)}</strong>
                      <small>{lifecycle.historical.worstQuote ? formatTimestamp(lifecycle.historical.worstQuote.generatedAt) : "No archived quote"}</small>
                      <small>{lifecycle.historical.quoteCount} quotes · {lifecycle.historical.matchedMarketDates}/{lifecycle.historical.availableMarketDates} market dates</small>
                    </td>
                    <td>
                      <strong className={lifecycle.historical.maximumUnrealizedLoss && lifecycle.historical.maximumUnrealizedLoss < 0 ? "negativeText" : ""}>
                        {formatMaybeCurrency(lifecycle.historical.maximumUnrealizedLoss, 0)}
                      </strong>
                      <small>{formatFraction(lifecycle.historical.maximumLossPctCollateral)} of collateral</small>
                      <small>{lifecycle.historical.worstQuote ? `SOXL ${formatMaybeCurrency(lifecycle.historical.worstQuote.underlyingPrice)}` : "No matched historical quote"}</small>
                    </td>
                    <td>
                      <strong>{formatFraction(lifecycle.returns.realizedRoi)} realized</strong>
                      <small>{formatFraction(lifecycle.returns.annualizedRealizedReturn, 1)} annualized</small>
                      <small>{formatFraction(lifecycle.returns.entryRoi)} entry ROC</small>
                    </td>
                    <td>
                      <strong className={captured !== null && captured < 0 ? "negativeText" : captured !== null ? "positiveText" : ""}>
                        {open ? "Pending" : formatFraction(captured, 1)}
                      </strong>
                      <small>{open ? "Calculated after close" : assigned ? "No buy-to-close debit" : `(${formatCurrency(trade.entryPremium)} − ${formatMaybeCurrency(trade.closePrice)}) ÷ ${formatCurrency(trade.entryPremium)}`}</small>
                      <small>Commissions excluded</small>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr><td colSpan={9}>No trades match the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="soxlMethodology">
        <div><Activity size={18} /><p><strong>Open Position</strong> uses the latest Ask for current premium and unrealized P&L. CC uses a labeled model estimate when the exact quote is unavailable.</p></div>
        <div><ShieldAlert size={18} /><p><strong>Maximum Unrealized Loss</strong> = min(0, (entry credit − maximum Ask) × contracts × 100). CC shows the short-call leg only.</p></div>
        <div><Percent size={18} /><p><strong>Premium Captured</strong> = (entry premium − close price) ÷ entry premium. Commissions are excluded.</p></div>
      </section>
    </section>
  );
}
