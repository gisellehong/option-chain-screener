import { Fragment, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  Filter,
  RefreshCw,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { mockOptions } from "./data/mockOptions";
import realOptionsRaw from "./data/generated/realOptions.json";
import realOptionsMetaRaw from "./data/generated/realOptions.meta.json";
import trackingRaw from "./data/generated/tracking.json";
import youtuberTradesRaw from "../data/youtuber-trades/trades.json";
import { screenerConfigs } from "./data/screenerConfigs";
import { compactNumber, formatCurrency, formatNumber, formatPercent } from "./lib/format";
import { scoreCandidates } from "./lib/scoring";
import type {
  DataSourceMode,
  FilterRule,
  OptionCandidate,
  ScoredCandidate,
  ScreenerConfig,
  ScreenerId,
  ScreenerScenario,
  TrackingData,
  TrackingSignal,
} from "./lib/types";

const realOptions = realOptionsRaw as OptionCandidate[];
const realOptionsMeta = realOptionsMetaRaw as {
  generatedAt: string | null;
  session: string;
  candidateCount: number;
  reportPath: string | null;
  telegram?: {
    enabled: boolean;
    sent: boolean;
    error: string | null;
  };
};
const tracking = trackingRaw as unknown as TrackingData;
type DashboardView = "screener" | "tracker" | "youtuber" | "report";

type TradeValidationStatus = "supported" | "plausible" | "questionable" | "unsupported";

interface YouTuberTradeQuote {
  path: string;
  generatedAt: string;
  minutesFromTrade: number;
  bid: number;
  ask: number;
  mid: number;
  underlyingPrice: number;
  iv: number;
  delta: number;
  volume: number;
  openInterest: number;
}

interface YouTuberTrade {
  id: string;
  tradeDate: string;
  tradeTimeEt: string;
  observedAtSgt: string;
  broker: string;
  executionVenue: string;
  accountLabel?: string;
  ticker: string;
  companyName: string;
  action: "sell" | "buy";
  quantity: number;
  optionType: "put" | "call";
  expiration: string;
  strike: number;
  fillPrice: number;
  limitPrice: number;
  grossPremium: number;
  commission: number;
  realizedPnl: number;
  validation: {
    status: TradeValidationStatus;
    nearestBeforeSnapshot: YouTuberTradeQuote;
    nearestAfterSnapshot: YouTuberTradeQuote;
    assessment: string;
  };
}

interface YouTuberTradesData {
  schemaVersion: number;
  updatedAt: string;
  source: {
    type: string;
    path: string;
    visibleTradeCount: number;
    screenTradeCount: number;
    note: string;
  };
  trades: YouTuberTrade[];
}

const youtuberTrades = youtuberTradesRaw as unknown as YouTuberTradesData;

const sessionLabels: Record<string, string> = {
  pre_market: "Pre-market",
  open_30m: "Open +30m",
  hourly: "Hourly",
  half_hourly: "Half-hourly",
  pre_close: "Pre-close",
  close: "Close",
  manual: "Manual",
  none: "No snapshot",
};

function dataSourceLabel(dataSource: DataSourceMode): string {
  if (dataSource === "moomoo") return "Moomoo OpenD";
  return "Mock";
}

function formatFilterRule(filter: FilterRule): string {
  if (filter.operator === "between") {
    return `${filter.label}: ${filter.min}${filter.unit ?? ""}-${filter.max}${filter.unit ?? ""}`;
  }

  if (filter.operator === "gte") {
    return `${filter.label}: >=${filter.min}${filter.unit ?? ""}`;
  }

  return `${filter.label}: <=${filter.max}${filter.unit ?? ""}`;
}

function scoreTone(score: number): string {
  if (score >= 78) return "strong";
  if (score >= 62) return "watch";
  return "weak";
}

function filterStep(field: FilterRule["field"]): number {
  if (field === "delta" || field === "gamma" || field === "theta" || field === "vega") return 0.01;
  if (field === "spread" || field === "lastPrice" || field === "bid" || field === "ask") return 0.05;
  if (field === "dte" || field === "openInterest" || field === "volume") return 1;
  return 0.1;
}

function exportCsv(
  scenarioResults: Array<{ scenario: ScreenerScenario; rows: ScoredCandidate[] }>,
  config: ScreenerConfig,
): void {
  const headers = [
    "scenario",
    "ticker",
    "expiration",
    "dte",
    "strike",
    "underlyingPrice",
    "delta",
    "iv",
    "ivProxy",
    "bid",
    "ask",
    "mid",
    "spread",
    "openInterest",
    "volume",
    "score",
  ];
  const csv = [
    headers.join(","),
    ...scenarioResults.flatMap(({ scenario, rows }) =>
      rows.map((row) =>
        headers
          .map((header) => {
            const value =
              header === "scenario"
                ? scenario.name
                : header === "ivProxy"
                  ? row.ivPercentile
                  : row[header as keyof ScoredCandidate];
            return typeof value === "string" ? `"${value}"` : String(value ?? "");
          })
          .join(","),
      ),
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${config.id}-results.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SummaryMetric({
  label,
  value,
  subValue,
}: {
  label: string;
  value: string;
  subValue: string;
}) {
  return (
    <section className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{subValue}</small>
    </section>
  );
}

function formatMaybePercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return formatPercent(value, digits);
}

function formatMaybeNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return formatNumber(value, digits);
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortTime(value: string | null | undefined, timeZone = "America/New_York"): string {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function strategyLabel(strategy: TrackingSignal["strategy"]): string {
  return strategy === "weekly_csp" ? "Weekly CSP" : "LEAPS";
}

function outcomeTone(signal: TrackingSignal): string {
  const status = signal.outcome.status;
  if (status === "hit_80") return "strong";
  if (status === "expired_no_80") return "weak";
  return "watch";
}

function statusLabel(status: unknown): string {
  if (status === "hit_80") return "target hit";
  if (status === "expired_no_80") return "expired";
  if (typeof status === "string") return status.replace(/_/g, " ");
  return "tracking";
}

function formatPutStrikeDistance(underlyingPrice: number | null | undefined, strike: number): string {
  if (!underlyingPrice || !Number.isFinite(underlyingPrice) || underlyingPrice <= 0) return "N/A";
  const distancePct = ((underlyingPrice - strike) / underlyingPrice) * 100;
  const label = distancePct >= 0 ? "OTM" : "ITM";
  return `${formatPercent(Math.abs(distancePct), 1)} ${label}`;
}

function SignalTracker({ trackingData }: { trackingData: TrackingData }) {
  const signals = trackingData.signals;
  const summary = trackingData.summary ?? {};
  const weeklySignals = signals.filter((signal) => signal.strategy === "weekly_csp");
  const leapsSignals = signals.filter((signal) => signal.strategy === "leaps");
  const rows = [...weeklySignals, ...leapsSignals];
  const groupedRows = useMemo(() => {
    const groups = new Map<string, TrackingSignal[]>();

    rows.forEach((signal) => {
      const key = `${signal.signalAt}|${signal.session}|${signal.strategy}`;
      const group = groups.get(key) ?? [];
      group.push(signal);
      groups.set(key, group);
    });

    return Array.from(groups.entries()).map(([key, group]) => {
      const firstSignal = group[0];
      return {
        key,
        label: `${formatShortDate(firstSignal.signalAt)} · ${sessionLabels[firstSignal.session] ?? firstSignal.session}`,
        strategy: strategyLabel(firstSignal.strategy),
        count: group.length,
        signals: group,
      };
    });
  }, [rows]);

  return (
    <section className="wideWorkspace">
      <section className="sectionHead">
        <div className="titleLine">
          <Database size={19} />
          <h2>Signal Tracker</h2>
        </div>
        <p>追蹤每次 screener 入選 contract 後續報價，用來驗證 Weekly CSP 的 80% premium capture 與 LEAPS 的 mark-to-market 表現。</p>
      </section>

      <section className="overview reportOverview">
        <SummaryMetric
          label="Signals"
          value={String(summary.totalSignals ?? 0)}
          subValue={`Updated ${formatShortDate(trackingData.generatedAt)}`}
        />
        <SummaryMetric
          label="Open CSP"
          value={String(summary.weeklyCspOpen ?? 0)}
          subValue={`${summary.weeklyCspHit80 ?? 0} hit 80%`}
        />
        <SummaryMetric
          label="CSP 5D Hit"
          value={formatMaybePercent(summary.weeklyCspHitWithin5DRate, 1)}
          subValue="80% premium capture"
        />
        <SummaryMetric
          label="LEAPS Tracked"
          value={String(summary.leapsTracked ?? 0)}
          subValue={formatMaybePercent(summary.leapsAvgRelativeReturnPct, 1)}
        />
      </section>

      <div className="tableWrap">
        <table className="trackingTable">
          <thead>
            <tr>
              <th>Batch / Rank</th>
              <th>Contract</th>
              <th>Entry</th>
              <th>Latest</th>
              <th>Progress</th>
              <th>Risk</th>
              <th>Updates</th>
            </tr>
          </thead>
          <tbody>
            {groupedRows.map((group) => (
              <Fragment key={group.key}>
                <tr className="trackingGroupRow">
                  <td colSpan={7}>
                    <span className="strategyBadge">{group.strategy}</span>
                    <strong>{group.label}</strong>
                    <small>{group.count} ranked contracts in this screener run</small>
                  </td>
                </tr>
                {group.signals.map((signal) => {
                  const isWeekly = signal.strategy === "weekly_csp";
                  const capturePct = signal.outcome.bestProfitCapturePct as number | null;
                  const targetAsk = signal.outcome.targetAsk as number | null;
                  const latestUnderlying = signal.latest?.underlyingPrice ?? signal.entry.underlyingPrice;

                  return (
                    <tr key={signal.id}>
                      <td>
                        <span className={`score ${outcomeTone(signal)}`}>Rank #{signal.rank}</span>
                        <small>{sessionLabels[signal.session] ?? signal.session}</small>
                      </td>
                      <td>
                        <strong>
                          {signal.ticker} {signal.expiration} {signal.optionType.toUpperCase()} {formatCurrency(signal.strike, 0)}
                        </strong>
                        <small>Score {formatNumber(signal.score, 0)} · {signal.scenario}</small>
                      </td>
                      <td>
                        {formatCurrency(signal.entry.mid)}
                        <small>
                          Bid/Ask {formatCurrency(signal.entry.bid)} / {formatCurrency(signal.entry.ask)}
                        </small>
                      </td>
                      <td>
                        {signal.latest ? formatCurrency(signal.latest.mid) : "N/A"}
                        <small>{signal.latest ? formatShortDate(signal.latest.observedAt) : "No quote"}</small>
                      </td>
                      <td>
                        {isWeekly
                          ? `${formatMaybePercent(capturePct, 1)} premium captured`
                          : formatMaybePercent(signal.outcome.optionReturnPct as number | null, 1)}
                        <small>
                          {isWeekly
                            ? `Target ask <= ${targetAsk === null ? "N/A" : formatCurrency(targetAsk)}`
                            : `vs stock ${formatMaybePercent(signal.outcome.relativeReturnPct as number | null, 1)}`}
                        </small>
                      </td>
                      <td>
                        {isWeekly
                          ? formatPutStrikeDistance(latestUnderlying, signal.strike)
                          : `Delta ${formatMaybeNumber(signal.outcome.deltaChange as number | null, 2)}`}
                        <small>
                          {isWeekly
                            ? `Last ${formatCurrency(latestUnderlying)} · Strike ${formatCurrency(signal.strike, 0)}`
                            : `IV chg ${formatMaybePercent(signal.outcome.ivChange as number | null, 1)}`}
                        </small>
                      </td>
                      <td>
                        {signal.observations.count} checks
                        <small>{statusLabel(signal.outcome.status)}</small>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>No tracking signals yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StrategyReport({ trackingData }: { trackingData: TrackingData }) {
  const summary = trackingData.summary ?? {};
  const weekly = trackingData.signals.filter((signal) => signal.strategy === "weekly_csp");
  const leaps = trackingData.signals.filter((signal) => signal.strategy === "leaps");
  const recentWeekly = weekly.slice(0, 6);
  const recentLeaps = leaps.slice(0, 6);

  return (
    <section className="wideWorkspace">
      <section className="sectionHead">
        <div className="titleLine">
          <BarChart3 size={19} />
          <h2>Strategy Report</h2>
        </div>
        <p>用已累積 signals 估計策略有效性；早期樣本少時，這裡比較像儀表板的黑盒子測試台。</p>
      </section>

      <section className="overview reportOverview">
        <SummaryMetric
          label="CSP 5D 80% Hit"
          value={formatMaybePercent(summary.weeklyCspHitWithin5DRate, 1)}
          subValue={`${summary.weeklyCspHit80Within5D ?? 0} / ${summary.weeklyCspSignals ?? 0} signals`}
        />
        <SummaryMetric
          label="Avg Days to 80"
          value={formatMaybeNumber(summary.weeklyCspAvgDaysTo80, 1)}
          subValue={`${summary.weeklyCspOpen ?? 0} open CSP`}
        />
        <SummaryMetric
          label="LEAPS Avg Return"
          value={formatMaybePercent(summary.leapsAvgOptionReturnPct, 1)}
          subValue={`${summary.leapsTracked ?? 0} tracked`}
        />
        <SummaryMetric
          label="LEAPS vs Stock"
          value={formatMaybePercent(summary.leapsAvgRelativeReturnPct, 1)}
          subValue="relative return"
        />
      </section>

      <section className="reportGrid">
        <ReportList title="Recent Weekly CSP" signals={recentWeekly} />
        <ReportList title="Recent LEAPS" signals={recentLeaps} />
      </section>
    </section>
  );
}

function ReportList({ title, signals }: { title: string; signals: TrackingSignal[] }) {
  return (
    <section className="reportPanel">
      <h3>{title}</h3>
      <div className="signalList">
        {signals.map((signal) => (
          <div key={signal.id} className="signalItem">
            <div>
              <strong>
                {signal.ticker} {signal.expiration} {signal.optionType.toUpperCase()} {formatCurrency(signal.strike, 0)}
              </strong>
              <span>{formatShortDate(signal.signalAt)} · {strategyLabel(signal.strategy)}</span>
            </div>
            <span className={`score ${outcomeTone(signal)}`}>
              {signal.strategy === "weekly_csp"
                ? formatMaybePercent(signal.outcome.bestProfitCapturePct as number | null, 0)
                : formatMaybePercent(signal.outcome.optionReturnPct as number | null, 0)}
            </span>
          </div>
        ))}
        {signals.length === 0 && <p>No signals yet.</p>}
      </div>
    </section>
  );
}

function validationTone(status: TradeValidationStatus): string {
  if (status === "supported") return "strong";
  if (status === "plausible") return "watch";
  return "weak";
}

function validationLabel(status: TradeValidationStatus): string {
  if (status === "supported") return "Supported";
  if (status === "plausible") return "Plausible";
  if (status === "questionable") return "Questionable";
  return "Unsupported";
}

function findCurrentContract(trade: YouTuberTrade): OptionCandidate | undefined {
  return realOptions.find(
    (row) =>
      row.ticker === trade.ticker &&
      row.expiration === trade.expiration &&
      row.optionType === trade.optionType &&
      Math.abs(row.strike - trade.strike) < 0.001,
  );
}

function profitCapturePct(trade: YouTuberTrade, currentAsk: number | null): number | null {
  if (!currentAsk || trade.fillPrice <= 0) return null;
  return ((trade.fillPrice - currentAsk) / trade.fillPrice) * 100;
}

function tradeStatus(trade: YouTuberTrade, current: OptionCandidate | undefined): string {
  if (!current) return "No current quote";
  if (trade.optionType === "put" && current.underlyingPrice < trade.strike) return "ITM risk";
  if (trade.optionType === "call" && current.underlyingPrice > trade.strike) return "ITM risk";
  const capture = profitCapturePct(trade, current.ask);
  if (capture !== null && capture >= 80) return "Hit 80%";
  if (capture !== null && capture >= 50) return "Hit 50%";
  if (capture !== null && capture < 0) return "Premium up";
  return "Open OTM";
}

function tradeStatusTone(status: string): string {
  if (status === "ITM risk" || status === "Premium up") return "weak";
  if (status.includes("Hit")) return "strong";
  return "watch";
}

function YouTuberTracker({
  tradesData,
  generatedAt,
}: {
  tradesData: YouTuberTradesData;
  generatedAt: string | null;
}) {
  const rows = tradesData.trades.map((trade) => {
    const current = findCurrentContract(trade);
    const capture = profitCapturePct(trade, current?.ask ?? null);
    const collateral = trade.optionType === "put" ? trade.strike * trade.quantity * 100 : null;
    const returnOnCollateral = collateral ? (trade.grossPremium / collateral) * 100 : null;
    return { trade, current, capture, collateral, returnOnCollateral, status: tradeStatus(trade, current) };
  });
  const totalPremium = rows.reduce((sum, row) => sum + row.trade.grossPremium, 0);
  const totalCommission = rows.reduce((sum, row) => sum + row.trade.commission, 0);
  const supportedCount = rows.filter((row) => row.trade.validation.status === "supported").length;
  const plausibleCount = rows.filter((row) => row.trade.validation.status === "plausible").length;
  const avgCaptureRows = rows.filter((row) => row.capture !== null);
  const avgCapture =
    avgCaptureRows.length > 0
      ? avgCaptureRows.reduce((sum, row) => sum + (row.capture ?? 0), 0) / avgCaptureRows.length
      : null;

  return (
    <section className="wideWorkspace">
      <section className="sectionHead">
        <div>
          <div className="titleLine">
            <ClipboardList size={19} />
            <h2>AAG Tracker</h2>
          </div>
          <p>從 IBKR 截圖建立的外部交易紀錄，對照 archived option chain 與最新 snapshot，追蹤權利金收割與成交合理性。</p>
        </div>
      </section>

      <section className="overview reportOverview">
        <SummaryMetric label="Trades" value={String(rows.length)} subValue="Jun 9, 2026 screenshot" />
        <SummaryMetric label="Gross Premium" value={formatCurrency(totalPremium, 0)} subValue={`${formatCurrency(totalCommission)} commission`} />
        <SummaryMetric label="Validation" value={`${supportedCount}/${rows.length}`} subValue={`${plausibleCount} plausible`} />
        <SummaryMetric label="Avg Capture" value={avgCapture === null ? "N/A" : formatPercent(avgCapture, 1)} subValue={`Latest ${formatShortDate(generatedAt)}`} />
      </section>

      <div className="tableWrap">
        <table className="youtuberTable">
          <thead>
            <tr>
              <th>Trade</th>
              <th>Entry</th>
              <th>Current</th>
              <th>Premium Capture</th>
              <th>Risk</th>
              <th>Validation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ trade, current, capture, collateral, returnOnCollateral, status }) => {
              const latestAsk = current?.ask ?? null;
              const latestBid = current?.bid ?? null;
              const latestMid = current && Number.isFinite(current.bid) && Number.isFinite(current.ask)
                ? (current.bid + current.ask) / 2
                : null;

              return (
                <tr key={trade.id}>
                  <td>
                    <strong>
                      {trade.ticker} {trade.expiration} {trade.strike} {trade.optionType.toUpperCase()}
                    </strong>
                    <small>
                      {trade.action.toUpperCase()} {trade.quantity} · {trade.tradeTimeEt} ET · {trade.executionVenue}
                    </small>
                  </td>
                  <td>
                    {formatCurrency(trade.fillPrice)}
                    <small>
                      Gross {formatCurrency(trade.grossPremium, 0)} · Limit {formatCurrency(trade.limitPrice)}
                    </small>
                  </td>
                  <td>
                    {latestAsk === null ? "N/A" : formatCurrency(latestAsk)}
                    <small>
                      {latestBid === null || latestMid === null
                        ? "No matching latest quote"
                        : `Bid/Mid ${formatCurrency(latestBid)} / ${formatCurrency(latestMid)}`}
                    </small>
                  </td>
                  <td>
                    {capture === null ? "N/A" : formatPercent(capture, 1)}
                    <small>
                      {returnOnCollateral === null
                        ? "Return on collateral N/A"
                        : `${formatPercent(returnOnCollateral, 2)} initial ROC`}
                    </small>
                  </td>
                  <td>
                    <span className={`score ${tradeStatusTone(status)}`}>{status}</span>
                    <small>
                      {current
                        ? `${formatPutStrikeDistance(current.underlyingPrice, trade.strike)} · Stock ${formatCurrency(current.underlyingPrice)}`
                        : "Waiting for next matching snapshot"}
                    </small>
                  </td>
                  <td>
                    <span className={`score ${validationTone(trade.validation.status)}`}>
                      {validationLabel(trade.validation.status)}
                    </span>
                    <small>
                      Pre-fill quote {formatCurrency(trade.validation.nearestBeforeSnapshot.bid)} / {formatCurrency(trade.validation.nearestBeforeSnapshot.ask)}
                      {" · "}
                      Post-fill quote {formatCurrency(trade.validation.nearestAfterSnapshot.bid)} / {formatCurrency(trade.validation.nearestAfterSnapshot.ask)}
                    </small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="tradeDetailGrid">
        {rows.map(({ trade, current }) => (
          <article key={`${trade.id}-detail`} className="tradeDetail">
            <div className="detailHead">
              <div>
                <span>{trade.companyName}</span>
                <h3>
                  {trade.ticker} {trade.strike} {trade.optionType.toUpperCase()}
                </h3>
              </div>
              <span className={`score ${validationTone(trade.validation.status)}`}>{validationLabel(trade.validation.status)}</span>
            </div>
            <dl>
              <div>
                <dt>Pre-fill market</dt>
                <dd>
                  {formatCurrency(trade.validation.nearestBeforeSnapshot.bid)} / {formatCurrency(trade.validation.nearestBeforeSnapshot.ask)}
                </dd>
              </div>
              <div>
                <dt>Post-fill market</dt>
                <dd>
                  {formatCurrency(trade.validation.nearestAfterSnapshot.bid)} / {formatCurrency(trade.validation.nearestAfterSnapshot.ask)}
                </dd>
              </div>
              <div>
                <dt>Pre / post time</dt>
                <dd>
                  {formatShortTime(trade.validation.nearestBeforeSnapshot.generatedAt)} / {formatShortTime(trade.validation.nearestAfterSnapshot.generatedAt)}
                </dd>
              </div>
              <div>
                <dt>Latest bid / ask</dt>
                <dd>{current ? `${formatCurrency(current.bid)} / ${formatCurrency(current.ask)}` : "N/A"}</dd>
              </div>
              <div>
                <dt>Open interest</dt>
                <dd>{current ? compactNumber(current.openInterest) : compactNumber(trade.validation.nearestAfterSnapshot.openInterest)}</dd>
              </div>
            </dl>
            <p>{trade.validation.assessment}</p>
          </article>
        ))}
      </section>
    </section>
  );
}

function CandidateTable({
  config,
  scenario,
  filters,
  rows,
  selectedId,
  onSelect,
  onFilterChange,
  onResetFilters,
}: {
  config: ScreenerConfig;
  scenario: ScreenerScenario;
  filters: FilterRule[];
  rows: ScoredCandidate[];
  selectedId: string;
  onSelect: (id: string) => void;
  onFilterChange: (filterIndex: number, bound: "min" | "max", value: number | undefined) => void;
  onResetFilters: () => void;
}) {
  const isLeaps = config.id === "leaps_deep_itm_call";

  return (
    <section className={`scenarioPanel ${scenario.id}`}>
      <div className="scenarioHead">
        <div>
          <span>{scenario.shortName}</span>
          <h3>{scenario.name}</h3>
          <p>{scenario.intent}</p>
        </div>
        <strong>{rows.length}</strong>
      </div>

      <section className="filterRail">
        <SlidersHorizontal size={18} />
        <div>
          {filters.map((filter) => (
            <span key={`${filter.field}-${filter.label}`}>{formatFilterRule(filter)}</span>
          ))}
        </div>
      </section>

      <details className="filterEditor">
        <summary>Adjust filters</summary>
        <div className="filterGrid">
          {filters.map((filter, index) => (
            <label key={`${filter.field}-${filter.label}`} className="filterControl">
              <span>{filter.label}</span>
              {filter.operator === "between" && (
                <div>
                  <input
                    type="number"
                    step={filterStep(filter.field)}
                    value={filter.min ?? ""}
                    onChange={(event) =>
                      onFilterChange(index, "min", event.target.value === "" ? undefined : Number(event.target.value))
                    }
                  />
                  <input
                    type="number"
                    step={filterStep(filter.field)}
                    value={filter.max ?? ""}
                    onChange={(event) =>
                      onFilterChange(index, "max", event.target.value === "" ? undefined : Number(event.target.value))
                    }
                  />
                </div>
              )}
              {filter.operator === "gte" && (
                <div>
                  <input
                    type="number"
                    step={filterStep(filter.field)}
                    value={filter.min ?? ""}
                    onChange={(event) =>
                      onFilterChange(index, "min", event.target.value === "" ? undefined : Number(event.target.value))
                    }
                  />
                </div>
              )}
              {filter.operator === "lte" && (
                <div>
                  <input
                    type="number"
                    step={filterStep(filter.field)}
                    value={filter.max ?? ""}
                    onChange={(event) =>
                      onFilterChange(index, "max", event.target.value === "" ? undefined : Number(event.target.value))
                    }
                  />
                </div>
              )}
            </label>
          ))}
        </div>
        <button type="button" className="resetFilters" onClick={onResetFilters}>
          Reset {scenario.shortName}
        </button>
      </details>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Ticker</th>
              <th>Expiry</th>
              <th>DTE</th>
              <th>Strike</th>
              <th>Delta</th>
              <th>IV</th>
              <th>IV Proxy</th>
              <th>Bid/Ask</th>
              <th>{isLeaps ? "% Intrinsic" : "Ann. ROI"}</th>
              <th>{isLeaps ? "Leverage" : "% OTM"}</th>
              <th>OI</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${scenario.id}-${row.id}`}
                className={row.id === selectedId ? "selected" : ""}
                onClick={() => onSelect(row.id)}
              >
                <td>
                  <span className={`score ${scoreTone(row.score)}`}>{formatNumber(row.score, 0)}</span>
                </td>
                <td>
                  <strong>{row.ticker}</strong>
                  <small>{row.sector}</small>
                </td>
                <td>{row.expiration}</td>
                <td>{row.dte}</td>
                <td>{formatCurrency(row.strike, 0)}</td>
                <td>{formatNumber(row.delta, 2)}</td>
                <td>{formatPercent(row.iv, 1)}</td>
                <td>{formatPercent(row.ivPercentile, 0)}</td>
                <td>
                  {formatCurrency(row.bid)} / {formatCurrency(row.ask)}
                  <small>{formatCurrency(row.spread)} spread</small>
                </td>
                <td>{isLeaps ? formatPercent(row.intrinsicValuePct, 1) : formatPercent(row.annualizedRoi, 0)}</td>
                <td>{isLeaps ? `${formatNumber(row.leverageRatio, 1)}x` : formatPercent(row.distanceOtmPct, 1)}</td>
                <td>{compactNumber(row.openInterest)}</td>
                <td>{compactNumber(row.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailPanel({ row, config }: { row?: ScoredCandidate; config: ScreenerConfig }) {
  if (!row) {
    return (
      <aside className="detail empty">
        <Database size={22} />
        <strong>No candidate selected</strong>
      </aside>
    );
  }

  const isLeaps = config.id === "leaps_deep_itm_call";

  return (
    <aside className="detail">
      <div className="detailHead">
        <div>
          <span>{row.companyName}</span>
          <h2>
            {row.ticker} {row.expiration} {row.optionType.toUpperCase()} {formatCurrency(row.strike, 0)}
          </h2>
        </div>
        <span className={`score large ${scoreTone(row.score)}`}>{formatNumber(row.score, 0)}</span>
      </div>

      <div className="facts">
        <div>
          <span>Underlying</span>
          <strong>{formatCurrency(row.underlyingPrice)}</strong>
        </div>
        <div>
          <span>Mid</span>
          <strong>{formatCurrency(row.mid)}</strong>
        </div>
        <div>
          <span>Breakeven</span>
          <strong>{formatCurrency(row.breakeven)}</strong>
        </div>
        <div>
          <span>Spread</span>
          <strong>{formatCurrency(row.spread)}</strong>
        </div>
      </div>

      <div className="barGroup">
        <div className="barRow">
          <span>Liquidity</span>
          <div className="bar">
            <i style={{ width: `${Math.min(100, Math.log10(row.volume + row.openInterest + 1) * 16)}%` }} />
          </div>
        </div>
        <div className="barRow">
          <span>{isLeaps ? "Intrinsic" : "OTM Buffer"}</span>
          <div className="bar alt">
            <i style={{ width: `${Math.min(100, isLeaps ? row.intrinsicValuePct : row.distanceOtmPct * 9)}%` }} />
          </div>
        </div>
      </div>

      <dl>
        <div>
          <dt>Delta / Theta / Vega</dt>
          <dd>
            {formatNumber(row.delta, 2)} / {formatNumber(row.theta, 2)} / {formatNumber(row.vega, 2)}
          </dd>
        </div>
        <div>
          <dt>IV / IV Proxy</dt>
          <dd>
            {formatPercent(row.iv, 1)} / {formatPercent(row.ivPercentile, 0)}
          </dd>
        </div>
        <div>
          <dt>{isLeaps ? "Extrinsic Value" : "Cash Required"}</dt>
          <dd>{formatCurrency(isLeaps ? row.extrinsicValue : row.cashRequired, isLeaps ? 2 : 0)}</dd>
        </div>
        <div>
          <dt>Potential ROI</dt>
          <dd>{formatPercent(row.potentialRoi, 2)}</dd>
        </div>
      </dl>

      <div className="warningList">
        {row.warnings.map((warning) => (
          <span key={warning}>
            <AlertTriangle size={14} />
            {warning}
          </span>
        ))}
        {row.warnings.length === 0 && (
          <span className="clean">
            <CheckCircle2 size={14} />
            No active warnings
          </span>
        )}
      </div>
    </aside>
  );
}

export function App() {
  const [activeView, setActiveView] = useState<DashboardView>("screener");
  const [activeScreenerId, setActiveScreenerId] = useState<ScreenerId>("leaps_deep_itm_call");
  const [showAll, setShowAll] = useState(false);
  const realDataSource: DataSourceMode = realOptions.length > 0 ? "moomoo" : "mock";
  const [dataSource, setDataSource] = useState<DataSourceMode>(realDataSource);
  const [filterOverrides, setFilterOverrides] = useState<Record<string, FilterRule[]>>({});
  const activeConfig = screenerConfigs.find((config) => config.id === activeScreenerId) ?? screenerConfigs[0];
  const dataSet = dataSource !== "mock" && realOptions.length > 0 ? realOptions : mockOptions;
  const scenarioKey = (scenario: ScreenerScenario) => `${activeConfig.id}:${scenario.id}`;
  const scenarioResults = useMemo(
    () =>
      activeConfig.scenarios.map((scenario) => {
        const filters = filterOverrides[`${activeConfig.id}:${scenario.id}`] ?? scenario.filters;
        return {
          scenario,
          filters,
          rows: scoreCandidates(activeConfig, filters, dataSet, showAll),
          matchedRows: scoreCandidates(activeConfig, filters, dataSet, false),
        };
      }),
    [activeConfig, dataSet, filterOverrides, showAll],
  );
  const bestResult = scenarioResults.find((result) => result.scenario.id === "best") ?? scenarioResults[0];
  const middleResult = scenarioResults.find((result) => result.scenario.id === "middle") ?? scenarioResults[1];
  const allRows = scenarioResults.flatMap((result) => result.rows);
  const allMatchedRows = scenarioResults.flatMap((result) => result.matchedRows);
  const [selectedId, setSelectedId] = useState<string>("");
  const selectedRow = allRows.find((row) => row.id === selectedId) ?? allRows[0];

  const bestScore = allMatchedRows[0]?.score ?? 0;
  const avgSpread =
    allMatchedRows.length > 0 ? allMatchedRows.reduce((sum, row) => sum + row.spread, 0) / allMatchedRows.length : 0;
  const reportTime = realOptionsMeta.generatedAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(realOptionsMeta.generatedAt))
    : "Not generated";
  const sessionLabel = sessionLabels[realOptionsMeta.session] ?? realOptionsMeta.session;
  const telegramStatus = realOptionsMeta.telegram?.sent
    ? "Telegram sent"
    : realOptionsMeta.telegram?.enabled
      ? "Telegram failed"
      : "Telegram off";

  function updateScenarioFilter(
    scenario: ScreenerScenario,
    filterIndex: number,
    bound: "min" | "max",
    value: number | undefined,
  ): void {
    const key = scenarioKey(scenario);
    const currentFilters = filterOverrides[key] ?? scenario.filters;
    const nextFilters = currentFilters.map((filter, index) =>
      index === filterIndex ? { ...filter, [bound]: value } : filter,
    );
    setFilterOverrides((current) => ({ ...current, [key]: nextFilters }));
  }

  function resetScenarioFilters(scenario: ScreenerScenario): void {
    const key = scenarioKey(scenario);
    setFilterOverrides((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <span className="eyebrow">Option Chain Screener</span>
          <h1>Trading Idea Dashboard</h1>
        </div>
        <div className="actions">
          <button type="button" title="Refresh">
            <RefreshCw size={18} />
          </button>
          <button type="button" title="Telegram report">
            <Bell size={18} />
          </button>
          <button type="button" title="Export CSV" onClick={() => exportCsv(scenarioResults, activeConfig)}>
            <Download size={18} />
          </button>
        </div>
      </header>

      <section className="viewTabs" aria-label="Dashboard views">
        {[
          { id: "screener", label: "Today Screener", icon: Filter },
          { id: "tracker", label: "Signal Tracker", icon: Database },
          { id: "youtuber", label: "AAG Tracker", icon: ClipboardList },
          { id: "report", label: "Strategy Report", icon: BarChart3 },
        ].map((view) => {
          const Icon = view.icon;
          return (
            <button
              key={view.id}
              type="button"
              className={view.id === activeView ? "active" : ""}
              onClick={() => setActiveView(view.id as DashboardView)}
            >
              <Icon size={17} />
              <span>{view.label}</span>
            </button>
          );
        })}
      </section>

      {activeView === "screener" && (
        <section className="strategyTabs" aria-label="Screener strategies">
          {screenerConfigs.map((config) => (
          <button
            key={config.id}
            type="button"
            className={config.id === activeScreenerId ? "active" : ""}
            onClick={() => {
              setActiveScreenerId(config.id);
              setSelectedId("");
            }}
          >
            <TrendingUp size={17} />
            <span>{config.shortName}</span>
          </button>
          ))}
        </section>
      )}

      {activeView === "screener" && (
      <section className="overview">
        <SummaryMetric
          label="Best Case"
          value={String(bestResult?.matchedRows.length ?? 0)}
          subValue={`${bestResult?.rows.length ?? 0} visible rows`}
        />
        <SummaryMetric
          label="Middle Case"
          value={String(middleResult?.matchedRows.length ?? 0)}
          subValue={`${middleResult?.rows.length ?? 0} visible rows`}
        />
        <SummaryMetric label="Best Score" value={formatNumber(bestScore, 0)} subValue={activeConfig.shortName} />
        <SummaryMetric label="Avg Spread" value={formatCurrency(avgSpread)} subValue="all matched contracts" />
        <SummaryMetric
          label="Data Source"
          value={dataSourceLabel(dataSource !== "mock" && realOptions.length > 0 ? realDataSource : "mock")}
          subValue={`${sessionLabel} · ${reportTime}`}
        />
        <SummaryMetric
          label="Snapshot"
          value={String(realOptionsMeta.candidateCount || realOptions.length)}
          subValue={telegramStatus}
        />
      </section>
      )}

      {activeView === "tracker" && <SignalTracker trackingData={tracking} />}
      {activeView === "youtuber" && (
        <YouTuberTracker tradesData={youtuberTrades} generatedAt={realOptionsMeta.generatedAt} />
      )}
      {activeView === "report" && <StrategyReport trackingData={tracking} />}
      {activeView === "screener" && (
      <section className="workspace">
        <div className="primary">
          <section className="screenerHead">
            <div>
              <div className="titleLine">
                <Filter size={19} />
                <h2>{activeConfig.name}</h2>
              </div>
              <p>{activeConfig.intent}</p>
            </div>
            <div className="screenerControls">
              <label className="toggle">
                <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
                <span>Show rejects</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={dataSource !== "mock" && realOptions.length > 0}
                  disabled={realOptions.length === 0}
                  onChange={(event) => setDataSource(event.target.checked ? "moomoo" : "mock")}
                />
                <span>Real data</span>
              </label>
            </div>
          </section>

          <div className="scenarioStack">
            {scenarioResults.map((result) => (
              <CandidateTable
                key={result.scenario.id}
                config={activeConfig}
                scenario={result.scenario}
                filters={result.filters}
                rows={result.rows}
                selectedId={selectedRow?.id ?? ""}
                onSelect={setSelectedId}
                onFilterChange={(filterIndex, bound, value) =>
                  updateScenarioFilter(result.scenario, filterIndex, bound, value)
                }
                onResetFilters={() => resetScenarioFilters(result.scenario)}
              />
            ))}
          </div>
        </div>

        <DetailPanel row={selectedRow} config={activeConfig} />
      </section>
      )}
    </main>
  );
}
