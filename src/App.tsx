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
import realOptionsRaw from "./data/generated/realOptions.json";
import realOptionsMetaRaw from "./data/generated/realOptions.meta.json";
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

const sessionLabels: Record<string, string> = {
  pre_market: "Pre-market",
  open_30m: "Open +30m",
  hourly: "Hourly",
  pre_close: "Pre-close",
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
    </main>
  );
}
