// Schematic twin — SVG layout view with wheel zoom + drag pan.
//
// ISA-101 rendering (Daylight v3): healthy states are QUIET — free stalls
// are a quiet outline, occupied stalls a muted neutral fill. Saturation is
// reserved for abnormality: red = violation, amber = needs attention
// (session inside 10 min of its limit), blue = selected/info. Never color
// every stall.
//
// For the real site (sample-lot) with the backend up, the schematic renders
// the backend's actual per-slot polygons in camera space (1280x720) — the
// same geometry the detector runs on. Every other site renders its
// generated layout grid.

import { useMemo, useRef, useState } from "react";
import { sessionPhase, LOW_CONFIDENCE } from "../../sim/engine.js";
import { matchesStallFilter } from "./stallFilters.js";

const ATTENTION_MS = 10 * 60000; // occupied and inside 10 min of the limit

// status + session → quiet-first visual treatment (tokens only)
function stallVisual(space, st, snapshotTs) {
  const status = st ? st.status : "unknown";
  let v;
  if (status === "violation") {
    v = { fill: "var(--stall-violation-fill)", line: "var(--stall-violation-line)", width: 1.4 };
  } else if (status === "occupied") {
    const s = st?.session;
    if (s?.overstayAt && snapshotTs != null && s.overstayAt - snapshotTs < ATTENTION_MS) {
      v = { fill: "var(--stall-attention-fill)", line: "var(--stall-attention-line)", width: 1.2 };
    } else {
      v = { fill: "var(--stall-occ-fill)", line: "var(--stall-occ-line)", width: 1 };
    }
  } else if (status === "free") {
    if (space?.type && space.type !== "standard") {
      v = { fill: "var(--stall-free-fill)", line: "var(--stall-special-line)", width: 1.2, dash: "3 2" };
    } else {
      v = { fill: "var(--stall-free-fill)", line: "var(--stall-line)", width: 1 };
    }
  } else {
    v = { fill: "var(--stall-unknown-fill)", line: "var(--stall-unknown-line)", width: 1, dash: "2 3" };
  }
  // Uncertainty is a LINE treatment, never a new hue: sessions below the
  // confidence threshold keep their state color but render dashed.
  if (st?.session && st.session.confidence < LOW_CONFIDENCE) {
    v = { ...v, dash: "4 3" };
  }
  return v;
}

const LEGEND = [
  { label: "Free", swatch: { background: "var(--stall-free-fill)", border: "1px solid var(--stall-line)" } },
  { label: "Occupied", swatch: { background: "var(--stall-occ-fill)", border: "1px solid var(--stall-occ-line)" } },
  { label: "Attention", swatch: { background: "var(--stall-attention-fill)", border: "1px solid var(--stall-attention-line)" } },
  { label: "Violation", swatch: { background: "var(--stall-violation-fill)", border: "1px solid var(--stall-violation-line)" } },
  { label: "Unverified", swatch: { background: "var(--stall-occ-fill)", border: "1px dashed var(--stall-occ-line)" } },
  { label: "EV / ADA / Res.", swatch: { background: "var(--stall-free-fill)", border: "1px dashed var(--info)" } },
  { label: "Selected", swatch: { background: "transparent", border: "2px solid var(--stall-selected)" } },
];

export function SchematicView({ site, snapshot, selectedId, onSelect, level, realPolys, stateFilter = "all" }) {
  const svgRef = useRef(null);
  const [view, setView] = useState(null); // {x, y, w, h} viewBox override
  const dragRef = useRef(null);

  const useReal = site.real && realPolys && realPolys.length > 0;
  const base = useReal ? { x: 0, y: 0, w: 1280, h: 720 } : { x: 0, y: 0, w: 1000, h: 1000 };
  const vb = view || base;

  const spaces = useMemo(() => {
    if (useReal) return null;
    return level == null ? site.spaces : site.spaces.filter((s) => s.level === level);
  }, [site, level, useReal]);

  function zoomAt(clientX, clientY, factor) {
    const rect = svgRef.current.getBoundingClientRect();
    const px = vb.x + ((clientX - rect.left) / rect.width) * vb.w;
    const py = vb.y + ((clientY - rect.top) / rect.height) * vb.h;
    const w = Math.min(base.w * 1.4, Math.max(base.w / 12, vb.w * factor));
    const h = (w / base.w) * base.h;
    setView({ x: px - ((px - vb.x) / vb.w) * w, y: py - ((py - vb.y) / vb.h) * h, w, h });
  }

  const onWheel = (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.12 : 0.89);
  };

  const onPointerDown = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY, vb };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.x) / rect.width) * dragRef.current.vb.w;
    const dy = ((e.clientY - dragRef.current.y) / rect.height) * dragRef.current.vb.h;
    setView({ ...dragRef.current.vb, x: dragRef.current.vb.x - dx, y: dragRef.current.vb.y - dy });
  };
  const onPointerUp = () => (dragRef.current = null);

  return (
    <div style={{ position: "absolute", inset: 0, background: "var(--bg)" }}>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        style={{ width: "100%", height: "100%", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setView(null)}
        role="img"
        aria-label={`${site.name} schematic`}
      >
        {/* turnover pulse: quiet, reduced-motion-safe (static dot fallback) */}
        <style>{`
          @keyframes stall-turnover { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.95; } }
          .turnover-dot { animation: stall-turnover 2.4s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) {
            .turnover-dot { animation: none; opacity: 0.8; }
          }
        `}</style>

        {/* lot ground: a quiet tinted slab */}
        <rect x={base.x} y={base.y} width={base.w} height={base.h} fill="var(--bg-2)" stroke="var(--border-2)" />

        {useReal
          ? realPolys.map((slot) => {
              const occupied = snapshot?.realMap?.get(slot.slot_id);
              const status = occupied == null ? "unknown" : occupied ? "occupied" : "free";
              const st = { status };
              const v = stallVisual(null, st, snapshot?.ts);
              const pts = slot.polygon.map((p) => p.join(",")).join(" ");
              const sel = selectedId === `real:${slot.slot_id}`;
              const dim = !matchesStallFilter(stateFilter, null, st);
              return (
                <polygon
                  key={slot.slot_id}
                  className={`stall${sel ? " selected" : ""}`}
                  points={pts}
                  fill={v.fill}
                  stroke={v.line}
                  strokeWidth={v.width}
                  strokeDasharray={v.dash}
                  opacity={dim ? 0.25 : 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(`real:${slot.slot_id}`);
                  }}
                >
                  <title>{slot.slot_id} — {status}</title>
                </polygon>
              );
            })
          : spaces.map((sp) => {
              const st = snapshot?.states.get(sp.id);
              const status = st ? st.status : "unknown";
              const v = stallVisual(sp, st, snapshot?.ts);
              const sel = selectedId === sp.id;
              const dim = !matchesStallFilter(stateFilter, sp, st);
              const ph = st?.session ? sessionPhase(st.session, snapshot?.ts) : null;
              const w = Math.max(6, sp.sw - 3);
              return (
                <g key={sp.id} opacity={dim ? 0.25 : 1}>
                  <rect
                    className={`stall${sel ? " selected" : ""}`}
                    x={sp.sx}
                    y={sp.sy}
                    width={w}
                    height={Math.max(6, sp.sh - 6)}
                    rx={2}
                    fill={v.fill}
                    stroke={v.line}
                    strokeWidth={v.width}
                    strokeDasharray={v.dash}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(sp.id);
                    }}
                  >
                    <title>
                      {sp.label} · {sp.zone} — {status}
                    </title>
                  </rect>
                  {ph?.turning && !dim && (
                    <circle
                      className="turnover-dot"
                      cx={sp.sx + w - 5}
                      cy={sp.sy + 5}
                      r={2.4}
                      fill="var(--stall-occ-line)"
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}

        {/* zone labels: dark text on small light chips so they survive
            busy layers (generated layouts only) */}
        {!useReal &&
          site.zones
            .filter((z) => (level == null ? true : z.id === `L${level}`))
            .map((z) => {
              const zs = spaces.filter((s) => s.zone === z.id);
              if (!zs.length) return null;
              const minX = Math.min(...zs.map((s) => s.sx));
              const minY = Math.min(...zs.map((s) => s.sy));
              const w = String(z.id).length * 8 + 12;
              return (
                <g key={z.id} aria-hidden="true">
                  <rect
                    x={minX}
                    y={minY - 24}
                    width={w}
                    height={17}
                    rx={4}
                    fill="var(--stall-label-bg)"
                    stroke="var(--border)"
                  />
                  <text
                    x={minX + 6}
                    y={minY - 12}
                    fontSize={11}
                    fontFamily="var(--font-data)"
                    fill="var(--stall-label-ink)"
                  >
                    {z.id}
                  </text>
                </g>
              );
            })}
      </svg>

      <div
        className="row"
        style={{
          position: "absolute",
          left: 10,
          bottom: 10,
          gap: 10,
          flexWrap: "wrap",
          fontSize: "var(--fs-0)",
          color: "var(--ink-muted)",
          background: "var(--overlay)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-2)",
          boxShadow: "var(--shadow-1)",
          padding: "4px 10px",
        }}
      >
        {LEGEND.map((l) => (
          <span key={l.label} className="row" style={{ gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, ...l.swatch }} />
            {l.label}
          </span>
        ))}
        <span style={{ color: "var(--ink-faint)" }}>· scroll to zoom · double-click to reset</span>
      </div>
    </div>
  );
}
