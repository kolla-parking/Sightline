// Lightweight SVG charts — no chart library, one visual voice.
// All charts: hairline grid, muted axes, tabular-numeral labels.

import { useId, useMemo, useState } from "react";
import { fmtClock } from "../lib/format.js";

const M = { top: 8, right: 8, bottom: 18, left: 30 };

function scale(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

export function Sparkline({ data, w = 120, h = 28, tone = "var(--ink-mid)", fill = false }) {
  if (!data?.length) return <svg width={w} height={h} />;
  const xs = scale([data[0].ts, data[data.length - 1].ts], [1, w - 1]);
  const min = Math.min(...data.map((d) => d.v));
  const max = Math.max(...data.map((d) => d.v));
  const ys = scale([min === max ? min - 1 : min, max === min ? max + 1 : max], [h - 2, 2]);
  const path = data.map((d, i) => `${i ? "L" : "M"}${xs(d.ts).toFixed(1)},${ys(d.v).toFixed(1)}`).join("");
  return (
    <svg width={w} height={h} aria-hidden="true">
      {fill && (
        <path d={`${path}L${(w - 1).toFixed(1)},${h - 1}L1,${h - 1}Z`} fill={tone} opacity={0.12} />
      )}
      <path d={path} fill="none" stroke={tone} strokeWidth={1.4} />
    </svg>
  );
}

// Time-series area/line chart with optional forecast band + "now" marker.
// data: [{ts, v}], forecast: [{ts, mid, lo, hi}]
export function TimeChart({
  data = [],
  forecast = [],
  w = 560,
  h = 180,
  yMax = 100,
  yMin = 0,
  now = null,
  tone = "var(--accent-text)",
  unit = "%",
  threshold = null,
}) {
  const uid = useId();
  const [hover, setHover] = useState(null);

  const all = useMemo(() => {
    const ts = [...data.map((d) => d.ts), ...forecast.map((d) => d.ts)];
    return ts.length ? [Math.min(...ts), Math.max(...ts)] : [0, 1];
  }, [data, forecast]);

  const xs = scale(all, [M.left, w - M.right]);
  const ys = scale([yMin, yMax], [h - M.bottom, M.top]);

  const linePath = data.map((d, i) => `${i ? "L" : "M"}${xs(d.ts).toFixed(1)},${ys(d.v).toFixed(1)}`).join("");
  const areaPath = data.length
    ? `${linePath}L${xs(data[data.length - 1].ts).toFixed(1)},${ys(yMin)}L${xs(data[0].ts).toFixed(1)},${ys(yMin)}Z`
    : "";

  const bandPath = forecast.length
    ? [
        ...forecast.map((d, i) => `${i ? "L" : "M"}${xs(d.ts).toFixed(1)},${ys(d.hi).toFixed(1)}`),
        ...[...forecast].reverse().map((d) => `L${xs(d.ts).toFixed(1)},${ys(d.lo).toFixed(1)}`),
        "Z",
      ].join("")
    : "";
  const midPath = forecast.map((d, i) => `${i ? "L" : "M"}${xs(d.ts).toFixed(1)},${ys(d.mid).toFixed(1)}`).join("");

  const yTicks = [0, 25, 50, 75, 100].filter((t) => t >= yMin && t <= yMax);
  const xTickCount = Math.min(6, Math.max(2, Math.floor(w / 110)));
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => all[0] + ((all[1] - all[0]) * i) / xTickCount);

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = all[0] + ((px - M.left) / (w - M.left - M.right)) * (all[1] - all[0]);
    const src = data.length ? data : forecast.map((f) => ({ ts: f.ts, v: f.mid }));
    if (!src.length) return;
    let best = src[0];
    for (const d of src) if (Math.abs(d.ts - t) < Math.abs(best.ts - t)) best = d;
    setHover(best);
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      role="img"
      aria-label="Time series chart"
    >
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={w - M.right} y1={ys(t)} y2={ys(t)} stroke="var(--line)" />
          <text x={M.left - 5} y={ys(t) + 3} textAnchor="end" fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-data)">
            {t}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={xs(t)} y={h - 5} textAnchor="middle" fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-data)">
          {fmtClock(t)}
        </text>
      ))}

      {threshold != null && (
        <line x1={M.left} x2={w - M.right} y1={ys(threshold)} y2={ys(threshold)} stroke="var(--danger)" strokeDasharray="3 4" opacity={0.5} />
      )}

      {bandPath && <path d={bandPath} fill={tone} opacity={0.1} />}
      {midPath && <path d={midPath} fill="none" stroke={tone} strokeWidth={1.3} strokeDasharray="4 3" opacity={0.75} />}

      {areaPath && (
        <>
          <defs>
            <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.22" />
              <stop offset="100%" stopColor={tone} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#g-${uid})`} />
          <path d={linePath} fill="none" stroke={tone} strokeWidth={1.6} />
        </>
      )}

      {now != null && now >= all[0] && now <= all[1] && (
        <g>
          <line x1={xs(now)} x2={xs(now)} y1={M.top} y2={h - M.bottom} stroke="var(--ink-muted)" strokeDasharray="2 3" />
          <text x={xs(now) + 3} y={M.top + 8} fontSize="8" fill="var(--ink-muted)" fontFamily="var(--font-data)">now</text>
        </g>
      )}

      {hover && (
        <g>
          <line x1={xs(hover.ts)} x2={xs(hover.ts)} y1={M.top} y2={h - M.bottom} stroke="var(--line-strong)" />
          <circle cx={xs(hover.ts)} cy={ys(hover.v)} r={3} fill={tone} />
          <g transform={`translate(${Math.min(xs(hover.ts) + 6, w - 92)}, ${Math.max(ys(hover.v) - 24, M.top)})`}>
            <rect width="86" height="20" rx="4" fill="var(--surface-3)" stroke="var(--line-strong)" />
            <text x="6" y="13" fontSize="9" fill="var(--ink)" fontFamily="var(--font-data)">
              {fmtClock(hover.ts)} · {Math.round(hover.v)}{unit}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}

// Horizontal comparison bars: [{label, v, tone?, detail?}]
export function Bars({ data, max = 100, unit = "%" }) {
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {data.map((d) => (
        <div key={d.label} className="row" style={{ gap: 10 }}>
          <div className="truncate" style={{ width: 130, fontSize: "var(--fs-1)", color: "var(--ink-mid)" }}>{d.label}</div>
          <div style={{ flex: 1, height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, (d.v / max) * 100)}%`,
                height: "100%",
                borderRadius: 3,
                /* quiet by default — callers color only abnormal bars */
                background: d.tone || "var(--border-3)",
                transition: "width var(--t-med) var(--ease-out)",
              }}
            />
          </div>
          <div className="num" style={{ width: 52, textAlign: "right", fontSize: "var(--fs-1)" }}>
            {Math.round(d.v)}
            {unit}
          </div>
        </div>
      ))}
    </div>
  );
}
