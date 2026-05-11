import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { AgChartsEnterpriseModule } from "ag-charts-enterprise";
import { createChart, LineSeries } from "lightweight-charts";
import walletIcon from "../free-icon-wallet-3360459.png";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const columns = [
  "symbol",
  "account",
  "book",
  "quote",
  "fee_currency",
  "qty",
  "avg_open_price",
  "mark_price",
  "fee",
  "fee_usd",
  "realized_pnl",
  "unrealized_pnl",
  "net_pl_usd"
];

const defaultVisibleColumns = [
  "symbol",
  "mark_price",
  "fee",
  "fee_usd",
  "realized_pnl",
  "unrealized_pnl",
  "net_pl_usd"
];

const defaultPositionFilters = {
  calcDateFrom: "",
  calcDateTo: "",
  books: []
};

const DATE_PICKER_MIN = "1900-01-01";
const DATE_PICKER_MAX = "9999-12-31";
const FILTERS_WIDTH_STORAGE_KEY = "portfolioFiltersPanelWidth";
const DEFAULT_PANEL_WIDTH = 350;
const DEFAULT_SIDEBAR_WIDTH = DEFAULT_PANEL_WIDTH;
const MIN_SIDEBAR_WIDTH = 0;
const MAX_SIDEBAR_WIDTH = 420;
const PANEL_DRAG_CLOSE_THRESHOLD_PX = 150;
const DEFAULT_FILTERS_WIDTH = 380;
const MIN_FILTERS_WIDTH = 0;
const MAX_FILTERS_WIDTH = 560;
const AUTH_TOKEN_STORAGE_KEY = "portfolioAccessToken";
const POSITIONS_ROWS_CACHE_STORAGE_KEY = "portfolioPositionsRowsCache";
const POSITIONS_SYNC_AT_CACHE_STORAGE_KEY = "portfolioPositionsSyncAtCache";
const VISIBLE_COLUMNS_STORAGE_KEY = "portfolioVisibleColumns";
const TRADE_HISTORY_COLUMNS_STORAGE_PREFIX = "portfolioTradeHistoryColumns";

const taggedColumns = new Set(["symbol", "quote", "fee_currency"]);
const textColumns = new Set(["symbol", "account", "book", "quote", "fee_currency"]);
const pnlColumns = new Set(["realized_pnl", "unrealized_pnl", "net_pl_usd"]);
const usdColumns = new Set(["avg_open_price", "mark_price", "fee_usd", "realized_pnl", "unrealized_pnl", "net_pl_usd"]);
const numericColumns = new Set([
  "qty",
  "avg_open_price",
  "mark_price",
  "fee",
  "fee_usd",
  "realized_pnl",
  "unrealized_pnl",
  "net_pl_usd"
]);

const symbolQuoteSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USD", "EUR", "BTC", "ETH", "BNB"];
const coinMarketCapIdsByAsset = {
  BTC: 1,
  ETH: 1027,
  XRP: 52,
  USDT: 825,
  BNB: 1839,
  SOL: 5426,
  USDC: 3408,
  DOGE: 74,
  ADA: 2010,
  TRX: 1958,
  LINK: 1975,
  AVAX: 5805,
  TON: 11419,
  SHIB: 5994,
  DOT: 6636,
  LTC: 2,
  BCH: 1831,
  XLM: 512,
  UNI: 7083,
  ATOM: 3794,
  ETC: 1321,
  FIL: 2280,
  NEAR: 6535,
  APT: 21794,
  ARB: 11841,
  OP: 11840,
  SUI: 20947
};

const enterpriseGridModules = [AllEnterpriseModule.with(AgChartsEnterpriseModule)];
ModuleRegistry.registerModules(enterpriseGridModules);

const trendSeriesPalette = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#22c55e",
];

function formatValue(value) {
  if (value === null || value === undefined) return "—";
  const str = String(value);
  if (/^0E-?\d+$/i.test(str)) return "0";
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return formatNumericValue(str, { maximumFractionDigits: 6 });
  }
  return str;
}

function getNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumericValue(value, options = {}) {
  const numeric = getNumber(value);
  if (numeric === null) return "—";
  const minimumFractionDigits = Number.isInteger(options.minimumFractionDigits)
    ? options.minimumFractionDigits
    : 0;
  const maximumFractionDigits = Number.isInteger(options.maximumFractionDigits)
    ? options.maximumFractionDigits
    : 6;
  return new Intl.NumberFormat("en-US", {
    useGrouping: false,
    minimumFractionDigits,
    maximumFractionDigits
  }).format(numeric);
}

function formatQtyValue(value) {
  return formatNumericValue(value, { minimumFractionDigits: 1, maximumFractionDigits: 4 });
}

function formatCompactQtyValue(value) {
  const numeric = getNumber(value);
  if (numeric === null) return "—";
  const absValue = Math.abs(numeric);
  if (absValue < 1000) {
    return formatQtyValue(numeric);
  }

  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" }
  ];
  const unit = units.find((item) => absValue >= item.threshold);
  if (!unit) return formatQtyValue(numeric);

  const scaled = numeric / unit.threshold;
  const compact = formatNumericValue(scaled, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "")
    .replace(/\.$/, "");
  return `${compact}${unit.suffix}`;
}

function buildQtyTitle(rawQty, rowData) {
  const exactQty = formatQtyValue(rawQty);
  if (exactQty === "—") return "";
  const symbol = formatValue(rowData?.symbol);
  return symbol !== "—"
    ? `Exact quantity for ${symbol}: ${exactQty}`
    : `Exact quantity: ${exactQty}`;
}

function parseTrendTimeToUnix(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return Math.floor(parsedDate.getTime() / 1000);
}

function normalizeTrendPoints(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];
  const points = [];
  let lastTime = 0;

  rawPoints.forEach((rawPoint, index) => {
    if (rawPoint && typeof rawPoint === "object" && !Array.isArray(rawPoint)) {
      const value = getNumber(rawPoint.value);
      const parsedTime = parseTrendTimeToUnix(rawPoint.time);
      if (value === null || parsedTime === null) return;
      const time = parsedTime > lastTime ? parsedTime : lastTime + 1;
      lastTime = time;
      points.push({ time, value });
      return;
    }

    const value = getNumber(rawPoint);
    if (value === null) return;
    const time = Math.max(lastTime + 1, index + 1);
    lastTime = time;
    points.push({ time, value });
  });

  return points;
}

function formatTrendTooltipTime(rawTime) {
  if (rawTime === null || rawTime === undefined) return "";
  if (typeof rawTime === "number" && Number.isFinite(rawTime)) {
    return new Date(rawTime * 1000).toLocaleString();
  }
  if (typeof rawTime === "object" && rawTime.year && rawTime.month && rawTime.day) {
    const month = String(rawTime.month).padStart(2, "0");
    const day = String(rawTime.day).padStart(2, "0");
    return `${rawTime.year}-${month}-${day}`;
  }
  const parsedDate = new Date(rawTime);
  if (Number.isNaN(parsedDate.getTime())) return String(rawTime);
  return parsedDate.toLocaleString();
}

const trendTickLabelFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function trendTimeToDate(rawTime) {
  if (rawTime === null || rawTime === undefined) return null;
  if (typeof rawTime === "number" && Number.isFinite(rawTime)) {
    const date = new Date(rawTime * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof rawTime === "object" && rawTime.year && rawTime.month && rawTime.day) {
    const date = new Date(Date.UTC(rawTime.year, rawTime.month - 1, rawTime.day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsedDate = new Date(rawTime);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function formatTrendTick(rawTime) {
  const date = trendTimeToDate(rawTime);
  if (!date) return "";
  return trendTickLabelFormatter.format(date).replace(",", "");
}

function formatTradeTimestamp(rawValue) {
  if (!rawValue) return "—";
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return String(rawValue);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${min}:${sec}`;
}

function formatTradeQuickFilterText(rawValue) {
  if (!rawValue) return "";
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return String(rawValue);

  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");

  const us = `${mm}/${dd}/${yyyy}`;
  const dotted = `${dd}.${mm}.${yyyy}`;
  const iso = `${yyyy}-${mm}-${dd}`;
  const time = `${hh}:${min}:${sec}`;

  return `${formatTradeTimestamp(rawValue)} ${us} ${dotted} ${iso} ${time}`;
}

function buildPositionTrendKey(row = {}) {
  return String(row.symbol ?? "").trim().toUpperCase();
}

function buildPositionRowId(row = {}) {
  return [
    row.calc_date ?? "",
    row.symbol ?? "",
    row.account ?? "",
    row.book ?? "",
    row.quote ?? "",
    row.fee_currency ?? ""
  ].join("|");
}

function formatCompactUsd(value) {
  const numeric = getNumber(value);
  if (numeric === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2
  }).format(numeric);
}

function formatPercent(value) {
  const numeric = getNumber(value);
  if (numeric === null) return "—";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

function formatDollarValue(value) {
  const numeric = getNumber(value);
  if (numeric === null) return "—";
  const absValue = Math.abs(numeric);
  const rendered = formatNumericValue(absValue, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (rendered === "—") return rendered;
  return numeric < 0 ? `-$${rendered}` : `$${rendered}`;
}

function toTitleCaseLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeLooseSearch(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function getPnlRoiPercent(row, pnlValue) {
  const qty = getNumber(row?.qty);
  const avgOpenPrice = getNumber(row?.avg_open_price);
  const markPrice = getNumber(row?.mark_price);
  const pnl = getNumber(pnlValue);
  const basis = avgOpenPrice ?? markPrice;
  if (qty === null || basis === null || basis === 0 || pnl === null) return null;
  const notional = Math.abs(qty * basis);
  if (notional === 0) return null;
  return (pnl / notional) * 100;
}

function buildSparklineModel(values, width = 220, height = 44, padding = 3) {
  const series = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
  if (series.length < 2) {
    return {
      width,
      height,
      path: "",
      points: []
    };
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2;

  const points = series.map((point, index) => {
    const x = padding + (index / (series.length - 1)) * drawableWidth;
    const y = padding + (1 - (point - min) / range) * drawableHeight;
    return { x, y, value: point };
  });

  const path = points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(" ");

  return {
    width,
    height,
    path,
    points
  };
}

function getPnlClass(column, value) {
  if (!pnlColumns.has(column)) return "";
  const numeric = getNumber(value);
  if (numeric === null || numeric === 0) return "pnl-neutral";
  return numeric > 0 ? "pnl-positive" : "pnl-negative";
}

function getSymbolAssetCode(symbolValue) {
  const normalized = String(symbolValue ?? "")
    .trim()
    .toUpperCase();
  if (!normalized) return "";

  if (normalized.includes("/")) {
    return normalized.split("/")[0] || normalized;
  }

  if (normalized.includes("-")) {
    return normalized.split("-")[0] || normalized;
  }

  for (const suffix of symbolQuoteSuffixes) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      return normalized.slice(0, -suffix.length);
    }
  }

  return normalized;
}

function getSymbolIconUrl(symbolValue) {
  const baseAsset = getSymbolAssetCode(symbolValue);
  const coinId = coinMarketCapIdsByAsset[baseAsset];
  if (!coinId) return "";
  return `https://s2.coinmarketcap.com/static/img/coins/64x64/${coinId}.png`;
}

function SymbolToken({ value }) {
  const iconUrl = getSymbolIconUrl(value);
  const baseAsset = getSymbolAssetCode(value);
  const [isIconLoadFailed, setIsIconLoadFailed] = useState(false);

  useEffect(() => {
    setIsIconLoadFailed(false);
  }, [iconUrl]);

  const fallbackLabel = baseAsset ? baseAsset.slice(0, 1) : "?";
  const canShowIcon = Boolean(iconUrl) && !isIconLoadFailed;
  const normalizedValue = formatValue(value);

  return (
    <span className="symbol-inline">
      <span className="symbol-icon-wrap">
        {canShowIcon ? (
          <img
            className="token-icon-img"
            src={iconUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setIsIconLoadFailed(true)}
          />
        ) : (
          <span className="token-icon-fallback" aria-hidden="true">
            {fallbackLabel}
          </span>
        )}
      </span>
      <span className="token token-symbol symbol-text-pill">
        <span className="symbol-label">{normalizedValue}</span>
      </span>
    </span>
  );
}

function PasswordVisibilityIcon({ visible }) {
  if (visible) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
        <path
          d="M2.5 12s3.7-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.7 6.5-9.5 6.5S2.5 12 2.5 12Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path
        d="M2.5 12s3.7-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.7 6.5-9.5 6.5S2.5 12 2.5 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M4 20L20 4" strokeLinecap="round" />
    </svg>
  );
}

function PortfolioHeaderTitle() {
  return (
    <h1 className="page-title page-title-accent">
      <span className="page-title-fin-icon" aria-hidden>
        <img src={walletIcon} alt="" />
      </span>
      <span className="page-title-primary">PORTFOLIO</span>
    </h1>
  );
}

function PnlTrendCell({ value }) {
  const hostRef = useRef(null);
  const trendPoints = useMemo(
    () => normalizeTrendPoints(value),
    [value]
  );

  useEffect(() => {
    if (!hostRef.current || trendPoints.length < 2) return;
    const width = Math.max(120, Math.floor(hostRef.current.clientWidth || 180));

    const chart = createChart(hostRef.current, {
      width,
      height: 34,
      layout: {
        background: { color: "transparent" },
        textColor: "transparent",
        attributionLogo: false
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false }
      },
      rightPriceScale: {
        visible: false,
        borderVisible: false
      },
      leftPriceScale: {
        visible: false,
        borderVisible: false
      },
      timeScale: {
        visible: false,
        borderVisible: false
      },
      crosshair: {
        vertLine: { visible: false },
        horzLine: { visible: false }
      },
      handleScroll: false,
      handleScale: false
    });
    const series = chart.addSeries(LineSeries, {
      color: "#4e8ecf",
      lineWidth: 2,
      priceLineVisible: false
    });
    series.setData(trendPoints);
    chart.timeScale().fitContent();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.max(120, Math.floor(entry.contentRect.width || 180));
      chart.applyOptions({ width: nextWidth });
      chart.timeScale().fitContent();
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [trendPoints]);

  return (
    <div className="pnl-trend-sparkline-wrap">
      {trendPoints.length >= 2 ? (
        <div ref={hostRef} className="pnl-trend-sparkline" />
      ) : (
        <div className="pnl-trend-empty">—</div>
      )}
    </div>
  );
}

function TrendFullscreenModal({ trendItem, onClose, isDarkTheme }) {
  const hostRef = useRef(null);
  const [hiddenAccounts, setHiddenAccounts] = useState(new Set());
  const [tooltip, setTooltip] = useState(null);
  const trendPoints = useMemo(
    () => normalizeTrendPoints(trendItem?.points),
    [trendItem]
  );
  const accountSeries = useMemo(() => {
    const seriesByAccount = trendItem?.seriesByAccount;
    if (!seriesByAccount || typeof seriesByAccount !== "object") return [];

    return Object.entries(seriesByAccount)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([account, points], index) => {
        const normalized = normalizeTrendPoints(points);
        return {
          account,
          color: trendSeriesPalette[index % trendSeriesPalette.length],
          points: normalized
        };
      })
      .filter((series) => series.account && series.points.length >= 2);
  }, [trendItem]);
  const visibleAccountSeries = useMemo(
    () => accountSeries.filter((series) => !hiddenAccounts.has(series.account)),
    [accountSeries, hiddenAccounts]
  );

  useEffect(() => {
    setHiddenAccounts(new Set());
    setTooltip(null);
  }, [trendItem?.symbol]);

  useEffect(() => {
    if (!hostRef.current) return;

    const multiSeriesMode = accountSeries.length > 0;
    const hasSingleSeriesData = !multiSeriesMode && trendPoints.length >= 2;
    const hasMultiSeriesData = multiSeriesMode && visibleAccountSeries.length > 0;
    if (!hasSingleSeriesData && !hasMultiSeriesData) return;

    const chart = createChart(hostRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: isDarkTheme ? "#9fb0c8" : "#5b6a7c",
        attributionLogo: false
      },
      grid: {
        vertLines: { color: isDarkTheme ? "#334155" : "#edf2f8" },
        horzLines: { color: isDarkTheme ? "#334155" : "#edf2f8" }
      },
      rightPriceScale: {
        borderColor: isDarkTheme ? "#334155" : "#d3dbe6"
      },
      localization: {
        locale: "ru-RU"
      },
      timeScale: {
        borderColor: isDarkTheme ? "#334155" : "#d3dbe6",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time) => formatTrendTick(time)
      },
      crosshair: {
        vertLine: { color: isDarkTheme ? "#6f8caf" : "#7f93ae", width: 1 },
        horzLine: { color: isDarkTheme ? "#6f8caf" : "#7f93ae", width: 1 }
      },
      handleScroll: true,
      handleScale: true
    });
    const renderedSeries = [];
    if (multiSeriesMode) {
      visibleAccountSeries.forEach((accountSeriesItem) => {
        const lineSeries = chart.addSeries(LineSeries, {
          color: accountSeriesItem.color,
          lineWidth: 2.2,
          priceLineVisible: false
        });
        lineSeries.setData(accountSeriesItem.points);
        renderedSeries.push({
          account: accountSeriesItem.account,
          color: accountSeriesItem.color,
          series: lineSeries
        });
      });
    } else {
      const lineSeries = chart.addSeries(LineSeries, {
        color: isDarkTheme ? "#7db5f0" : "#4e8ecf",
        lineWidth: 2.4,
        priceLineVisible: false
      });
      lineSeries.setData(trendPoints);
      renderedSeries.push({
        account: "Total",
        color: isDarkTheme ? "#7db5f0" : "#4e8ecf",
        series: lineSeries
      });
    }
    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param?.point || !param?.seriesData) {
        setTooltip(null);
        return;
      }
      const values = [];
      renderedSeries.forEach((seriesMeta) => {
        const item = param.seriesData.get(seriesMeta.series);
        if (!item || typeof item.value !== "number") return;
        values.push({
          account: seriesMeta.account,
          color: seriesMeta.color,
          value: item.value
        });
      });
      if (values.length === 0) {
        setTooltip(null);
        return;
      }
      values.sort((a, b) => b.value - a.value);
      setTooltip({
        x: param.point.x,
        y: param.point.y,
        timeLabel: formatTrendTooltipTime(param.time),
        values
      });
    });

    return () => chart.remove();
  }, [accountSeries, isDarkTheme, trendPoints, visibleAccountSeries]);

  if (!trendItem) return null;
  const multiSeriesMode = accountSeries.length > 0;

  return (
    <div className="trend-modal-backdrop" onClick={onClose}>
      <section
        className="trend-modal"
        role="dialog"
        aria-modal="true"
        aria-label="PnL Trend chart"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="trend-modal-head">
          <div className="trend-modal-title-wrap">
            <h2>PnL Trend</h2>
            <p>
              {trendItem.symbol}
              {multiSeriesMode ? " · by account" : ""}
            </p>
          </div>
          <button type="button" className="trend-modal-close" onClick={onClose} aria-label="Close chart">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="trend-modal-stage">
          <div className="trend-modal-plot-wrap">
            {(multiSeriesMode ? visibleAccountSeries.length > 0 : trendPoints.length >= 2) ? (
              <div ref={hostRef} className="trend-modal-chart" />
            ) : (
              <div className="trend-modal-empty">
                {multiSeriesMode ? "All account lines are hidden" : "No trend data"}
              </div>
            )}
            {tooltip && (
              <div
                className="trend-modal-tooltip"
                style={{
                  left: `${tooltip.x}px`,
                  top: `${tooltip.y}px`
                }}
              >
                {tooltip.timeLabel && (
                  <div className="trend-modal-tooltip-time">{tooltip.timeLabel}</div>
                )}
                {tooltip.values.map((valueItem) => (
                  <div key={valueItem.account} className="trend-modal-tooltip-row">
                    <span className="trend-modal-tooltip-dot" style={{ background: valueItem.color }} />
                    <span className="trend-modal-tooltip-name">{valueItem.account}</span>
                    <span className="trend-modal-tooltip-value">{formatDollarValue(valueItem.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {multiSeriesMode && (
            <aside className="trend-modal-legend" aria-label="Accounts and line colors">
              <h3>Accounts</h3>
              <div className="trend-modal-legend-list">
                {accountSeries.map((series) => {
                  const hidden = hiddenAccounts.has(series.account);
                  return (
                    <button
                      key={series.account}
                      type="button"
                      className={`trend-modal-legend-item ${hidden ? "is-hidden" : ""}`}
                      onClick={() => {
                        setHiddenAccounts((prev) => {
                          const next = new Set(prev);
                          if (next.has(series.account)) {
                            next.delete(series.account);
                          } else {
                            next.add(series.account);
                          }
                          return next;
                        });
                      }}
                      title={hidden ? "Show line" : "Hide line"}
                    >
                      <span className="trend-modal-legend-color" style={{ background: series.color }} />
                      <span className="trend-modal-legend-name">{series.account}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </section>
    </div>
  );
}

function SymbolTradeHistoryModal({ symbol, rows, loading, error, onClose }) {
  const tradeColumnsDropdownRef = useRef(null);
  const tradeColumns = useMemo(
    () => ["time", "symbol", "account", "book", "quote", "fee_currency", "side", "qty", "price", "fee"],
    []
  );
  const [quickFilterText, setQuickFilterText] = useState("");
  const [visibleColumns, setVisibleColumns] = useState(tradeColumns);
  const [isColumnsDropdownOpen, setIsColumnsDropdownOpen] = useState(false);
  const tradeColumnsStorageKey = useMemo(
    () => `${TRADE_HISTORY_COLUMNS_STORAGE_PREFIX}:${String(symbol ?? "").trim().toUpperCase() || "unknown"}`,
    [symbol]
  );

  useEffect(() => {
    setQuickFilterText("");
    setIsColumnsDropdownOpen(false);
    try {
      const raw = localStorage.getItem(tradeColumnsStorageKey);
      if (!raw) {
        setVisibleColumns(tradeColumns);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setVisibleColumns(tradeColumns);
        return;
      }
      const selected = new Set(parsed.filter((item) => tradeColumns.includes(item)));
      const normalized = tradeColumns.filter((column) => selected.has(column));
      setVisibleColumns(normalized.length > 0 ? normalized : tradeColumns);
    } catch {
      setVisibleColumns(tradeColumns);
    }
  }, [symbol, tradeColumns, tradeColumnsStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(tradeColumnsStorageKey, JSON.stringify(visibleColumns));
    } catch {
    }
  }, [visibleColumns, tradeColumnsStorageKey]);

  useEffect(() => {
    if (!isColumnsDropdownOpen) return;
    function handlePointerDown(event) {
      if (tradeColumnsDropdownRef.current && !tradeColumnsDropdownRef.current.contains(event.target)) {
        setIsColumnsDropdownOpen(false);
      }
    }
    function handleEscape(event) {
      if (event.key === "Escape") setIsColumnsDropdownOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isColumnsDropdownOpen]);

  function toggleVisibleColumn(column) {
    setVisibleColumns((prev) => {
      if (prev.includes(column)) {
        if (prev.length === 1) return prev;
        const next = new Set(prev.filter((item) => item !== column));
        return tradeColumns.filter((item) => next.has(item));
      }
      const next = new Set([...prev, column]);
      return tradeColumns.filter((item) => next.has(item));
    });
  }

  const tradeHistoryRows = useMemo(
    () =>
      (Array.isArray(rows) ? rows : []).map((row, index) => ({
        ...row,
        _row_id: `${row.time || "t"}|${row.account || "a"}|${index}`
      })),
    [rows]
  );

  const tradeHistoryDefaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      filter: false,
      floatingFilter: false
    }),
    []
  );

  const tradeHistoryColumnDefs = useMemo(() => {
    const columnMeta = {
      time: {
        minWidth: 190,
        flex: 1.5,
        cellClass: "cell-text",
        renderer: (v) => formatTradeTimestamp(v),
        quickText: (v) => formatTradeQuickFilterText(v)
      },
      symbol: {
        minWidth: 140, flex: 1, cellClass: "cell-text", renderer: (v) => {
          const value = formatValue(v);
          return value !== "—" ? <SymbolToken value={value} /> : value;
        },
        quickText: (v) => String(v ?? "")
      },
      account: { minWidth: 170, flex: 1.25, cellClass: "cell-text", renderer: (v) => formatValue(v), quickText: (v) => String(v ?? "") },
      book: { minWidth: 150, flex: 1.1, cellClass: "cell-text", renderer: (v) => formatValue(v), quickText: (v) => String(v ?? "") },
      quote: {
        minWidth: 130, flex: 0.9, cellClass: "cell-text", renderer: (v) => {
          const value = formatValue(v);
          return value !== "—" ? <span className="token token-quote">{value}</span> : value;
        },
        quickText: (v) => String(v ?? "")
      },
      fee_currency: {
        minWidth: 150, flex: 0.9, cellClass: "cell-text", renderer: (v) => {
          const value = formatValue(v);
          return value !== "—" ? <span className="token token-fee-currency">{value}</span> : value;
        },
        quickText: (v) => String(v ?? "")
      },
      side: {
        minWidth: 110, maxWidth: 130, flex: 0.8,
        cellClass: (params) => {
          const normalized = String(params.value ?? "").toLowerCase();
          return normalized === "buy" ? "trade-side-buy cell-text" : "trade-side-sell cell-text";
        },
        renderer: (v) => {
          const value = String(v ?? "").trim();
          return value ? value : "—";
        },
        quickText: (v) => String(v ?? "")
      },
      qty: {
        minWidth: 140,
        flex: 1,
        cellClass: "cell-num",
        renderer: (v) => {
          const compactQty = formatCompactQtyValue(v);
          if (compactQty === "—") return compactQty;
          return <span className="qty-display" title={`Exact quantity: ${formatQtyValue(v)}`}>{compactQty}</span>;
        },
        quickText: (v) => String(v ?? "")
      },
      price: { minWidth: 140, flex: 1, cellClass: "cell-num", renderer: (v) => formatNumericValue(v, { maximumFractionDigits: 6 }), quickText: (v) => String(v ?? "") },
      fee: { minWidth: 140, flex: 1, cellClass: "cell-num", renderer: (v) => formatNumericValue(v, { maximumFractionDigits: 4 }), quickText: (v) => String(v ?? "") }
    };

    return visibleColumns.map((column) => {
      const meta = columnMeta[column];
      return {
        field: column,
        headerName:
          column === "qty" ? "QTY" : toTitleCaseLabel(column.replaceAll("_", " ")).toUpperCase(),
        minWidth: meta?.minWidth ?? 130,
        maxWidth: meta?.maxWidth,
        flex: meta?.flex ?? 1,
        cellClass: meta?.cellClass ?? "cell-text",
        cellRenderer: (params) => (meta?.renderer ? meta.renderer(params.value, params) : formatValue(params.value)),
        getQuickFilterText: (params) => (meta?.quickText ? String(meta.quickText(params.value, params) ?? "") : String(params.value ?? ""))
      };
    });
  }, [visibleColumns]);

  return (
    <div className="trend-modal-backdrop" onClick={onClose}>
      <section
        className="trend-modal trade-history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Trade history"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="trend-modal-head">
          <div className="trend-modal-title-wrap">
            <h2>Trade History</h2>
            <p>{symbol}</p>
          </div>
          <button type="button" className="trend-modal-close" onClick={onClose} aria-label="Close trade history">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="trade-history-modal-body">
          {loading && <div className="trend-modal-empty">Loading trade history...</div>}
          {!loading && error && <div className="error trade-history-error">{error}</div>}
          {!loading && !error && rows.length === 0 && <div className="trend-modal-empty">No trades found.</div>}
          {!loading && !error && rows.length > 0 && (
            <>
              <section className="positions-toolbar positions-toolbar-embedded trade-history-toolbar">
                <div className="positions-toolbar-left">
                  <input
                    className="positions-quick-filter-input"
                    type="text"
                    placeholder="Quick filter"
                    value={quickFilterText}
                    onChange={(event) => setQuickFilterText(event.target.value)}
                  />
                </div>
                <div className="positions-toolbar-right">
                  <div className="positions-columns-dropdown" ref={tradeColumnsDropdownRef}>
                    <button
                      type="button"
                      className="secondary-button market-button market-button-accent market-split-button"
                      onClick={() => setIsColumnsDropdownOpen((prev) => !prev)}
                      aria-haspopup="menu"
                      aria-expanded={isColumnsDropdownOpen}
                    >
                      <span className="market-split-button-label">
                        Column Filters
                        <span className="market-split-button-count-plain">{visibleColumns.length}</span>
                      </span>
                      <span className="market-split-button-caret" aria-hidden>
                        ▾
                      </span>
                    </button>
                    {isColumnsDropdownOpen && (
                      <div className="positions-columns-dropdown-menu" role="menu">
                        <div className="positions-columns-wrap">
                          <div className="positions-columns">
                            {tradeColumns.map((column) => (
                              <label key={column} className="column-toggle">
                                <input
                                  type="checkbox"
                                  checked={visibleColumns.includes(column)}
                                  onChange={() => toggleVisibleColumn(column)}
                                />
                                <span>{toTitleCaseLabel(column.replaceAll("_", " "))}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
              <div className="trade-history-grid-wrap ag-theme-quartz">
              <AgGridReact
                modules={enterpriseGridModules}
                rowData={tradeHistoryRows}
                columnDefs={tradeHistoryColumnDefs}
                defaultColDef={tradeHistoryDefaultColDef}
                quickFilterText={quickFilterText}
                rowHeight={42}
                headerHeight={44}
                animateRows={false}
                getRowId={(params) => params.data._row_id}
                pagination
                paginationPageSize={25}
                paginationPageSizeSelector={[25, 50, 100]}
              />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function SidebarNavIcon({ section }) {
  if (section === "positions") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M4 17.5h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="6" y="10.5" width="2.6" height="5" rx="0.8" fill="currentColor" />
        <rect x="10.7" y="7.5" width="2.6" height="8" rx="0.8" fill="currentColor" />
        <rect x="15.4" y="9.2" width="2.6" height="6.3" rx="0.8" fill="currentColor" />
      </svg>
    );
  }

  if (section === "books") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M6 5.5h10.5A1.5 1.5 0 0 1 18 7v11.5H7.5A2.5 2.5 0 0 1 5 16V6.5A1 1 0 0 1 6 5.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8 9h7.5M8 12h7.5M8 15h5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3.7 5.5 6v5.4c0 4.4 2.8 7.2 6.5 8.9 3.7-1.7 6.5-4.5 6.5-8.9V6L12 3.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.4 11.7h5.2M12 9.2v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function renderCell(column, rawValue, rowData, options = {}) {
  if (pnlColumns.has(column)) {
    const pnlDisplay = formatDollarValue(rawValue);
    const roiPercent = getPnlRoiPercent(rowData, rawValue);
    return (
      <span className="pnl-stack">
        <span className="pnl-main">{pnlDisplay}</span>
        <span className="pnl-percent">{formatPercent(roiPercent)}</span>
      </span>
    );
  }

  const value = formatValue(rawValue);
  if (usdColumns.has(column)) {
    return formatDollarValue(rawValue);
  }
  if (column === "qty") {
    const compactQty = formatCompactQtyValue(rawValue);
    if (compactQty === "—") return compactQty;
    return (
      <span className="qty-display" title={buildQtyTitle(rawValue, rowData)}>
        {compactQty}
      </span>
    );
  }
  if (column === "fee") {
    return formatNumericValue(rawValue, { maximumFractionDigits: 4 });
  }
  if (numericColumns.has(column)) {
    return formatNumericValue(rawValue, { maximumFractionDigits: 6 });
  }
  if (column === "symbol" && value !== "—") {
    if (typeof options.onSymbolClick === "function") {
      return (
        <button
          type="button"
          className="symbol-token-button"
          onClick={(event) => {
            event.stopPropagation();
            options.onSymbolClick(value);
          }}
        >
          <SymbolToken value={value} />
        </button>
      );
    }
    return <SymbolToken value={value} />;
  }
  if (taggedColumns.has(column) && value !== "—") {
    return <span className={`token token-${column.replaceAll("_", "-")}`}>{value}</span>;
  }
  return value;
}

function parseDateInputToIso(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    const year = Number(yyyy);
    const month = Number(mm);
    const day = Number(dd);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  const legacyMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!legacyMatch) return null;
  const [, dd, mm, yyyy] = legacyMatch;
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDatePickerValue(value) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function getApiErrorMessage(response, fallback) {
  try {
    const payload = await response.json();
    if (payload && typeof payload.detail === "string" && payload.detail) {
      return payload.detail;
    }
  } catch { }
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getStoredPanelWidth(storageKey, fallback, min, max) {
  if (typeof window === "undefined") return fallback;
  const saved = Number(window.localStorage.getItem(storageKey));
  if (!Number.isFinite(saved)) return fallback;
  return clamp(saved, min, max);
}

function getStoredRowsCache(storageKey) {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getStoredDate(storageKey) {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("portfolioTheme");
    return savedTheme === "slate" ? "slate" : "light";
  });
  const [activeView, setActiveView] = useState(() => {
    const savedView = localStorage.getItem("portfolioActiveView");
    return savedView === "books" || savedView === "access" ? savedView : "positions";
  });
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoginPasswordVisible, setIsLoginPasswordVisible] = useState(false);
  const [authError, setAuthError] = useState("");
  const [rows, setRows] = useState(() => getStoredRowsCache(POSITIONS_ROWS_CACHE_STORAGE_KEY));
  const [trendHistoryByKey, setTrendHistoryByKey] = useState({});
  const [trendSeriesBySymbolAccount, setTrendSeriesBySymbolAccount] = useState({});
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsLastSyncedAt, setPositionsLastSyncedAt] = useState(() =>
    getStoredDate(POSITIONS_SYNC_AT_CACHE_STORAGE_KEY)
  );
  const [error, setError] = useState("");
  const [positionFilters, setPositionFilters] = useState(defaultPositionFilters);
  const [dateFromInputValue, setDateFromInputValue] = useState("");
  const [dateToInputValue, setDateToInputValue] = useState("");
  const [draftBookFilterValues, setDraftBookFilterValues] = useState([]);
  const [quickFilterText, setQuickFilterText] = useState("");
  const [chartModeByCard, setChartModeByCard] = useState({
    realized: false,
    unrealized: false
  });
  const [chartHover, setChartHover] = useState({ key: null, index: -1 });
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const raw = localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY);
      if (!raw) return defaultVisibleColumns;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaultVisibleColumns;
      const selected = new Set(parsed.map((value) => String(value)));
      const normalized = columns.filter((column) => selected.has(column));
      return normalized.length > 0 ? normalized : defaultVisibleColumns;
    } catch {
      return defaultVisibleColumns;
    }
  });
  const [expandedTrend, setExpandedTrend] = useState(null);
  const [symbolTradeHistory, setSymbolTradeHistory] = useState(null);
  const [isPositionsFilterDrawerOpen, setIsPositionsFilterDrawerOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [filtersPanelWidth, setFiltersPanelWidth] = useState(() =>
    getStoredPanelWidth(
      FILTERS_WIDTH_STORAGE_KEY,
      DEFAULT_FILTERS_WIDTH,
      MIN_FILTERS_WIDTH,
      MAX_FILTERS_WIDTH
    )
  );
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [isColumnsDropdownOpen, setIsColumnsDropdownOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [books, setBooks] = useState([]);
  const [knownBookIds, setKnownBookIds] = useState([]);
  const [hasBookBadgeBaseline, setHasBookBadgeBaseline] = useState(false);
  const [booksError, setBooksError] = useState("");
  const [booksLoading, setBooksLoading] = useState(false);
  const [booksSaving, setBooksSaving] = useState(false);
  const [newBookName, setNewBookName] = useState("");
  const [selectedBookId, setSelectedBookId] = useState(null);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [booksLastSyncedAt, setBooksLastSyncedAt] = useState(null);
  const [accountsFilter, setAccountsFilter] = useState("assigned");
  const [isAccountsFilterOpen, setIsAccountsFilterOpen] = useState(false);
  const [isBookFilterOpen, setIsBookFilterOpen] = useState(false);
  const [accessUsers, setAccessUsers] = useState([]);
  const [accessBooks, setAccessBooks] = useState([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [newAccessUsername, setNewAccessUsername] = useState("");
  const [newAccessPassword, setNewAccessPassword] = useState("");
  const [newAccessIsAdmin, setNewAccessIsAdmin] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessUserFilter, setAccessUserFilter] = useState("");
  const [isAccessFilterOpen, setIsAccessFilterOpen] = useState(false);
  const [isAccessPasswordVisible, setIsAccessPasswordVisible] = useState(false);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [selectedAccessUserId, setSelectedAccessUserId] = useState(null);
  const [accessDraftPermissions, setAccessDraftPermissions] = useState(null);
  const [accessDraftBookIds, setAccessDraftBookIds] = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isPositionsRefreshAnimating, setIsPositionsRefreshAnimating] = useState(false);
  const [isBooksRefreshAnimating, setIsBooksRefreshAnimating] = useState(false);
  const [isAccessRefreshAnimating, setIsAccessRefreshAnimating] = useState(false);
  const accountsFilterRef = useRef(null);
  const bookFilterRef = useRef(null);
  const columnsDropdownRef = useRef(null);
  const resizeStateRef = useRef(null);
  const positionsGridApiRef = useRef(null);
  const pulseCardClickTimersRef = useRef({});
  const isDarkTheme = theme === "slate";
  const canViewPositions = currentUser?.permissions?.can_view_positions ?? false;
  const canViewBooks = currentUser?.permissions?.can_view_books ?? false;
  const canManageAccess = currentUser?.permissions?.can_manage_access ?? false;
  const accessUserExists = useMemo(() => {
    const candidate = newAccessUsername.trim().toLowerCase();
    if (!candidate) return false;
    return accessUsers.some(
      (user) => String(user.username ?? "").trim().toLowerCase() === candidate
    );
  }, [accessUsers, newAccessUsername]);
  const filteredAccessUsers = useMemo(() => {
    const query = normalizeLooseSearch(accessUserFilter);
    if (!query) return accessUsers;
    return accessUsers.filter((user) =>
      normalizeLooseSearch(user.username).includes(query)
    );
  }, [accessUsers, accessUserFilter]);
  const accessFilterOptions = useMemo(() => {
    const query = normalizeLooseSearch(accessUserFilter);
    const options = query
      ? accessUsers.filter((user) =>
        normalizeLooseSearch(user.username).includes(query)
      )
      : accessUsers;
    return options;
  }, [accessUsers, accessUserFilter]);
  const selectedAccessUser = useMemo(
    () => accessUsers.find((user) => user.id === selectedAccessUserId) ?? null,
    [accessUsers, selectedAccessUserId]
  );
  const isProtectedAdminUser = useCallback(
    (user) => String(user?.username ?? "").trim().toLowerCase() === "admin",
    []
  );
  const isAccessPermissionsChanged = useMemo(() => {
    if (!selectedAccessUser || !accessDraftPermissions) return false;
    return (
      Boolean(selectedAccessUser.permissions?.can_view_positions) !==
      Boolean(accessDraftPermissions.can_view_positions) ||
      Boolean(selectedAccessUser.permissions?.can_view_books) !==
      Boolean(accessDraftPermissions.can_view_books) ||
      Boolean(selectedAccessUser.permissions?.can_manage_access) !==
      Boolean(accessDraftPermissions.can_manage_access)
    );
  }, [selectedAccessUser, accessDraftPermissions]);
  const isAccessBookScopeChanged = useMemo(() => {
    if (!selectedAccessUser) return false;
    const current = Array.isArray(selectedAccessUser.position_book_ids)
      ? [...selectedAccessUser.position_book_ids].map(Number).filter(Number.isFinite).sort((a, b) => a - b)
      : [];
    const draft = [...accessDraftBookIds].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (current.length !== draft.length) return true;
    return current.some((value, index) => value !== draft[index]);
  }, [selectedAccessUser, accessDraftBookIds]);

  const handleSymbolClick = useCallback(
    async (symbolValue) => {
      const symbol = String(symbolValue ?? "").trim().toUpperCase();
      if (!symbol) return;

      setSymbolTradeHistory({
        symbol,
        rows: [],
        loading: true,
        error: ""
      });

      const params = new URLSearchParams();
      params.set("symbol", symbol);
      if (positionFilters.calcDateFrom) params.set("calc_date_from", positionFilters.calcDateFrom);
      if (positionFilters.calcDateTo) params.set("calc_date_to", positionFilters.calcDateTo);
      if (Array.isArray(positionFilters.books) && positionFilters.books.length > 0) {
        params.set("books", positionFilters.books.join(","));
        if (positionFilters.books.length === 1) {
          params.set("book", positionFilters.books[0]);
        }
      }

      const query = params.toString();
      const url = query ? `/api/positions/trade-history?${query}` : "/api/positions/trade-history";
      const fallbackUrl = query
        ? `/api/positions?${query}&include_history=true&history_days=3650`
        : "/api/positions?include_history=true&history_days=3650";

      try {
        let response = await apiFetch(url);
        let useFallbackRows = false;
        if (response.status === 404) {
          useFallbackRows = true;
          response = await apiFetch(fallbackUrl);
        }
        if (!response.ok) {
          throw new Error(
            await getApiErrorMessage(response, `Trade history request failed (HTTP ${response.status}).`)
          );
        }
        const payload = await response.json();
        const nextRows = (Array.isArray(payload) ? payload : []).map((row) => {
          if (!useFallbackRows) return row;
          const qty = getNumber(row.qty);
          return {
            time: row.calc_time ?? row.calc_date,
            symbol: row.symbol,
            account: row.account,
            book: row.book,
            quote: row.quote,
            fee_currency: row.fee_currency,
            side: qty !== null && qty >= 0 ? "Buy" : "Sell",
            qty: row.qty,
            price: row.mark_price ?? row.avg_open_price,
            fee: row.fee_usd ?? row.fee
          };
        });
        setSymbolTradeHistory((prev) => {
          if (!prev || prev.symbol !== symbol) return prev;
          return { ...prev, rows: nextRows, loading: false, error: "" };
        });
      } catch (loadError) {
        setSymbolTradeHistory((prev) => {
          if (!prev || prev.symbol !== symbol) return prev;
          return {
            ...prev,
            loading: false,
            error: loadError.message || "Unable to load trade history."
          };
        });
      }
    },
    [positionFilters, authToken]
  );

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      suppressHeaderMenuButton: false,
      filter: true,
      floatingFilter: false
    }),
    []
  );

  const columnDefs = useMemo(
    () => {
      const baseColumns = visibleColumns.map((col) => ({
        field: col,
        headerName: col === "qty" ? "QTY" : col.replaceAll("_", " ").toUpperCase(),
        minWidth: textColumns.has(col) ? 145 : 130,
        flex: textColumns.has(col) ? 1.2 : 1,
        filter: numericColumns.has(col) ? "agNumberColumnFilter" : "agTextColumnFilter",
        cellClass: (params) =>
          [textColumns.has(col) ? "cell-text" : "cell-num", getPnlClass(col, params.value)]
            .filter(Boolean)
            .join(" "),
        cellRenderer: (params) =>
          renderCell(col, params.value, params.data, {
            onSymbolClick: handleSymbolClick
          }),
        comparator: (a, b) => {
          const numA = getNumber(a);
          const numB = getNumber(b);
          if (numA !== null && numB !== null) return numA - numB;
          return String(a ?? "").localeCompare(String(b ?? ""));
        }
      }));

      return [
        ...baseColumns,
        {
          colId: "pnl_trend",
          field: "pnl_trend",
          headerName: "PNL TREND",
          minWidth: 170,
          maxWidth: 210,
          sortable: false,
          filter: false,
          resizable: true,
          suppressHeaderMenuButton: true,
          cellClass: "pnl-trend-cell",
          cellRenderer: (params) => <PnlTrendCell value={params.value} />,
          cellStyle: { paddingTop: "6px", paddingBottom: "6px" }
        }
      ];
    },
    [handleSymbolClick, visibleColumns]
  );

  const gridRows = useMemo(
    () =>
      rows.map((row) => {
        const realized = getNumber(row.realized_pnl);
        const unrealized = getNumber(row.unrealized_pnl);
        const net = getNumber(row.net_pl_usd);
        const rowKey = buildPositionTrendKey(row);
        const trend = Array.isArray(trendHistoryByKey[rowKey])
          ? trendHistoryByKey[rowKey]
          : [realized, unrealized, net].filter((value) => value !== null);
        return {
          ...row,
          pnl_trend: trend.length >= 2 ? trend : trend.length === 1 ? [0, trend[0]] : [0, 0]
        };
      }),
    [rows, trendHistoryByKey]
  );

  const positionPulseCards = useMemo(() => {
    if (positionsLoading && rows.length === 0) {
      return [
        { key: "realized", label: "Realized PnL", value: "—", valueClass: "is-neutral", meta: "Loading..." },
        {
          key: "unrealized",
          label: "Unrealized PnL",
          value: "—",
          valueClass: "is-neutral",
          meta: "Loading..."
        },
        { key: "fees", label: "Total Fees", value: "—", valueClass: "is-neutral", meta: "Loading..." },
        { key: "winrate", label: "Token Winrate", value: "—", valueClass: "is-neutral", meta: "Loading..." },
        { key: "traded", label: "Tokens Traded", value: "—", valueClass: "is-neutral", meta: "Loading..." }
      ];
    }

    const totals = rows.reduce(
      (acc, row) => {
        acc.unrealized += getNumber(row.unrealized_pnl) ?? 0;
        acc.realized += getNumber(row.realized_pnl) ?? 0;
        acc.fees += (getNumber(row.fee_usd) ?? getNumber(row.fee) ?? 0);
        return acc;
      },
      { unrealized: 0, realized: 0, fees: 0 }
    );

    const safeAverage = (values) => {
      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    const realizedRoiValues = rows
      .map((row) => getPnlRoiPercent(row, row.realized_pnl))
      .filter((value) => value !== null);
    const unrealizedRoiValues = rows
      .map((row) => getPnlRoiPercent(row, row.unrealized_pnl))
      .filter((value) => value !== null);

    const realizedTrend = rows
      .map((row) => getNumber(row.realized_pnl))
      .filter((value) => value !== null)
      .slice(0, 24);
    const unrealizedTrend = rows
      .map((row) => getNumber(row.unrealized_pnl))
      .filter((value) => value !== null)
      .slice(0, 24);

    const pnlValues = rows
      .map((row) => getNumber(row.net_pl_usd) ?? getNumber(row.realized_pnl) ?? getNumber(row.unrealized_pnl))
      .filter((value) => value !== null);
    const winrate =
      pnlValues.length === 0
        ? null
        : (pnlValues.filter((value) => value > 0).length / pnlValues.length) * 100;

    const symbolsTraded = new Set(
      rows.map((row) => String(row.symbol ?? "").trim().toUpperCase()).filter(Boolean)
    ).size;

    return [
      {
        key: "realized",
        label: "Realized PnL",
        value: formatCompactUsd(totals.realized),
        valueClass: totals.realized > 0 ? "is-positive" : totals.realized < 0 ? "is-negative" : "is-neutral",
        meta: formatPercent(safeAverage(realizedRoiValues)),
        trend: realizedTrend
      },
      {
        key: "unrealized",
        label: "Unrealized PnL",
        value: formatCompactUsd(totals.unrealized),
        valueClass: totals.unrealized > 0 ? "is-positive" : totals.unrealized < 0 ? "is-negative" : "is-neutral",
        meta: formatPercent(safeAverage(unrealizedRoiValues)),
        trend: unrealizedTrend
      },
      {
        key: "fees",
        label: "Total Fees",
        value: formatCompactUsd(totals.fees),
        valueClass: totals.fees > 0 ? "is-positive" : totals.fees < 0 ? "is-negative" : "is-neutral",
        meta: "Fee basis",
        trend: rows
          .map((row) => getNumber(row.fee_usd) ?? getNumber(row.fee))
          .filter((value) => value !== null)
          .slice(0, 24)
      },
      {
        key: "winrate",
        label: "Symbol Winrate",
        value: winrate === null ? "—" : formatPercent(winrate),
        valueClass: "is-neutral",
        meta: "Per symbol basis"
      },
      {
        key: "traded",
        label: "Symbols Traded",
        value: String(symbolsTraded),
        valueClass: "is-neutral",
        meta: "All time"
      }
    ];
  }, [rows, positionsLoading]);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );

  const accountOwnerByAccount = useMemo(() => {
    const ownerMap = new Map();
    books.forEach((book) => {
      book.accounts.forEach((account) => {
        if (!ownerMap.has(account)) {
          ownerMap.set(account, { bookId: book.id, bookName: book.name });
        }
      });
    });
    return ownerMap;
  }, [books]);

  const assignedAccountsSet = useMemo(() => {
    const assigned = new Set();
    books.forEach((book) => {
      book.accounts.forEach((account) => assigned.add(account));
    });
    return assigned;
  }, [books]);

  const unassignedAccounts = useMemo(
    () => accounts.filter((account) => !assignedAccountsSet.has(account)),
    [accounts, assignedAccountsSet]
  );

  const unassignedAccountsSet = useMemo(
    () => new Set(unassignedAccounts),
    [unassignedAccounts]
  );
  const hasNewBooks = useMemo(() => {
    if (!hasBookBadgeBaseline || books.length === 0) return false;
    const knownSet = new Set(knownBookIds);
    return books.some((book) => {
      const id = Number(book?.id);
      return Number.isFinite(id) && !knownSet.has(id);
    });
  }, [books, knownBookIds, hasBookBadgeBaseline]);

  const visibleAccounts = useMemo(() => {
    if (accountsFilter === "new") {
      return accounts.filter((account) => unassignedAccountsSet.has(account));
    }
    if (accountsFilter === "assigned") {
      if (selectedBook) {
        const selectedSet = new Set(selectedBook.accounts || []);
        return accounts.filter((account) => selectedSet.has(account));
      }
      return accounts.filter((account) => !unassignedAccountsSet.has(account));
    }
    return accounts;
  }, [accounts, accountsFilter, selectedBook, unassignedAccountsSet]);

  const visibleSelectableAccounts = useMemo(() => {
    if (!selectedBook) return [];
    return visibleAccounts.filter((account) => {
      const owner = accountOwnerByAccount.get(account);
      return !owner || owner.bookId === selectedBook.id;
    });
  }, [accountOwnerByAccount, selectedBook, visibleAccounts]);

  const allVisibleAccountsSelected = useMemo(() => {
    if (!selectedBook || visibleSelectableAccounts.length === 0) return false;
    return visibleSelectableAccounts.every((account) => selectedAccounts.includes(account));
  }, [selectedBook, visibleSelectableAccounts, selectedAccounts]);

  const accountFilterOptions = useMemo(
    () => [
      { value: "all", label: "All accounts", count: accounts.length },
      { value: "new", label: "Only new", count: unassignedAccounts.length },
      {
        value: "assigned",
        label: "Only assigned",
        count: selectedBook ? selectedBook.accounts.length : accounts.length - unassignedAccounts.length
      }
    ],
    [accounts.length, selectedBook, unassignedAccounts.length]
  );

  const selectedAccountFilterOption = useMemo(
    () =>
      accountFilterOptions.find((option) => option.value === accountsFilter) ??
      accountFilterOptions[0],
    [accountFilterOptions, accountsFilter]
  );
  const bookFilterOptions = useMemo(
    () => books.map((book) => ({ value: book.name, label: book.name })),
    [books]
  );

  const appliedBookFilterLabel = useMemo(() => {
    const selected = Array.isArray(positionFilters.books) ? positionFilters.books : [];
    if (selected.length === 0) return "All books";
    if (selected.length === 1) return selected[0];
    return `${selected.length} books selected`;
  }, [positionFilters.books]);

  const draftBookFilterLabel = useMemo(() => {
    if (draftBookFilterValues.length === 0) return "All books";
    if (draftBookFilterValues.length === 1) return draftBookFilterValues[0];
    return `${draftBookFilterValues.length} books selected`;
  }, [draftBookFilterValues]);

  const getPositionRowId = useCallback(
    (params) => buildPositionRowId(params.data ?? {}),
    []
  );

  async function apiFetch(path, options = {}, { skipAuthHandling = false } = {}) {
    const headers = { ...(options.headers || {}) };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const response = await fetch(path, { ...options, headers });
    if (response.status === 401 && !skipAuthHandling) {
      handleLogout();
      throw new Error("Session expired. Please sign in again.");
    }
    return response;
  }

  function handleLogout() {
    setAuthToken("");
    setCurrentUser(null);
    setIsUserMenuOpen(false);
    setRows([]);
    setTrendHistoryByKey({});
    setTrendSeriesBySymbolAccount({});
    setPositionsLastSyncedAt(null);
    setBooks([]);
    setAccounts([]);
    setAccessUsers([]);
    setAccessBooks([]);
    setAuthError("");
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(POSITIONS_ROWS_CACHE_STORAGE_KEY);
    localStorage.removeItem(POSITIONS_SYNC_AT_CACHE_STORAGE_KEY);
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword })
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Invalid username or password."));
      }
      const payload = await response.json();
      const nextToken = payload.access_token || "";
      if (!nextToken) throw new Error("Auth token is missing in response.");
      setAuthToken(nextToken);
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, nextToken);
      setCurrentUser(payload.user || null);
      setLoginPassword("");
      setIsLoginPasswordVisible(false);
    } catch (loginError) {
      setAuthError(loginError.message || "Unable to sign in.");
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function syncBooksSummary() {
    try {
      const [accountsRes, booksRes] = await Promise.all([
        apiFetch("/api/accounts"),
        apiFetch("/api/books")
      ]);
      if (!accountsRes.ok || !booksRes.ok) return;

      const accountsData = await accountsRes.json();
      const booksData = await booksRes.json();
      const nextAccounts = Array.isArray(accountsData) ? accountsData : [];
      const nextBooks = Array.isArray(booksData) ? booksData : [];

      setAccounts(nextAccounts);
      setBooks(nextBooks);
    } catch { }
  }

  async function loadPositions(filters = positionFilters) {
    setPositionsLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (filters.calcDateFrom) params.set("calc_date_from", filters.calcDateFrom);
    if (filters.calcDateTo) params.set("calc_date_to", filters.calcDateTo);
    if (Array.isArray(filters.books) && filters.books.length > 0) {
      params.set("books", filters.books.join(","));
      if (filters.books.length === 1) {
        params.set("book", filters.books[0]);
      }
    }

    const query = params.toString();
    const url = query ? `/api/positions?${query}` : "/api/positions";
    try {
      const res = await apiFetch(url);
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, `Positions request failed (HTTP ${res.status}).`));
      }
      const data = await res.json();
      const rawRows = Array.isArray(data) ? data : [];
      const selectedBooks = Array.isArray(filters.books) ? filters.books : [];
      const nextRows =
        selectedBooks.length > 0
          ? rawRows.filter((row) => selectedBooks.includes(String(row.book ?? "").trim()))
          : rawRows;

      const symbolList = [...new Set(nextRows.map((row) => buildPositionTrendKey(row)).filter(Boolean))];
      const trendParams = new URLSearchParams(params);
      if (symbolList.length > 0) {
        trendParams.set("symbols", symbolList.join(","));
      }
      const trendQuery = trendParams.toString();
      const trendUrl = trendQuery ? `/api/positions/pnl-trends?${trendQuery}` : "/api/positions/pnl-trends";
      const trendAccountsUrl = trendQuery
        ? `/api/positions/pnl-trends/accounts?${trendQuery}`
        : "/api/positions/pnl-trends/accounts";

      let trendPayload = {};
      let trendAccountsPayload = {};
      let trendLoadErrorMessage = "";
      try {
        const [trendRes, trendAccountsRes] = await Promise.all([
          apiFetch(trendUrl),
          apiFetch(trendAccountsUrl)
        ]);
        if (!trendRes.ok) {
          throw new Error(await getApiErrorMessage(trendRes, `PnL trend request failed (HTTP ${trendRes.status}).`));
        }
        if (!trendAccountsRes.ok) {
          throw new Error(
            await getApiErrorMessage(trendAccountsRes, `Account trend request failed (HTTP ${trendAccountsRes.status}).`)
          );
        }
        [trendPayload, trendAccountsPayload] = await Promise.all([trendRes.json(), trendAccountsRes.json()]);
      } catch (trendError) {
        trendLoadErrorMessage = trendError.message || "PnL trend data is temporarily unavailable.";
      }

      const nextTrendHistoryByKey = {};
      Object.entries(trendPayload || {}).forEach(([symbol, points]) => {
        const key = buildPositionTrendKey({ symbol });
        const normalized = Array.isArray(points)
          ? points.map((value) => getNumber(value)).filter((value) => value !== null)
          : [];
        if (normalized.length > 0) {
          nextTrendHistoryByKey[key] = normalized;
        }
      });

      const nextTrendSeriesBySymbolAccount = {};
      Object.entries(trendAccountsPayload || {}).forEach(([symbol, accountSeries]) => {
        const symbolKey = buildPositionTrendKey({ symbol });
        if (!symbolKey || !accountSeries || typeof accountSeries !== "object") return;
        const normalizedSeries = {};
        Object.entries(accountSeries).forEach(([account, points]) => {
          const normalized = normalizeTrendPoints(points);
          if (account && normalized.length >= 2) {
            normalizedSeries[account] = normalized;
          }
        });
        if (Object.keys(normalizedSeries).length > 0) {
          nextTrendSeriesBySymbolAccount[symbolKey] = normalizedSeries;
        }
      });

      setRows(nextRows);
      setTrendHistoryByKey(nextTrendHistoryByKey);
      setTrendSeriesBySymbolAccount(nextTrendSeriesBySymbolAccount);
      const syncAt = Date.now();
      setPositionsLastSyncedAt(new Date(syncAt));
      try {
        localStorage.setItem(POSITIONS_ROWS_CACHE_STORAGE_KEY, JSON.stringify(nextRows));
        localStorage.setItem(POSITIONS_SYNC_AT_CACHE_STORAGE_KEY, String(syncAt));
      } catch { }
      syncBooksSummary();
      setError(trendLoadErrorMessage);
    } catch (loadError) {
      setError(loadError.message || "Unable to load data. Please contact your administrator.");
    } finally {
      setPositionsLoading(false);
    }
  }

  function resetPositionFilters() {
    setPositionFilters(defaultPositionFilters);
    setDateFromInputValue("");
    setDateToInputValue("");
    setDraftBookFilterValues([]);
    setIsBookFilterOpen(false);
    setQuickFilterText("");
    loadPositions(defaultPositionFilters);
  }

  function applyPositionFilters() {
    const parsedFrom = dateFromInputValue ? parseDateInputToIso(dateFromInputValue) : "";
    const parsedTo = dateToInputValue ? parseDateInputToIso(dateToInputValue) : "";

    if (parsedFrom === null || parsedTo === null) {
      setError("Use calendar date format.");
      return;
    }

    if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
      setError("Start date cannot be later than end date.");
      return;
    }

    const nextFilters = {
      calcDateFrom: parsedFrom || "",
      calcDateTo: parsedTo || "",
      books: [...draftBookFilterValues]
    };
    setPositionFilters(nextFilters);
    setIsBookFilterOpen(false);
    loadPositions(nextFilters);
  }

  function toggleDraftBookFilterValue(bookName) {
    setDraftBookFilterValues((prev) =>
      prev.includes(bookName) ? prev.filter((value) => value !== bookName) : [...prev, bookName]
    );
  }

  async function handleRefreshPositions() {
    const startedAt = Date.now();
    setIsPositionsRefreshAnimating(true);
    try {
      await loadPositions();
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 450) {
        await delay(450 - elapsed);
      }
      setIsPositionsRefreshAnimating(false);
    }
  }

  async function handleRefreshBooks() {
    const startedAt = Date.now();
    setIsBooksRefreshAnimating(true);
    try {
      await loadBooksData();
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 450) {
        await delay(450 - elapsed);
      }
      setIsBooksRefreshAnimating(false);
    }
  }

  async function handleRefreshAccess() {
    const startedAt = Date.now();
    setIsAccessRefreshAnimating(true);
    try {
      await loadAccessUsers();
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 450) {
        await delay(450 - elapsed);
      }
      setIsAccessRefreshAnimating(false);
    }
  }

  function handleDateFromInputChange(event) {
    const next = normalizeDatePickerValue(event.target.value);
    if (next === null) return;
    setDateFromInputValue(next);
  }

  function handleDateToInputChange(event) {
    const next = normalizeDatePickerValue(event.target.value);
    if (next === null) return;
    setDateToInputValue(next);
  }

  function toggleVisibleColumn(column) {
    setVisibleColumns((prev) => {
      if (prev.includes(column)) {
        if (prev.length === 1) return prev;
        const next = new Set(prev.filter((item) => item !== column));
        return columns.filter((item) => next.has(item));
      }
      const next = new Set([...prev, column]);
      return columns.filter((item) => next.has(item));
    });
  }

  const syncVisibleColumnsFromGrid = useCallback((apiCandidate) => {
    const api = apiCandidate || positionsGridApiRef.current;
    if (!api || typeof api.getColumns !== "function") return;
    const gridColumns = api.getColumns();
    if (!Array.isArray(gridColumns) || gridColumns.length === 0) return;

    const nextVisibleSet = new Set();
    gridColumns.forEach((columnRef) => {
      const colId = typeof columnRef.getColId === "function" ? columnRef.getColId() : "";
      if (!columns.includes(colId)) return;
      const isVisible = typeof columnRef.isVisible === "function" ? columnRef.isVisible() : true;
      if (isVisible) {
        nextVisibleSet.add(colId);
      }
    });

    const nextVisibleColumns = columns.filter((column) => nextVisibleSet.has(column));
    setVisibleColumns((prev) => {
      if (prev.length === nextVisibleColumns.length && prev.every((value, index) => value === nextVisibleColumns[index])) {
        return prev;
      }
      return nextVisibleColumns;
    });
  }, []);

  function resetVisibleColumnsToDefault() {
    setVisibleColumns(defaultVisibleColumns);
    setIsColumnsDropdownOpen(false);
  }

  const handleTrendCellDoubleClick = useCallback((event) => {
    if (event?.colDef?.field !== "pnl_trend") return;
    const symbolRaw = String(event?.data?.symbol ?? "").trim().toUpperCase();
    if (!symbolRaw) return;

    const seriesByAccount = trendSeriesBySymbolAccount[symbolRaw] || {};
    const hasAccountSeries = Object.values(seriesByAccount).some(
      (points) => Array.isArray(points) && points.length >= 2
    );

    const points = Array.isArray(event.value)
      ? event.value.filter((value) => Number.isFinite(value))
      : [];
    if (!hasAccountSeries && points.length < 2) return;

    setExpandedTrend({
      symbol: symbolRaw,
      points,
      seriesByAccount
    });
  }, [trendSeriesBySymbolAccount]);

  const openPulseTrendModal = useCallback((card) => {
    const trend = Array.isArray(card?.trend)
      ? card.trend.filter((value) => Number.isFinite(value))
      : [];
    if (trend.length < 2) return;
    setExpandedTrend({
      symbol: String(card?.label ?? "Widget trend"),
      points: trend
    });
  }, []);

  const clearPulseCardClickTimer = useCallback((cardKey) => {
    const timer = pulseCardClickTimersRef.current[cardKey];
    if (!timer) return;
    window.clearTimeout(timer);
    delete pulseCardClickTimersRef.current[cardKey];
  }, []);

  const handlePulseCardSingleClick = useCallback((cardKey) => {
    clearPulseCardClickTimer(cardKey);
    pulseCardClickTimersRef.current[cardKey] = window.setTimeout(() => {
      setChartModeByCard((prev) => ({ ...prev, [cardKey]: !prev[cardKey] }));
      setChartHover((prev) =>
        prev.key === cardKey ? { key: null, index: -1 } : prev
      );
      delete pulseCardClickTimersRef.current[cardKey];
    }, 220);
  }, [clearPulseCardClickTimer]);

  const handlePulseCardDoubleClick = useCallback((card) => {
    const cardKey = String(card?.key ?? "");
    if (!cardKey) return;
    clearPulseCardClickTimer(cardKey);
    setChartHover((prev) =>
      prev.key === cardKey ? { key: null, index: -1 } : prev
    );
    openPulseTrendModal(card);
  }, [clearPulseCardClickTimer, openPulseTrendModal]);

  useEffect(() => {
    return () => {
      Object.values(pulseCardClickTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      pulseCardClickTimersRef.current = {};
    };
  }, []);

  async function loadBooksData(preferredBookId = null) {
    setBooksLoading(true);
    setBooksError("");
    try {
      const [accountsRes, booksRes] = await Promise.all([
        apiFetch("/api/accounts"),
        apiFetch("/api/books")
      ]);

      if (!accountsRes.ok) {
        throw new Error(await getApiErrorMessage(accountsRes, "Unable to load accounts."));
      }
      if (!booksRes.ok) {
        throw new Error(await getApiErrorMessage(booksRes, "Unable to load books."));
      }

      const accountsData = await accountsRes.json();
      const booksData = await booksRes.json();
      const nextAccounts = Array.isArray(accountsData) ? accountsData : [];
      const nextBooks = Array.isArray(booksData) ? booksData : [];

      setAccounts(nextAccounts);
      setBooks(nextBooks);

      const fallbackId = preferredBookId ?? selectedBookId;
      const preferredBook =
        fallbackId !== null ? nextBooks.find((book) => book.id === fallbackId) : null;
      const nextSelectedBook = preferredBook ?? nextBooks[0] ?? null;
      setSelectedBookId(nextSelectedBook ? nextSelectedBook.id : null);
      setSelectedAccounts(nextSelectedBook ? [...nextSelectedBook.accounts] : []);
      setBooksLastSyncedAt(new Date());
    } catch (loadError) {
      setBooksError(loadError.message || "Unable to load books.");
    } finally {
      setBooksLoading(false);
    }
  }

  useEffect(() => {
    let isCancelled = false;
    async function bootstrapAuth() {
      if (!authToken) {
        if (!isCancelled) {
          setCurrentUser(null);
          setAuthLoading(false);
        }
        return;
      }
      setAuthLoading(true);
      try {
        const response = await apiFetch("/api/auth/me", {}, { skipAuthHandling: true });
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, "Session expired."));
        }
        const user = await response.json();
        if (!isCancelled) {
          setCurrentUser(user);
          setAuthError("");
        }
      } catch {
        if (!isCancelled) {
          handleLogout();
        }
      } finally {
        if (!isCancelled) {
          setAuthLoading(false);
        }
      }
    }
    bootstrapAuth();
    return () => {
      isCancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    localStorage.setItem("portfolioTheme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("portfolioActiveView", activeView);
  }, [activeView]);

  useEffect(() => {
    localStorage.setItem(FILTERS_WIDTH_STORAGE_KEY, String(filtersPanelWidth));
  }, [filtersPanelWidth]);

  useEffect(() => {
    localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    if (authToken) {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
    } else {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  }, [authToken]);

  const finishPanelResize = useCallback(
    ({ closeSidebar = false, closeFilters = false } = {}) => {
      resizeStateRef.current = null;
      setIsResizingPanels(false);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");

      if (closeSidebar) {
        window.requestAnimationFrame(() => {
          setIsSidebarOpen(false);
          setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
        });
      }

      if (closeFilters) {
        window.requestAnimationFrame(() => {
          setIsPositionsFilterDrawerOpen(false);
          setFiltersPanelWidth(DEFAULT_FILTERS_WIDTH);
        });
      }
    },
    []
  );

  useEffect(() => {
    if (hasBookBadgeBaseline || books.length === 0) return;
    const ids = books
      .map((book) => Number(book?.id))
      .filter(Number.isFinite);
    setKnownBookIds(ids);
    setHasBookBadgeBaseline(true);
  }, [books, hasBookBadgeBaseline]);

  useEffect(() => {
    if (activeView !== "books" || !canViewBooks) return;
    const ids = books
      .map((book) => Number(book?.id))
      .filter(Number.isFinite);
    setHasBookBadgeBaseline(true);
    setKnownBookIds((prev) => {
      if (ids.length === 0) return prev;
      const merged = [...new Set([...prev, ...ids])];
      if (merged.length === prev.length && merged.every((id, index) => id === prev[index])) {
        return prev;
      }
      return merged;
    });
  }, [activeView, canViewBooks, books]);

  useEffect(() => {
    if (!currentUser) return;
    if (canViewPositions) {
      loadPositions();
      syncBooksSummary();
    } else if (canViewBooks) {
      loadBooksData();
    } else if (canManageAccess) {
      loadAccessUsers();
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (activeView === "books" && canViewBooks) {
      loadBooksData();
    }
    if (activeView === "access" && canManageAccess) {
      loadAccessUsers();
    }
  }, [activeView, currentUser]);

  useEffect(() => {
    if (activeView !== "positions") {
      setIsPositionsFilterDrawerOpen(false);
    }
  }, [activeView]);

  useEffect(() => {
    if (!currentUser) return;
    if (activeView === "positions" && !canViewPositions) {
      if (canViewBooks) setActiveView("books");
      else if (canManageAccess) setActiveView("access");
      return;
    }
    if (activeView === "books" && !canViewBooks) {
      if (canViewPositions) setActiveView("positions");
      else if (canManageAccess) setActiveView("access");
      return;
    }
    if (activeView === "access" && !canManageAccess) {
      if (canViewPositions) setActiveView("positions");
      else if (canViewBooks) setActiveView("books");
    }
  }, [activeView, canManageAccess, canViewBooks, canViewPositions, currentUser]);

  useEffect(() => {
    if (!isAccountsFilterOpen) return;

    function handlePointerDown(event) {
      if (accountsFilterRef.current && !accountsFilterRef.current.contains(event.target)) {
        setIsAccountsFilterOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsAccountsFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isAccountsFilterOpen]);

  useEffect(() => {
    if (!isColumnsDropdownOpen) return;

    function handlePointerDown(event) {
      if (columnsDropdownRef.current && !columnsDropdownRef.current.contains(event.target)) {
        setIsColumnsDropdownOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsColumnsDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isColumnsDropdownOpen]);

  useEffect(() => {
    if (!isBookFilterOpen) return;

    function handlePointerDown(event) {
      if (bookFilterRef.current && !bookFilterRef.current.contains(event.target)) {
        setIsBookFilterOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsBookFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isBookFilterOpen]);

  useEffect(() => {
    if (!selectedAccessUser) {
      setAccessDraftPermissions(null);
      setAccessDraftBookIds([]);
      return;
    }
    setAccessDraftPermissions({
      can_view_positions: Boolean(selectedAccessUser.permissions?.can_view_positions),
      can_view_books: Boolean(selectedAccessUser.permissions?.can_view_books),
      can_manage_access: Boolean(selectedAccessUser.permissions?.can_manage_access)
    });
    setAccessDraftBookIds(
      Array.isArray(selectedAccessUser.position_book_ids) ? [...selectedAccessUser.position_book_ids] : []
    );
  }, [selectedAccessUser]);

  useEffect(() => {
    setDraftBookFilterValues(
      Array.isArray(positionFilters.books) ? [...positionFilters.books] : []
    );
  }, [positionFilters.books]);

  useEffect(() => {
    if (!isPositionsFilterDrawerOpen || activeView !== "positions") {
      setIsBookFilterOpen(false);
    }
  }, [isPositionsFilterDrawerOpen, activeView]);

  useEffect(() => {
    if (!isUserMenuOpen) return;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (!expandedTrend && !symbolTradeHistory) return;

    function handleEscape(event) {
      if (event.key !== "Escape") return;
      if (symbolTradeHistory) {
        setSymbolTradeHistory(null);
        return;
      }
      setExpandedTrend(null);
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [expandedTrend, symbolTradeHistory]);

  useEffect(() => {
    function handlePointerMove(event) {
      if (!resizeStateRef.current) return;
      const sidebarMax = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 320));
      const filtersMax = Math.max(MIN_FILTERS_WIDTH, Math.min(MAX_FILTERS_WIDTH, window.innerWidth - 320));
      if (resizeStateRef.current.panel === "sidebar") {
        const rawWidth = clamp(event.clientX, MIN_SIDEBAR_WIDTH, sidebarMax);
        const nextWidth = rawWidth;
        resizeStateRef.current.lastWidth = nextWidth;
        setSidebarWidth(nextWidth);
        return;
      }

      const rawWidth = clamp(window.innerWidth - event.clientX, MIN_FILTERS_WIDTH, filtersMax);
      const nextWidth = rawWidth;
      resizeStateRef.current.lastWidth = nextWidth;
      setFiltersPanelWidth(nextWidth);
    }

    function handlePointerUp(event) {
      if (!resizeStateRef.current) return;
      const sidebarMax = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 320));
      const filtersMax = Math.max(MIN_FILTERS_WIDTH, Math.min(MAX_FILTERS_WIDTH, window.innerWidth - 320));
      const pointerX = Number.isFinite(event?.clientX) ? event.clientX : null;
      const finalSidebarWidth =
        pointerX === null
          ? resizeStateRef.current.lastWidth
          : clamp(pointerX, MIN_SIDEBAR_WIDTH, sidebarMax);
      const finalFiltersWidth =
        pointerX === null
          ? resizeStateRef.current.lastWidth
          : clamp(window.innerWidth - pointerX, MIN_FILTERS_WIDTH, filtersMax);
      if (
        resizeStateRef.current.panel === "sidebar" &&
        Number.isFinite(finalSidebarWidth) &&
        finalSidebarWidth <= PANEL_DRAG_CLOSE_THRESHOLD_PX
      ) {
        setSidebarWidth(0);
        finishPanelResize({ closeSidebar: true });
        return;
      }
      if (
        resizeStateRef.current.panel === "filters" &&
        Number.isFinite(finalFiltersWidth) &&
        finalFiltersWidth <= PANEL_DRAG_CLOSE_THRESHOLD_PX
      ) {
        setFiltersPanelWidth(0);
        finishPanelResize({ closeFilters: true });
        return;
      }
      finishPanelResize();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [finishPanelResize]);

  function startPanelResize(panel, event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeStateRef.current = {
      panel,
      lastWidth: panel === "sidebar" ? sidebarWidth : filtersPanelWidth
    };
    setIsResizingPanels(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function toggleFiltersDrawerByButton() {
    setIsPositionsFilterDrawerOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        setFiltersPanelWidth(DEFAULT_FILTERS_WIDTH);
      }
      return nextOpen;
    });
  }

  function isAccountLockedToAnotherBook(account) {
    if (!selectedBook) return false;
    const owner = accountOwnerByAccount.get(account);
    return Boolean(owner && owner.bookId !== selectedBook.id);
  }

  function toggleAccountSelection(account) {
    if (isAccountLockedToAnotherBook(account)) return;
    setSelectedAccounts((prev) =>
      prev.includes(account) ? prev.filter((item) => item !== account) : [...prev, account]
    );
  }

  function toggleAllVisibleAccounts() {
    if (!selectedBook || visibleSelectableAccounts.length === 0) return;

    setSelectedAccounts((prev) => {
      const visibleSet = new Set(visibleSelectableAccounts);
      const allSelected = visibleSelectableAccounts.every((account) => prev.includes(account));

      if (allSelected) {
        return prev.filter((account) => !visibleSet.has(account));
      }

      const next = [...prev];
      visibleSelectableAccounts.forEach((account) => {
        if (!next.includes(account)) {
          next.push(account);
        }
      });
      return next;
    });
  }

  async function handleCreateBook(event) {
    event.preventDefault();
    const bookName = newBookName.trim();
    if (!bookName) {
      setBooksError("Book name is required.");
      return;
    }

    setBooksSaving(true);
    setBooksError("");
    try {
      const response = await apiFetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bookName })
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to create book."));
      }
      const createdBook = await response.json();
      setNewBookName("");
      await loadBooksData(createdBook.id);
    } catch (createError) {
      setBooksError(createError.message || "Unable to create book.");
    } finally {
      setBooksSaving(false);
    }
  }

  async function handleSaveAccounts() {
    if (!selectedBook) return;
    setBooksSaving(true);
    setBooksError("");
    try {
      const response = await apiFetch(`/api/books/${selectedBook.id}/accounts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: selectedAccounts })
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to save accounts."));
      }

      const updatedBook = await response.json();
      setBooks((prev) =>
        prev.map((book) => (book.id === updatedBook.id ? updatedBook : book))
      );
      setSelectedAccounts([...updatedBook.accounts]);
      loadPositions();
    } catch (saveError) {
      setBooksError(saveError.message || "Unable to save accounts.");
    } finally {
      setBooksSaving(false);
    }
  }

  function requestDeleteBook() {
    if (!selectedBook) return;
    setPendingDelete({
      type: "book",
      id: selectedBook.id,
      name: selectedBook.name
    });
  }

  async function handleDeleteBook(bookId) {
    if (!bookId) return;
    setPendingDelete(null);
    setBooksSaving(true);
    setBooksError("");
    try {
      const response = await apiFetch(`/api/books/${bookId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to delete book."));
      }
      await loadBooksData();
      loadPositions();
    } catch (deleteError) {
      setBooksError(deleteError.message || "Unable to delete book.");
    } finally {
      setBooksSaving(false);
    }
  }

  function requestDeleteAccessUser() {
    if (!selectedAccessUser || isProtectedAdminUser(selectedAccessUser)) return;
    setPendingDelete({
      type: "user",
      id: selectedAccessUser.id,
      name: selectedAccessUser.username
    });
  }

  async function handleDeleteAccessUser(userId) {
    if (!userId) return;
    setPendingDelete(null);
    setAccessSaving(true);
    setAccessError("");
    try {
      const response = await apiFetch(`/api/users/${userId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to delete user."));
      }
      if (selectedAccessUserId === userId) {
        setSelectedAccessUserId(null);
      }
      await loadAccessUsers();
    } catch (deleteError) {
      setAccessError(deleteError.message || "Unable to delete user.");
    } finally {
      setAccessSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.type === "book") {
      await handleDeleteBook(pendingDelete.id);
      return;
    }
    if (pendingDelete.type === "user") {
      await handleDeleteAccessUser(pendingDelete.id);
    }
  }

  async function loadAccessUsers() {
    if (!canManageAccess) return;
    setAccessLoading(true);
    setAccessError("");
    try {
      const [usersResponse, booksResponse] = await Promise.all([
        apiFetch("/api/users"),
        apiFetch("/api/books")
      ]);
      if (!usersResponse.ok) {
        throw new Error(await getApiErrorMessage(usersResponse, "Unable to load users."));
      }
      const usersData = await usersResponse.json();
      setAccessUsers(Array.isArray(usersData) ? usersData : []);
      if (booksResponse.ok) {
        const booksData = await booksResponse.json();
        setAccessBooks(Array.isArray(booksData) ? booksData : []);
      } else {
        setAccessBooks([]);
      }
    } catch (loadError) {
      setAccessError(loadError.message || "Unable to load users.");
    } finally {
      setAccessLoading(false);
    }
  }

  async function handleCreateAccessUser(event) {
    event.preventDefault();
    const normalizedUsername = newAccessUsername.trim();
    if (!normalizedUsername || !newAccessPassword) {
      setAccessError("Username and password are required.");
      return;
    }
    if (accessUserExists) {
      setAccessError("A user with this username already exists.");
      return;
    }
    setAccessSaving(true);
    setAccessError("");
    try {
      const response = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: normalizedUsername,
          password: newAccessPassword,
          is_admin: newAccessIsAdmin
        })
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to create user."));
      }
      setNewAccessUsername("");
      setNewAccessPassword("");
      setNewAccessIsAdmin(false);
      setIsCreateUserOpen(false);
      setIsAccessPasswordVisible(false);
      await loadAccessUsers();
    } catch (createError) {
      setAccessError(createError.message || "Unable to create user.");
    } finally {
      setAccessSaving(false);
    }
  }

  async function handleUpdateUserPermission(userId, currentPermissions, patchPermissions) {
    setAccessSaving(true);
    setAccessError("");
    try {
      const nextPermissions = { ...currentPermissions, ...patchPermissions };
      const response = await apiFetch(`/api/users/${userId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPermissions)
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to update permissions."));
      }
      const updated = await response.json();
      setAccessUsers((prev) => prev.map((user) => (user.id === userId ? updated : user)));
    } catch (saveError) {
      setAccessError(saveError.message || "Unable to update permissions.");
    } finally {
      setAccessSaving(false);
    }
  }

  async function handleSaveAccessPermissions() {
    if (!selectedAccessUser || !accessDraftPermissions || !isAccessPermissionsChanged) return;
    await handleUpdateUserPermission(
      selectedAccessUser.id,
      selectedAccessUser.permissions,
      accessDraftPermissions
    );
  }

  async function handleSaveAccessBookScope() {
    if (!selectedAccessUser || !isAccessBookScopeChanged) return;
    await handleUpdateUserPositionBooks(selectedAccessUser.id, accessDraftBookIds);
  }

  async function handleUpdateUserPositionBooks(userId, nextBookIds) {
    setAccessSaving(true);
    setAccessError("");
    try {
      const normalizedBookIds = [...new Set(nextBookIds.map((bookId) => Number(bookId)).filter(Number.isFinite))]
        .filter((bookId) => bookId > 0)
        .sort((a, b) => a - b);
      const response = await apiFetch(`/api/users/${userId}/position-books`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_ids: normalizedBookIds })
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to update book access."));
      }
      const updated = await response.json();
      setAccessUsers((prev) => prev.map((user) => (user.id === userId ? updated : user)));
    } catch (saveError) {
      setAccessError(saveError.message || "Unable to update book access.");
    } finally {
      setAccessSaving(false);
    }
  }

  function toggleUserPositionBook(bookId) {
    setAccessDraftBookIds((prev) =>
      prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
    );
  }

  if (authLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Loading session...</h1>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="auth-shell">
        <form className="auth-card" onSubmit={handleLoginSubmit}>
          <h1 className="auth-brand">PORTFOLIO</h1>
          <h2 className="auth-subtitle">Log in</h2>
          <input
            className="auth-input"
            type="text"
            value={loginUsername}
            onChange={(event) => setLoginUsername(event.target.value)}
            autoComplete="username"
            placeholder="Enter username"
            aria-label="Username"
          />
          <div className="auth-password-field">
            <input
              className="auth-input auth-password-input"
              type={isLoginPasswordVisible ? "text" : "password"}
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Password"
              aria-label="Password"
            />
            <button
              type="button"
              className={`access-password-toggle ${isLoginPasswordVisible ? "is-visible" : ""}`}
              onClick={() => setIsLoginPasswordVisible((prev) => !prev)}
              aria-label={isLoginPasswordVisible ? "Hide password" : "Show password"}
              aria-pressed={isLoginPasswordVisible}
            >
              <PasswordVisibilityIcon visible={isLoginPasswordVisible} />
            </button>
          </div>
          {authError && <div className="error">{authError}</div>}
          <button type="submit" className="primary-button auth-submit-button" disabled={authLoading}>
            Log in
          </button>
          <p className="auth-help">Forgot your password? Contact the administrator.</p>
        </form>
      </div>
    );
  }

  return (
    <div
      className={`shell theme-${theme} ${isSidebarOpen ? "sidebar-open" : "sidebar-closed"} ${activeView === "positions" && canViewPositions && isPositionsFilterDrawerOpen
          ? "filters-open"
          : "filters-closed"
        } ${isResizingPanels ? "is-resizing-panels" : ""}`}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--filters-panel-width": `${filtersPanelWidth}px`
      }}
    >
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setIsSidebarOpen((prev) => !prev)}
        aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
      >
        {isSidebarOpen ? "✕" : "☰"}
      </button>
      {isUserMenuOpen && (
        <button
          type="button"
          className="user-drawer-backdrop"
          onClick={() => setIsUserMenuOpen(false)}
          aria-label="Close user panel"
        />
      )}

      <aside className={`user-drawer ${isUserMenuOpen ? "is-open" : "is-closed"}`}>
        <div className="user-drawer-head">
          <h2>User</h2>
        </div>
        <div className="user-drawer-profile">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M18.685 19.097A9.723 9.723 0 0 0 21.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 0 0 3.065 7.097A9.716 9.716 0 0 0 12 21.75a9.716 9.716 0 0 0 6.685-2.653Zm-12.54-1.285A7.486 7.486 0 0 1 12 15a7.486 7.486 0 0 1 5.855 2.812A8.224 8.224 0 0 1 12 20.25a8.224 8.224 0 0 1-5.855-2.438ZM15.75 9a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
              clipRule="evenodd"
            />
          </svg>
          <div className="user-drawer-meta">
            <div className="user-drawer-name">{currentUser.username}</div>
            <div className="user-drawer-role">
              {currentUser.is_admin ? "Administrator" : "Portfolio User"}
            </div>
          </div>
        </div>
        <label className="user-theme-field">
          <button
            type="button"
            className={`user-theme-toggle ${isDarkTheme ? "is-dark" : "is-light"}`}
            onClick={() => setTheme((prev) => (prev === "slate" ? "light" : "slate"))}
            aria-label={isDarkTheme ? "Switch to light theme" : "Switch to dark theme"}
            aria-pressed={isDarkTheme}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.894 6.166a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5H21a.75.75 0 0 1 .75.75ZM17.834 18.894a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591ZM12 18a.75.75 0 0 1 .75.75V21a.75.75 0 0 1-1.5 0v-2.25A.75.75 0 0 1 12 18ZM7.758 17.303a.75.75 0 0 0-1.061-1.06l-1.591 1.59a.75.75 0 0 0 1.06 1.061l1.591-1.59ZM6 12a.75.75 0 0 1-.75.75H3a.75.75 0 0 1 0-1.5h2.25A.75.75 0 0 1 6 12ZM6.697 7.757a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 0 0-1.061 1.06l1.59 1.591Z" />
            </svg>
            <span className="user-theme-toggle-switch">
              <span className="user-theme-toggle-knob" />
            </span>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.98 10.503 10.503 0 0 1-9.694 6.46c-5.799 0-10.5-4.7-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 0 1 .818.162Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </label>
        <button type="button" className="secondary-button" onClick={handleLogout}>
          Log out
        </button>
      </aside>

      <aside className={`sidebar ${isSidebarOpen ? "is-open" : "is-closed"}`}>
        <div className="sidebar-head">
          <h1 className="page-title page-title-accent">
            <span className="page-title-fin-icon" aria-hidden>
              <img src={walletIcon} alt="" />
            </span>
            <span className="page-title-primary">Portfolio</span>
          </h1>
        </div>
        <div className="sidebar-nav">
          {canViewPositions && (
            <button
              type="button"
              className={`sidebar-link ${activeView === "positions" ? "is-active" : ""}`}
              onClick={() => setActiveView("positions")}
            >
              <span className="sidebar-link-main">
                <span className="sidebar-link-icon" aria-hidden>
                  <SidebarNavIcon section="positions" />
                </span>
                <span>Positions</span>
              </span>
            </button>
          )}
          {canViewBooks && (
            <button
              type="button"
              className={`sidebar-link ${activeView === "books" ? "is-active" : ""}`}
              onClick={() => setActiveView("books")}
            >
              <span className="sidebar-link-main">
                <span className="sidebar-link-icon" aria-hidden>
                  <SidebarNavIcon section="books" />
                </span>
                <span>Books</span>
              </span>
              {hasNewBooks ? (
                <span className="sidebar-badge sidebar-badge-new">
                  <span aria-hidden>🚀</span>
                  <span>New!</span>
                </span>
              ) : unassignedAccounts.length > 0 && (
                <span className="sidebar-badge">{unassignedAccounts.length}</span>
              )}
            </button>
          )}
          {canManageAccess && (
            <button
              type="button"
              className={`sidebar-link ${activeView === "access" ? "is-active" : ""}`}
              onClick={() => setActiveView("access")}
            >
              <span className="sidebar-link-main">
                <span className="sidebar-link-icon" aria-hidden>
                  <SidebarNavIcon section="access" />
                </span>
                <span>Access</span>
              </span>
            </button>
          )}
        </div>
        {isSidebarOpen && (
          <div
            className="panel-resizer panel-resizer-left"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize menu panel"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuenow={sidebarWidth}
            onPointerDown={(event) => startPanelResize("sidebar", event)}
          />
        )}
      </aside>

      <main className="workspace">
        {activeView === "positions" && canViewPositions && (
          <div className="page positions-page">
            <header className="header header-with-actions">
              <div className="header-title-block">
                Positions
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className={`secondary-button refresh-button market-button market-button-accent ${positionsLoading || isPositionsRefreshAnimating ? "is-loading" : ""
                    }`}
                  onClick={handleRefreshPositions}
                  disabled={positionsLoading || isPositionsRefreshAnimating}
                  aria-busy={positionsLoading || isPositionsRefreshAnimating}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className={`refresh-button-icon ${positionsLoading || isPositionsRefreshAnimating ? "is-spinning" : ""
                      }`}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  className="secondary-button filters-button market-button market-button-accent"
                  onClick={toggleFiltersDrawerByButton}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="filters-button-icon" aria-hidden>
                    <path
                      d="M3.5 5.5C3.5 4.95 3.95 4.5 4.5 4.5h15c.55 0 1 .45 1 1 0 .24-.09.47-.25.65L14 13.6v4.2c0 .36-.2.68-.52.85l-3 1.5a.96.96 0 0 1-.95-.04.97.97 0 0 1-.47-.81V13.6L3.75 6.15a1 1 0 0 1-.25-.65Z"
                    />
                  </svg>
                  <span>Filters</span>
                </button>
                <div className="top-user-wrap">
                  <button
                    type="button"
                    className="top-user-toggle"
                    aria-label="User menu"
                    aria-expanded={isUserMenuOpen}
                    onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M18.685 19.097A9.723 9.723 0 0 0 21.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 0 0 3.065 7.097A9.716 9.716 0 0 0 12 21.75a9.716 9.716 0 0 0 6.685-2.653Zm-12.54-1.285A7.486 7.486 0 0 1 12 15a7.486 7.486 0 0 1 5.855 2.812A8.224 8.224 0 0 1 12 20.25a8.224 8.224 0 0 1-5.855-2.438ZM15.75 9a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </header>

            <section className="position-pulse" aria-label="Position pulse summary">
              {positionPulseCards.map((card) => {
                const isTrendCard =
                  card.key === "realized" || card.key === "unrealized" || card.key === "fees";
                const isChartMode = isTrendCard && Boolean(chartModeByCard[card.key]);
                const sparkline = isChartMode ? buildSparklineModel(card.trend || []) : null;
                const hoveredIndex = chartHover.key === card.key ? chartHover.index : -1;
                const hoveredPoint =
                  sparkline && hoveredIndex >= 0 && hoveredIndex < sparkline.points.length
                    ? sparkline.points[hoveredIndex]
                    : null;
                return (
                  <article
                    key={card.key}
                    className={`position-pulse-card ${isTrendCard ? "is-clickable" : ""} ${isChartMode ? "is-chart-mode" : ""
                      }`}
                    onClick={
                      isTrendCard
                        ? () => handlePulseCardSingleClick(card.key)
                        : undefined
                    }
                    role={isTrendCard ? "button" : undefined}
                    tabIndex={isTrendCard ? 0 : undefined}
                    aria-pressed={isTrendCard ? isChartMode : undefined}
                    onDoubleClick={
                      isTrendCard
                        ? () => handlePulseCardDoubleClick(card)
                        : undefined
                    }
                    onKeyDown={
                      isTrendCard
                        ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setChartModeByCard((prev) => ({ ...prev, [card.key]: !prev[card.key] }));
                            setChartHover((prev) =>
                              prev.key === card.key ? { key: null, index: -1 } : prev
                            );
                          }
                        }
                        : undefined
                    }
                    title={isTrendCard ? "Single click: mini chart. Double click: open full PnL Trend." : undefined}
                  >
                    <header className="position-pulse-head">
                      <h2>{card.label}</h2>
                    </header>
                    {isChartMode ? (
                      <div className="position-pulse-chart-wrap" aria-hidden>
                        {sparkline?.path ? (
                          <svg
                            className="position-pulse-chart"
                            viewBox="0 0 220 44"
                            preserveAspectRatio="none"
                            onMouseMove={(event) => {
                              if (!sparkline || sparkline.points.length === 0) return;
                              const bounds = event.currentTarget.getBoundingClientRect();
                              if (!bounds.width || !bounds.height) return;
                              const relativeX = ((event.clientX - bounds.left) / bounds.width) * sparkline.width;
                              let nearestIndex = 0;
                              let nearestDistance = Math.abs(sparkline.points[0].x - relativeX);
                              for (let index = 1; index < sparkline.points.length; index += 1) {
                                const distance = Math.abs(sparkline.points[index].x - relativeX);
                                if (distance < nearestDistance) {
                                  nearestDistance = distance;
                                  nearestIndex = index;
                                }
                              }
                              setChartHover((prev) =>
                                prev.key === card.key && prev.index === nearestIndex
                                  ? prev
                                  : { key: card.key, index: nearestIndex }
                              );
                            }}
                            onMouseLeave={() => {
                              setChartHover((prev) =>
                                prev.key === card.key ? { key: null, index: -1 } : prev
                              );
                            }}
                          >
                            <path d={sparkline.path} />
                            {hoveredPoint && (
                              <circle
                                className="position-pulse-chart-point"
                                cx={hoveredPoint.x}
                                cy={hoveredPoint.y}
                                r="2.8"
                              />
                            )}
                          </svg>
                        ) : (
                          <div className="position-pulse-chart-empty">No chart data</div>
                        )}
                        {hoveredPoint && (
                          <div
                            className="position-pulse-chart-tooltip"
                            style={{
                              left: `${(hoveredPoint.x / sparkline.width) * 100}%`,
                              top: `${(hoveredPoint.y / sparkline.height) * 100}%`
                            }}
                          >
                            {formatDollarValue(hoveredPoint.value)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className={`position-pulse-value ${card.valueClass || "is-neutral"}`}>{card.value}</div>
                        <div className="position-pulse-meta">{card.meta}</div>
                      </>
                    )}
                  </article>
                );
              })}
            </section>

            {error && <div className="error">{error}</div>}
            <section className="table-card ag-theme-quartz">
              <div className="table-card-toolbar">
                <section className="positions-toolbar positions-toolbar-embedded">
                  <div className="positions-toolbar-left">
                    <input
                      className="positions-quick-filter-input"
                      type="text"
                      placeholder="Quick filter"
                      value={quickFilterText}
                      onChange={(event) => setQuickFilterText(event.target.value)}
                    />
                  </div>
                  <div className="positions-toolbar-right">
                    <button
                      type="button"
                      className="secondary-button market-button positions-columns-default-button"
                      onClick={resetVisibleColumnsToDefault}
                    >
                      Default
                    </button>
                    <div className="positions-columns-dropdown" ref={columnsDropdownRef}>
                      <button
                        type="button"
                        className="secondary-button market-button market-button-accent market-split-button"
                        onClick={() => setIsColumnsDropdownOpen((prev) => !prev)}
                        aria-haspopup="menu"
                        aria-expanded={isColumnsDropdownOpen}
                      >
                        <span className="market-split-button-label">
                          Column Filters
                          <span className="market-split-button-count-plain">{visibleColumns.length}</span>
                        </span>
                        <span className="market-split-button-caret" aria-hidden>
                          ▾
                        </span>
                      </button>
                      {isColumnsDropdownOpen && (
                        <div className="positions-columns-dropdown-menu" role="menu">
                          <div className="positions-columns-wrap">
                            <div className="positions-columns">
                              {columns.map((column) => (
                                <label key={column} className="column-toggle">
                                  <input
                                    type="checkbox"
                                    checked={visibleColumns.includes(column)}
                                    onChange={() => toggleVisibleColumn(column)}
                                  />
                                  <span>{toTitleCaseLabel(column.replaceAll("_", " "))}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
              {positionsLoading && (
                <div className="table-loading-overlay" aria-live="polite" aria-label="Refreshing data">
                  <div className="table-loading-spinner" aria-hidden />
                </div>
              )}
              <AgGridReact
                modules={enterpriseGridModules}
                containerStyle={{ height: "100%", width: "100%" }}
                rowData={gridRows}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                quickFilterText={quickFilterText}
                suppressNoRowsOverlay
                rowHeight={42}
                headerHeight={44}
                getRowId={getPositionRowId}
                suppressScrollOnNewData
                enableCharts
                pagination
                paginationPageSize={25}
                paginationPageSizeSelector={[25, 50, 100]}
                animateRows={false}
                onGridReady={(params) => {
                  positionsGridApiRef.current = params.api;
                }}
                onColumnVisible={(params) => {
                  syncVisibleColumnsFromGrid(params.api);
                }}
                onCellDoubleClicked={handleTrendCellDoubleClick}
              />
              {positionsLastSyncedAt && (
                <div className="table-footer-sync">
                  Updated {positionsLastSyncedAt.toLocaleTimeString()}
                </div>
              )}
              {rows.length === 0 && (
                <div className="grid-fallback-empty">
                  {positionsLoading
                    ? "Loading positions..."
                    : error
                      ? error
                      : "No data available. Please contact your administrator."}
                </div>
              )}
            </section>
          </div>
        )}

        {activeView === "books" && canViewBooks && (
          <div className="books-page">
            <header className="header header-with-actions">
              <div className="header-title-block">
                Books
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className={`secondary-button refresh-button market-button market-button-accent ${booksLoading || booksSaving || isBooksRefreshAnimating ? "is-loading" : ""
                    }`}
                  onClick={handleRefreshBooks}
                  disabled={booksLoading || booksSaving || isBooksRefreshAnimating}
                  aria-busy={booksLoading || booksSaving || isBooksRefreshAnimating}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className={`refresh-button-icon ${booksLoading || booksSaving || isBooksRefreshAnimating ? "is-spinning" : ""
                      }`}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                  <span>Refresh</span>
                </button>
                <div className="top-user-wrap">
                  <button
                    type="button"
                    className="top-user-toggle"
                    aria-label="User menu"
                    aria-expanded={isUserMenuOpen}
                    onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M18.685 19.097A9.723 9.723 0 0 0 21.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 0 0 3.065 7.097A9.716 9.716 0 0 0 12 21.75a9.716 9.716 0 0 0 6.685-2.653Zm-12.54-1.285A7.486 7.486 0 0 1 12 15a7.486 7.486 0 0 1 5.855 2.812A8.224 8.224 0 0 1 12 20.25a8.224 8.224 0 0 1-5.855-2.438ZM15.75 9a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </header>

            {booksError && <div className="error">{booksError}</div>}
            <section className="books-grid">
              <div className="books-card">
                <form className="book-create" onSubmit={handleCreateBook}>
                  <input
                    className="book-input"
                    type="text"
                    value={newBookName}
                    onChange={(event) => setNewBookName(event.target.value)}
                    placeholder="Book name"
                    disabled={booksSaving}
                  />
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={booksSaving || newBookName.trim() === ""}
                  >
                    Create Book
                  </button>
                </form>

                <div className="books-list">
                  {booksLoading && <div className="books-empty">Loading books...</div>}
                  {!booksLoading && books.length === 0 && (
                    <div className="books-empty">No books yet. Create your first one.</div>
                  )}
                  {!booksLoading &&
                    books.map((book) => (
                      <button
                        key={book.id}
                        type="button"
                        className={`book-item ${selectedBookId === book.id ? "is-active" : ""}`}
                        onClick={() => {
                          setSelectedBookId(book.id);
                          setSelectedAccounts([...book.accounts]);
                        }}
                      >
                        <span className="book-item-name">{book.name}</span>
                        <span className="book-item-meta">{book.accounts.length} accounts</span>
                      </button>
                    ))}
                </div>
                {booksLastSyncedAt && (
                  <div className="books-footer-sync">
                    Updated {booksLastSyncedAt.toLocaleTimeString()}
                  </div>
                )}
              </div>

              <div className="books-card books-card-accounts">
                <h2>Accounts</h2>

                <div className="accounts-filter-row">
                  <div className="accounts-filter-select-wrap" ref={accountsFilterRef}>
                    <button
                      type="button"
                      className={`accounts-filter-trigger ${isAccountsFilterOpen ? "is-open" : ""}`}
                      disabled={booksSaving || booksLoading}
                      onClick={() => setIsAccountsFilterOpen((prev) => !prev)}
                      aria-haspopup="listbox"
                      aria-expanded={isAccountsFilterOpen}
                      aria-label="Accounts filter"
                    >
                      <span>{`${selectedAccountFilterOption.label} (${selectedAccountFilterOption.count})`}</span>
                    </button>
                    <span className="accounts-filter-chevron" aria-hidden>
                      ▾
                    </span>

                    {isAccountsFilterOpen && (
                      <div className="accounts-filter-menu" role="listbox" aria-label="Accounts filter options">
                        {accountFilterOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={accountsFilter === option.value}
                            className={`accounts-filter-option ${accountsFilter === option.value ? "is-active" : ""
                              }`}
                            onClick={() => {
                              setAccountsFilter(option.value);
                              setIsAccountsFilterOpen(false);
                            }}
                          >
                            <span>{option.label}</span>
                            <span className="accounts-filter-count">{option.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {!selectedBook && (
                  <div className="books-empty">Select a book to assign accounts.</div>
                )}
                <div className="book-selected-head">
                  <div>
                    <div className="book-item-name">{selectedBook ? selectedBook.name : "No book selected"}</div>
                    <div className="book-item-meta">
                      {selectedBook ? `${selectedAccounts.length} selected accounts` : "Choose a book from the list"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={requestDeleteBook}
                    disabled={booksSaving || !selectedBook}
                  >
                    Delete Book
                  </button>
                </div>
                {selectedBook && (
                  <>
                    <div className="accounts-list">
                      {visibleAccounts.length === 0 && (
                        <div className="books-empty">
                          {accounts.length === 0
                            ? "No accounts found in database yet."
                            : "No accounts for selected filter."}
                        </div>
                      )}
                      {visibleAccounts.map((account) => {
                        const locked = isAccountLockedToAnotherBook(account);
                        const owner = accountOwnerByAccount.get(account);
                        return (
                          <label
                            key={account}
                            className={`account-row ${unassignedAccountsSet.has(account) ? "is-unassigned" : ""
                              } ${locked ? "is-locked" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedAccounts.includes(account)}
                              onChange={() => toggleAccountSelection(account)}
                              disabled={booksSaving || locked}
                            />
                            <span>{account}</span>
                            {locked && owner?.bookName && (
                              <span className="account-state-tag account-state-tag-locked">
                                {owner.bookName}
                              </span>
                            )}
                            {!locked && unassignedAccountsSet.has(account) && (
                              <span className="account-state-tag">NEW</span>
                            )}
                          </label>
                        );
                      })}
                    </div>

                    <div className="books-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={toggleAllVisibleAccounts}
                        disabled={booksSaving || visibleSelectableAccounts.length === 0}
                      >
                        {allVisibleAccountsSelected ? "Clear All" : "Select All"}
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={handleSaveAccounts}
                        disabled={booksSaving}
                      >
                        Save Accounts
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        )}

        {activeView === "access" && canManageAccess && (
          <div className="books-page access-page">
            <header className="header header-with-actions">
              <div className="header-title-block">
                Access Management
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className={`secondary-button refresh-button market-button market-button-accent ${accessLoading || accessSaving || isAccessRefreshAnimating ? "is-loading" : ""
                    }`}
                  onClick={handleRefreshAccess}
                  disabled={accessLoading || accessSaving || isAccessRefreshAnimating}
                  aria-busy={accessLoading || accessSaving || isAccessRefreshAnimating}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className={`refresh-button-icon ${accessLoading || accessSaving || isAccessRefreshAnimating ? "is-spinning" : ""
                      }`}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                  <span>Refresh</span>
                </button>
                <div className="top-user-wrap">
                  <button
                    type="button"
                    className="top-user-toggle"
                    aria-label="User menu"
                    aria-expanded={isUserMenuOpen}
                    onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M18.685 19.097A9.723 9.723 0 0 0 21.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 0 0 3.065 7.097A9.716 9.716 0 0 0 12 21.75a9.716 9.716 0 0 0 6.685-2.653Zm-12.54-1.285A7.486 7.486 0 0 1 12 15a7.486 7.486 0 0 1 5.855 2.812A8.224 8.224 0 0 1 12 20.25a8.224 8.224 0 0 1-5.855-2.438ZM15.75 9a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </header>

            {accessError && <div className="error access-error">{accessError}</div>}
            <section className="access-body">
              <section className="books-grid access-grid access-grid-single">
                <div className="books-card access-card access-permissions-card">
                  <div className="access-card-head">
                    <h2>User Permissions</h2>
                  </div>
                  <div className="access-permissions-toolbar">
                    <button
                      type="button"
                      className="access-create-tile"
                      onClick={() => setIsCreateUserOpen(true)}
                    >
                      + Create User
                    </button>
                    <div className="access-filter-wrap">
                      <input
                        className="book-input access-filter-input"
                        type="text"
                        value={accessUserFilter}
                        onChange={(event) => setAccessUserFilter(event.target.value)}
                        onFocus={() => setIsAccessFilterOpen(true)}
                        onBlur={() => setTimeout(() => setIsAccessFilterOpen(false), 120)}
                        placeholder="Search by username"
                        disabled={accessLoading}
                        aria-expanded={isAccessFilterOpen}
                        aria-haspopup="listbox"
                      />
                      {isAccessFilterOpen && accessFilterOptions.length > 0 && (
                        <div className="access-filter-menu" role="listbox">
                          {accessFilterOptions.map((user) => (
                            <button
                              key={user.id}
                              type="button"
                              className="access-filter-option"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setAccessUserFilter(String(user.username ?? ""));
                                setIsAccessFilterOpen(false);
                              }}
                            >
                              {user.username}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="access-results-meta">
                      {accessLoading ? "Loading..." : `${filteredAccessUsers.length} users`}
                    </div>
                  </div>
                  {accessLoading && <div className="books-empty">Loading users...</div>}
                  {!accessLoading && filteredAccessUsers.length === 0 && (
                    <div className="books-empty">
                      {accessUsers.length === 0 ? "No users found." : "No users match the filter."}
                    </div>
                  )}
                  {!accessLoading && filteredAccessUsers.length > 0 && (
                    <div className="accounts-list access-users-list">
                      {filteredAccessUsers.map((user) => {
                        const permissionLabels = [
                          user.permissions.can_view_positions ? "Positions" : null,
                          user.permissions.can_view_books ? "Books" : null,
                          user.permissions.can_manage_access ? "Access" : null
                        ].filter(Boolean);
                        const permissionsSummary = permissionLabels.length
                          ? permissionLabels.join(" · ")
                          : "No access";
                        const bookCount = Array.isArray(user.position_book_ids)
                          ? user.position_book_ids.length
                          : 0;
                        const booksSummary = user.permissions.can_view_positions
                          ? bookCount === 0
                            ? "All books"
                            : `${bookCount} books`
                          : "No books";
                        return (
                          <button
                            key={user.id}
                            type="button"
                            className="access-user-item"
                            onClick={() => setSelectedAccessUserId(user.id)}
                          >
                            <div className="access-user-item-main">
                              <span className="access-user-name">{user.username}</span>
                              {user.is_admin && <span className="account-state-tag">ADMIN</span>}
                            </div>
                            <div className="access-user-item-meta">
                              <span>{permissionsSummary}</span>
                              <span>{booksSummary}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </section>

            {isCreateUserOpen && (
              <div className="access-modal-backdrop">
                <button
                  type="button"
                  className="access-modal-scrim"
                  aria-label="Close create user"
                  onClick={() => setIsCreateUserOpen(false)}
                />
                <div className="access-modal" role="dialog" aria-modal="true" aria-label="Create user">
                  <div className="access-modal-head">
                    <div>
                      <h2>Create User</h2>
                      <p>Create credentials and assign access scope.</p>
                    </div>
                    <button
                      type="button"
                      className="access-modal-close"
                      onClick={() => setIsCreateUserOpen(false)}
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>
                  <form className="access-modal-body access-create-form" onSubmit={handleCreateAccessUser}>
                    <label className="access-field">
                      <span>Username</span>
                      <input
                        className="book-input"
                        type="text"
                        value={newAccessUsername}
                        onChange={(event) => setNewAccessUsername(event.target.value)}
                        placeholder="Username"
                        disabled={accessSaving}
                      />
                      {accessUserExists && (
                        <span className="access-inline-error">Username already exists.</span>
                      )}
                    </label>
                    <label className="access-field">
                      <span>Password</span>
                      <div className="access-password-field">
                        <input
                          className="book-input access-password-input"
                          type={isAccessPasswordVisible ? "text" : "password"}
                          value={newAccessPassword}
                          onChange={(event) => setNewAccessPassword(event.target.value)}
                          placeholder="Password"
                          disabled={accessSaving}
                        />
                        <button
                          type="button"
                          className={`access-password-toggle ${isAccessPasswordVisible ? "is-visible" : ""}`}
                          onClick={() => setIsAccessPasswordVisible((prev) => !prev)}
                          aria-label={isAccessPasswordVisible ? "Hide password" : "Show password"}
                          aria-pressed={isAccessPasswordVisible}
                        >
                          <PasswordVisibilityIcon visible={isAccessPasswordVisible} />
                        </button>
                      </div>
                    </label>
                    <label className="access-admin-toggle">
                      <input
                        type="checkbox"
                        checked={newAccessIsAdmin}
                        onChange={(event) => setNewAccessIsAdmin(event.target.checked)}
                        disabled={accessSaving}
                      />
                      <span className="access-admin-text">
                        <span className="access-admin-title">Administrator</span>
                        <span className="access-admin-hint">Full access to books, positions, and access.</span>
                      </span>
                    </label>
                    <div className="access-modal-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setIsCreateUserOpen(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="primary-button access-submit-button"
                        disabled={
                          accessSaving ||
                          !newAccessUsername.trim() ||
                          !newAccessPassword ||
                          accessUserExists
                        }
                      >
                        Add User
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {selectedAccessUser && (
              <div className="access-modal-backdrop">
                <button
                  type="button"
                  className="access-modal-scrim"
                  aria-label="Close user editor"
                  onClick={() => setSelectedAccessUserId(null)}
                />
                <div
                  className="access-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label={`Edit ${selectedAccessUser.username}`}
                >
                  <div className="access-modal-head">
                    <div>
                      <h2>{selectedAccessUser.username}</h2>
                    </div>
                    <button
                      type="button"
                      className="access-modal-close"
                      onClick={() => setSelectedAccessUserId(null)}
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="access-modal-body">
                    <div className="access-modal-section">
                      <h3>Permissions</h3>
                      <div className="access-user-permissions">
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(accessDraftPermissions?.can_view_positions)}
                            disabled={accessSaving || isProtectedAdminUser(selectedAccessUser)}
                            onChange={(event) =>
                              setAccessDraftPermissions((prev) => ({
                                can_view_positions: event.target.checked,
                                can_view_books: Boolean(prev?.can_view_books),
                                can_manage_access: Boolean(prev?.can_manage_access)
                              }))
                            }
                          />
                          <span>Positions</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(accessDraftPermissions?.can_view_books)}
                            disabled={accessSaving || isProtectedAdminUser(selectedAccessUser)}
                            onChange={(event) =>
                              setAccessDraftPermissions((prev) => ({
                                can_view_positions: Boolean(prev?.can_view_positions),
                                can_view_books: event.target.checked,
                                can_manage_access: Boolean(prev?.can_manage_access)
                              }))
                            }
                          />
                          <span>Books</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(accessDraftPermissions?.can_manage_access)}
                            disabled={accessSaving || isProtectedAdminUser(selectedAccessUser)}
                            onChange={(event) =>
                              setAccessDraftPermissions((prev) => ({
                                can_view_positions: Boolean(prev?.can_view_positions),
                                can_view_books: Boolean(prev?.can_view_books),
                                can_manage_access: event.target.checked
                              }))
                            }
                          />
                          <span>Access</span>
                        </label>
                      </div>
                      <div className="access-permissions-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={handleSaveAccessPermissions}
                          disabled={
                            accessSaving ||
                            isProtectedAdminUser(selectedAccessUser) ||
                            !isAccessPermissionsChanged
                          }
                        >
                          Save Permissions
                        </button>
                      </div>
                    </div>
                    <div className="access-modal-section">
                      <div className="access-user-book-scope">
                        <div className="access-user-book-scope-head">
                          <strong>Positions books scope</strong>
                          <span className="access-user-book-summary">
                            {accessDraftPermissions?.can_view_positions
                              ? accessDraftBookIds.length === 0
                                ? "All books"
                                : `${accessDraftBookIds.length} selected`
                              : "No access"}
                          </span>
                        </div>
                        {accessBooks.length === 0 && (
                          <div className="books-empty">No books available.</div>
                        )}
                        {accessBooks.length > 0 && (
                          <details className="access-user-book-dropdown">
                            <summary className="access-user-book-trigger">
                              <span>Books list</span>
                              <span className="access-user-book-trigger-meta">
                                {accessDraftPermissions?.can_view_positions
                                  ? accessDraftBookIds.length === 0
                                    ? "All books"
                                    : `${accessDraftBookIds.length} selected`
                                  : "No access"}
                              </span>
                            </summary>
                            <div className="access-user-book-options">
                              {accessBooks.map((book) => (
                                <label key={`${selectedAccessUser.id}-${book.id}`} className="access-user-book-option">
                                  <input
                                    type="checkbox"
                                    checked={accessDraftBookIds.includes(book.id)}
                                    disabled={
                                      accessSaving ||
                                      isProtectedAdminUser(selectedAccessUser) ||
                                      !accessDraftPermissions?.can_view_positions
                                    }
                                    onChange={() => toggleUserPositionBook(book.id)}
                                  />
                                  <span>{book.name}</span>
                                </label>
                              ))}
                            </div>
                          </details>
                        )}
                        <div className="access-permissions-actions">
                          <button
                            type="button"
                            className="primary-button"
                            onClick={handleSaveAccessBookScope}
                            disabled={
                              accessSaving ||
                              isProtectedAdminUser(selectedAccessUser) ||
                              !accessDraftPermissions?.can_view_positions ||
                              !isAccessBookScopeChanged
                            }
                          >
                            Save Book Scope
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="access-modal-actions">
                    <button
                      type="button"
                      className="danger-button"
                      onClick={requestDeleteAccessUser}
                      disabled={accessSaving || isProtectedAdminUser(selectedAccessUser)}
                    >
                      Delete User
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setSelectedAccessUserId(null)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {pendingDelete && (
        <div className="access-modal-backdrop">
          <button
            type="button"
            className="access-modal-scrim"
            aria-label="Close confirmation"
            onClick={() => setPendingDelete(null)}
          />
          <div className="access-modal access-confirm-modal" role="dialog" aria-modal="true">
            <div className="access-modal-head">
              <div>
                <h2>Confirm Delete</h2>
                <p>
                  {pendingDelete.type === "book"
                    ? `Are you sure you want to delete book "${pendingDelete.name}"?`
                    : `Are you sure you want to delete user "${pendingDelete.name}"?`}
                </p>
              </div>
              <button
                type="button"
                className="access-modal-close"
                onClick={() => setPendingDelete(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="access-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingDelete(null)}>
                No
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={handleConfirmDelete}
                disabled={booksSaving || accessSaving}
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {expandedTrend && (
        <TrendFullscreenModal
          trendItem={expandedTrend}
          isDarkTheme={isDarkTheme}
          onClose={() => setExpandedTrend(null)}
        />
      )}

      {symbolTradeHistory && (
        <SymbolTradeHistoryModal
          symbol={symbolTradeHistory.symbol}
          rows={symbolTradeHistory.rows}
          loading={symbolTradeHistory.loading}
          error={symbolTradeHistory.error}
          onClose={() => setSymbolTradeHistory(null)}
        />
      )}

      <aside
        className={`positions-filter-drawer ${activeView === "positions" && canViewPositions && isPositionsFilterDrawerOpen ? "is-open" : "is-closed"
          }`}
      >
        {activeView === "positions" && canViewPositions && isPositionsFilterDrawerOpen && (
          <div
            className="panel-resizer panel-resizer-right"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize filters panel"
            aria-valuemin={MIN_FILTERS_WIDTH}
            aria-valuemax={MAX_FILTERS_WIDTH}
            aria-valuenow={filtersPanelWidth}
            onPointerDown={(event) => startPanelResize("filters", event)}
          />
        )}
        <div className="positions-filter-drawer-head">
          <h2>Filters</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setIsPositionsFilterDrawerOpen(false)}
            aria-label="Close filters"
          >
            ✕
          </button>
        </div>
        <label className="position-filter">
          <span>Date From</span>
          <input
            type="date"
            min={DATE_PICKER_MIN}
            max={DATE_PICKER_MAX}
            lang="en-US"
            title="MM/DD/YYYY"
            value={dateFromInputValue}
            onChange={handleDateFromInputChange}
          />
        </label>
        <label className="position-filter">
          <span>Date To</span>
          <input
            type="date"
            min={DATE_PICKER_MIN}
            max={DATE_PICKER_MAX}
            lang="en-US"
            title="MM/DD/YYYY"
            value={dateToInputValue}
            onChange={handleDateToInputChange}
          />
        </label>
        <label className="position-filter">
          <span>Book</span>
          <div className="position-book-filter-wrap" ref={bookFilterRef}>
            <button
              type="button"
              className={`position-book-filter-trigger ${isBookFilterOpen ? "is-open" : ""}`}
              onClick={() => setIsBookFilterOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={isBookFilterOpen}
              aria-label="Book filter"
            >
              <span>{draftBookFilterLabel}</span>
            </button>
            <span className="position-book-filter-chevron" aria-hidden>
              ▾
            </span>
            {isBookFilterOpen && (
              <div className="position-book-filter-menu" role="listbox" aria-label="Book filter options">
                <button
                  type="button"
                  role="option"
                  aria-selected={draftBookFilterValues.length === 0}
                  className={`position-book-filter-option ${draftBookFilterValues.length === 0 ? "is-active" : ""}`}
                  onClick={() => setDraftBookFilterValues([])}
                >
                  <span>All books</span>
                </button>
                {bookFilterOptions.map((option) => (
                  <button
                    key={option.value || "__all_books__"}
                    type="button"
                    role="option"
                    aria-selected={draftBookFilterValues.includes(option.value)}
                    className={`position-book-filter-option ${draftBookFilterValues.includes(option.value) ? "is-active" : ""
                      }`}
                    onClick={() => toggleDraftBookFilterValue(option.value)}
                  >
                    <input
                      type="checkbox"
                      checked={draftBookFilterValues.includes(option.value)}
                      onChange={() => toggleDraftBookFilterValue(option.value)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="position-book-filter-applied">Applied: {appliedBookFilterLabel}</span>
        </label>
        <div className="positions-filter-actions">
          <button
            type="button"
            className="primary-button"
            onClick={applyPositionFilters}
            disabled={positionsLoading}
          >
            Apply Filters
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={resetPositionFilters}
            disabled={positionsLoading}
          >
            Clear Filters
          </button>
        </div>
      </aside>
    </div>
  );
}
