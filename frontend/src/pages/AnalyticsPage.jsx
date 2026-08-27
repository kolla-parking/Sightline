// Analytics & Forecasts — scope-aware. Portfolio: small multiples + compare.
// Single site: KPI strip, main occupancy chart with forecast overlay, zone
// breakdown, hourly flow, and a typical-week heat grid.

import { useMemo, useState } from "react";
import { useStore, useTwinTime } from "../store/useStore.js";
import { SITES, siteById, KIND_LABEL } from "../sim/sites.js";
import {
  siteSnapshot,
  siteSeries,
  siteRateSeries,
  siteForecast,
  siteFlow,
  siteRate,
  siteRevenueToday,
  HOUR,
  MIN,
} from "../sim/engine.js";
import { Stat, Pill, Segmented, EmptyState, Dot } from "../components/ui.jsx";
import { TimeChart, Bars } from "../components/charts.jsx";
import {
  fmtPct,
  fmtPct1,
  fmtDuration,
  fmtMoney,
  fmtNum,
  fmtClock,
} from "../lib/format.js";

const RANGE_STEP = { 6: 10 * MIN, 24: 20 * MIN, 48: 30 * MIN };
const RANGE_OPTIONS = [
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 48, label: "48h" },
];
const HORIZON_OPTIONS = [
  { value: 0, label: "off" },
  { value: 6, label: "6h" },
  { value: 12, label: "12h" },
];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function occTone(pct, congestionPct) {
  if (pct >= congestionPct) return "danger";
  if (pct >= congestionPct - 10) return "warn";
  return undefined;
}

/* ================= single-site ================= */

function FlowRow({ label, inflow, outflow, max, title }) {
  const w = (v) => `${max ? Math.min(100, (v / max) * 100) : 0}%`;
  return (
    <div className="row" style={{ gap: 8 }} title={title}>
      <div
        className="num"
        style={{ width: 26, fontSize: "var(--fs-0)", color: "var(--ink-faint)", textAlign: "right" }}
      >
        {label}
      </div>
      <div style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
        <div style={{ height: 4, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}>
          <div style={{ width: w(inflow), height: "100%", borderRadius: 2, background: "var(--ok)", transition: "width var(--t-med) var(--ease-out)" }} />
        </div>
        <div style={{ height: 4, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}>
          <div style={{ width: w(outflow), height: "100%", borderRadius: 2, background: "var(--ink-faint)", transition: "width var(--t-med) var(--ease-out)" }} />
        </div>
      </div>
      <div className="num" style={{ width: 58, textAlign: "right", fontSize: "var(--fs-0)" }}>
        <span style={{ color: "var(--ok)" }}>{fmtNum(inflow)}</span>
        <span style={{ color: "var(--ink-faint)" }}> / {fmtNum(outflow)}</span>
      </div>
    </div>
  );
}

function TypicalWeek({ siteId, ts }) {
  const hourBucket = Math.floor(ts / HOUR);

  // Rates for each weekday-hour from the most recent past instance of that
  // weekday (past 7 days, today excluded so every cell is historical).
  const grid = useMemo(() => {
    const byRow = new Array(7).fill(null);
    for (let off = 1; off <= 7; off++) {
      const d = new Date(ts - off * 24 * HOUR);
      const row = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
      if (byRow[row] == null) byRow[row] = d;
    }
    return byRow.map((d) => {
      const cells = [];
      for (let h = 0; h < 24; h++) {
        const t = new Date(d);
        t.setHours(h, 30, 0, 0);
        cells.push(siteRate(siteId, t.getTime()));
      }
      return cells;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, hourBucket]);

  const nowD = new Date(ts);
  const nowRow = (nowD.getDay() + 6) % 7;
  const nowCol = nowD.getHours();

  return (
    <div className="scroll" style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "28px repeat(24, 10px)", gap: 1, justifyContent: "start" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={`h${h}`}
            className="num"
            style={{ fontSize: 8, color: "var(--ink-faint)", height: 12, overflow: "visible", whiteSpace: "nowrap" }}
          >
            {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
          </div>
        ))}
        {grid.map((cells, r) => (
          <div key={DAY_LABELS[r]} style={{ display: "contents" }}>
            <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", lineHeight: "10px" }}>
              {DAY_LABELS[r]}
            </div>
            {cells.map((rate, h) => (
              <div
                key={h}
                title={`${DAY_LABELS[r]} ${String(h).padStart(2, "0")}:00 · ${Math.round(rate * 100)}%`}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: `color-mix(in oklab, var(--accent) ${Math.round(6 + rate * 92)}%, var(--surface-2))`,
                  outline: r === nowRow && h === nowCol ? "1px solid var(--ink-mid)" : "none",
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>low</span>
        <div
          style={{
            width: 90,
            height: 6,
            borderRadius: 3,
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--accent) 6%, var(--surface-2)), var(--accent))",
          }}
        />
        <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>high</span>
        <div className="spacer" />
        <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>past 7 days</span>
      </div>
    </div>
  );
}

function SingleSiteAnalytics({ siteId }) {
  const ts = useTwinTime();
  const mode = useStore((s) => s.mode);
  const realOccupancy = useStore((s) => s.realOccupancy);
  const settings = useStore((s) => s.settings);
  const congestionPct = settings.congestionPct ?? 90;

  const [rangeH, setRangeH] = useState(24);
  const [horizonH, setHorizonH] = useState(6);

  const site = siteById[siteId];
  const kpiBucket = Math.floor(ts / 5000);
  const minuteBucket = Math.floor(ts / MIN);

  // Current snapshot — real override only in live mode (rule 3).
  const snap = useMemo(
    () => siteSnapshot(siteId, ts, site.real && mode === "live" ? realOccupancy : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteId, kpiBucket, mode, realOccupancy],
  );

  // Last-hour flow + revenue (minute bucket).
  const flowHour = useMemo(
    () => siteFlow(siteId, ts - HOUR, ts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteId, minuteBucket],
  );
  const revenue = useMemo(
    () => siteRevenueToday(siteId, ts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteId, minuteBucket],
  );

  // Main chart: scan-truth series for the chosen range + optional forecast.
  const chart = useMemo(() => {
    const step = RANGE_STEP[rangeH];
    const to = Math.ceil(ts / MIN) * MIN;
    const from = to - rangeH * HOUR;
    return {
      data: siteSeries(siteId, from, to, step).map((p) => ({ ts: p.ts, v: p.occupancy })),
      forecast: horizonH ? siteForecast(siteId, to, horizonH) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, rangeH, horizonH, minuteBucket]);

  // Per-hour flow for the last 12h (current partial hour last).
  const flow12 = useMemo(() => {
    const hStart = Math.floor(ts / HOUR) * HOUR;
    const rows = [];
    for (let i = 11; i >= 0; i--) {
      const from = hStart - i * HOUR;
      const to = Math.min(from + HOUR, ts);
      const f = siteFlow(siteId, from, to);
      rows.push({ from, ...f });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, minuteBucket]);
  const flowMax = Math.max(1, ...flow12.map((r) => Math.max(r.inflow, r.outflow)));
  const anyFlow = flow12.some((r) => r.inflow > 0 || r.outflow > 0);

  const zoneBars = useMemo(
    () =>
      site.zones.map((z) => {
        const agg = snap.zones[z.id] || { total: 0, occupied: 0 };
        const pct = agg.total ? (agg.occupied / agg.total) * 100 : 0;
        return { label: z.name, v: pct, tone: pct > 90 ? "var(--space-occupied)" : undefined };
      }),
    [site, snap],
  );

  const turnoverPct = snap.total ? (flowHour.outflow / snap.total) * 100 : 0;
  const stepMin = RANGE_STEP[rangeH] / MIN;

  return (
    <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
      <header className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: "var(--fs-4)" }} className="truncate">
            {site.name}
          </h1>
          <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }} className="truncate">
            {site.address}
          </div>
        </div>
        <Pill>{KIND_LABEL[site.kind]}</Pill>
        {site.real && <Pill tone="ok">live camera</Pill>}
        <div className="spacer" />
        <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>Range</span>
        <Segmented options={RANGE_OPTIONS} value={rangeH} onChange={setRangeH} />
        <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>Forecast</span>
        <Segmented options={HORIZON_OPTIONS} value={horizonH} onChange={setHorizonH} />
      </header>

      <section className="panel">
        <div
          className="panel-body"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16 }}
        >
          <Stat
            label="Occupancy now"
            value={fmtPct(snap.occupancy)}
            sub={`${fmtNum(snap.occupied)} occupied`}
            tone={occTone(snap.occupancy, congestionPct)}
          />
          <Stat label="Available" value={fmtNum(snap.available)} sub={`of ${fmtNum(snap.total)}`} />
          <Stat label="Avg dwell" value={fmtDuration(snap.avgDwellMs)} />
          <Stat
            label="Turnover last hour"
            value={fmtPct1(turnoverPct)}
            sub={`${fmtNum(flowHour.outflow)} departures`}
          />
          <Stat
            label="Flow last hour"
            value={`${fmtNum(flowHour.inflow)} in · ${fmtNum(flowHour.outflow)} out`}
          />
          <Stat label="Revenue today" value={fmtMoney(revenue)} sub={`$${site.rate.toFixed(2)}/hr`} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">Occupancy &amp; forecast</span>
          <div className="spacer" />
          <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
            {rangeH}h · step {stepMin}m
            {horizonH ? ` · +${horizonH}h forecast` : ""} · threshold {congestionPct}%
          </span>
        </div>
        <div className="panel-body">
          <TimeChart
            data={chart.data}
            forecast={chart.forecast}
            w={900}
            h={240}
            now={ts}
            threshold={congestionPct}
          />
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Zone breakdown</span>
            <div className="spacer" />
            <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
              {fmtNum(site.zones.length)} zones
            </span>
          </div>
          <div className="panel-body">
            {zoneBars.length ? (
              <Bars data={zoneBars} />
            ) : (
              <EmptyState title="No zones" hint="This site has no zone map." />
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Flow (last 12h)</span>
            <div className="spacer" />
            <span className="row" style={{ gap: 4, fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
              <Dot tone="ok" /> in
            </span>
            <span className="row" style={{ gap: 4, fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
              <Dot /> out
            </span>
          </div>
          <div className="panel-body" style={{ display: "grid", gap: 5 }}>
            {anyFlow ? (
              flow12.map((r) => (
                <FlowRow
                  key={r.from}
                  label={String(new Date(r.from).getHours()).padStart(2, "0")}
                  inflow={r.inflow}
                  outflow={r.outflow}
                  max={flowMax}
                  title={`${fmtClock(r.from)} — ${fmtNum(r.inflow)} in · ${fmtNum(r.outflow)} out`}
                />
              ))
            ) : (
              <EmptyState title="No movements" hint="No arrivals or departures in the last 12 hours." />
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Typical week</span>
            <div className="spacer" />
            <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>occupancy by hour</span>
          </div>
          <div className="panel-body">
            <TypicalWeek siteId={siteId} ts={ts} />
          </div>
        </section>
      </div>
    </div>
  );
}

/* ================= portfolio ================= */

function PortfolioAnalytics() {
  const ts = useTwinTime();
  const mode = useStore((s) => s.mode);
  const realOccupancy = useStore((s) => s.realOccupancy);
  const settings = useStore((s) => s.settings);
  const setScope = useStore((s) => s.setScope);
  const congestionPct = settings.congestionPct ?? 90;

  const kpiBucket = Math.floor(ts / 5000);
  const fiveMinBucket = Math.floor(ts / (5 * MIN));

  const snaps = useMemo(() => {
    const m = {};
    for (const site of SITES) {
      m[site.id] = siteSnapshot(site.id, ts, site.real && mode === "live" ? realOccupancy : null);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiBucket, mode, realOccupancy]);

  // Cheap closed-form series per site: last 24h + 6h forecast band (rule 2).
  const charts = useMemo(() => {
    const to = Math.ceil(ts / (5 * MIN)) * (5 * MIN);
    const from = to - 24 * HOUR;
    const m = {};
    for (const site of SITES) {
      m[site.id] = {
        data: siteRateSeries(site.id, from, to, 30 * MIN).map((p) => ({ ts: p.ts, v: p.occupancy })),
        forecast: siteForecast(site.id, to, 6),
      };
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiveMinBucket]);

  const peaks = useMemo(
    () =>
      SITES.map((site) => {
        let bestT = ts;
        let bestR = 0;
        for (let t = ts; t <= ts + 8 * HOUR; t += 15 * MIN) {
          const r = siteRate(site.id, t);
          if (r > bestR) {
            bestR = r;
            bestT = t;
          }
        }
        return { site, pct: bestR * 100, at: bestT };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fiveMinBucket],
  );

  const totalSpaces = SITES.reduce((n, s) => n + s.spaces.length, 0);

  const compareBars = SITES.map((site) => {
    const pct = snaps[site.id].occupancy;
    return {
      label: site.name,
      v: pct,
      tone: pct >= congestionPct ? "var(--space-occupied)" : undefined,
    };
  });

  return (
    <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
      <header className="row" style={{ gap: 10 }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-4)" }}>Analytics — Portfolio</h1>
          <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
            {fmtNum(SITES.length)} sites · {fmtNum(totalSpaces)} spaces · 24h history + 6h forecast per site
          </div>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
        {SITES.map((site) => {
          const snap = snaps[site.id];
          const c = charts[site.id];
          const tone = occTone(snap.occupancy, congestionPct);
          return (
            <section key={site.id} className="panel">
              <div className="panel-head">
                <span className="panel-title truncate">{site.name}</span>
                <Pill>{KIND_LABEL[site.kind]}</Pill>
                {site.real && <Pill tone="ok">live</Pill>}
                <div className="spacer" />
                <button className="btn ghost sm" onClick={() => setScope(site.id)}>
                  Focus →
                </button>
              </div>
              <div className="panel-body" style={{ display: "grid", gap: 10 }}>
                <div className="row" style={{ gap: 24 }}>
                  <Stat
                    label="Occupancy now"
                    value={fmtPct(snap.occupancy)}
                    sub={`${fmtNum(snap.occupied)}/${fmtNum(snap.total)}`}
                    tone={tone}
                  />
                  <Stat label="Available" value={fmtNum(snap.available)} />
                  <Stat
                    label="Violations"
                    value={fmtNum(snap.violations)}
                    tone={snap.violations > 0 ? "warn" : undefined}
                  />
                </div>
                <TimeChart
                  data={c.data}
                  forecast={c.forecast}
                  w={460}
                  h={140}
                  now={ts}
                  threshold={congestionPct}
                />
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">Compare</span>
          <div className="spacer" />
          <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
            threshold {congestionPct}%
          </span>
        </div>
        <div
          className="panel-body"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}
        >
          <div>
            <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginBottom: 8 }}>
              Current occupancy
            </div>
            <Bars data={compareBars} />
          </div>
          <div className="scroll" style={{ overflowX: "auto" }}>
            <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginBottom: 8 }}>
              Peak — next 8h
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Now</th>
                  <th>Peak</th>
                  <th>At</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {peaks.map(({ site, pct, at }) => {
                  const nowPct = snaps[site.id].occupancy;
                  const delta = pct - nowPct;
                  return (
                    <tr key={site.id} className="clickable" onClick={() => setScope(site.id)}>
                      <td className="truncate" style={{ maxWidth: 160 }}>{site.name}</td>
                      <td className="num">{fmtPct(nowPct)}</td>
                      <td className="num" style={{ color: pct >= congestionPct ? "var(--danger)" : "var(--ink)" }}>
                        {fmtPct(pct)}
                      </td>
                      <td className="num">{fmtClock(at)}</td>
                      <td className={`num ${delta >= 0 ? "down" : "up"}`}>
                        {delta >= 0 ? "+" : ""}
                        {Math.round(delta)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ================= page ================= */

export default function AnalyticsPage() {
  const scope = useStore((s) => s.scope);
  if (scope !== "portfolio" && siteById[scope]) {
    return <SingleSiteAnalytics siteId={scope} />;
  }
  return <PortfolioAnalytics />;
}
