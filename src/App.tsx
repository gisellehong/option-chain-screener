import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  Download,
  Filter,
  RefreshCw,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { mockOptions } from "./data/mockOptions";
import { screenerConfigs } from "./data/screenerConfigs";
import { compactNumber, formatCurrency, formatNumber, formatPercent } from "./lib/format";
import { scoreCandidates } from "./lib/scoring";
import type { ScoredCandidate, ScreenerConfig, ScreenerId } from "./lib/types";

function filterLabel(config: ScreenerConfig): string {
  return config.filters
    .map((filter) => {
      if (filter.operator === "between") {
        return `${filter.label}: ${filter.min}${filter.unit ?? ""}-${filter.max}${filter.unit ?? ""}`;
      }

      if (filter.operator === "gte") {
        return `${filter.label}: >=${filter.min}${filter.unit ?? ""}`;
      }

      return `${filter.label}: <=${filter.max}${filter.unit ?? ""}`;
    })
    .join("  ");
}

function scoreTone(score: number): string {
  if (score >= 78) return "strong";
  if (score >= 62) return "watch";
  return "weak";
}

function exportCsv(rows: ScoredCandidate[], config: ScreenerConfig): void {
  const headers = [
    "ticker",
    "expiration",
    "dte",
    "strike",
    "underlyingPrice",
    "delta",
    "iv",
    "ivPercentile",
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
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header as keyof ScoredCandidate];
          return typeof value === "string" ? `"${value}"` : String(value ?? "");
        })
        .join(","),
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

function CandidateTable({
  config,
  rows,
  selectedId,
  onSelect,
}: {
  config: ScreenerConfig;
  rows: ScoredCandidate[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const isLeaps = config.id === "leaps_deep_itm_call";

  return (
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
            <th>IV %ile</th>
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
              key={row.id}
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
          <dt>IV / IV Percentile</dt>
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
  const [activeScreenerId, setActiveScreenerId] = useState<ScreenerId>("leaps_deep_itm_call");
  const [showAll, setShowAll] = useState(false);
  const activeConfig = screenerConfigs.find((config) => config.id === activeScreenerId) ?? screenerConfigs[0];
  const rows = useMemo(() => scoreCandidates(activeConfig, mockOptions, showAll), [activeConfig, showAll]);
  const matchedRows = useMemo(() => scoreCandidates(activeConfig, mockOptions, false), [activeConfig]);
  const [selectedId, setSelectedId] = useState<string>("");
  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0];

  const bestScore = matchedRows[0]?.score ?? 0;
  const avgSpread =
    matchedRows.length > 0 ? matchedRows.reduce((sum, row) => sum + row.spread, 0) / matchedRows.length : 0;
  const reportTime = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

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
          <button type="button" title="Export CSV" onClick={() => exportCsv(rows, activeConfig)}>
            <Download size={18} />
          </button>
        </div>
      </header>

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

      <section className="overview">
        <SummaryMetric label="Matched" value={String(matchedRows.length)} subValue={`${rows.length} visible rows`} />
        <SummaryMetric label="Best Score" value={formatNumber(bestScore, 0)} subValue={activeConfig.shortName} />
        <SummaryMetric label="Avg Spread" value={formatCurrency(avgSpread)} subValue="matched contracts" />
        <SummaryMetric label="Data Source" value="Mock" subValue={`Updated ${reportTime}`} />
      </section>

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
            <label className="toggle">
              <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
              <span>Show rejects</span>
            </label>
          </section>

          <section className="filterRail">
            <SlidersHorizontal size={18} />
            <span>{filterLabel(activeConfig)}</span>
          </section>

          <CandidateTable
            config={activeConfig}
            rows={rows}
            selectedId={selectedRow?.id ?? ""}
            onSelect={setSelectedId}
          />
        </div>

        <DetailPanel row={selectedRow} config={activeConfig} />
      </section>
    </main>
  );
}
