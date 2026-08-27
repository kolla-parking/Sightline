// Schematic twin — SVG layout view with wheel zoom + drag pan.
//
// For the real site (sample-lot) with the backend up, the schematic renders
// the backend's actual per-slot polygons in camera space (1280x720) — the
// same geometry the detector runs on. Every other site renders its
// generated layout grid.

import { useMemo, useRef, useState } from "react";

const FILL = {
  free: "var(--space-free)",
  occupied: "var(--space-occupied)",
  violation: "var(--space-violation)",
  special: "var(--space-special)",
  unknown: "var(--space-unknown)",
};

function statusFill(space, status) {
  if (status === "free" && space?.type && space.type !== "standard") return FILL.special;
  return FILL[status] || FILL.unknown;
}

export function SchematicView({ site, snapshot, selectedId, onSelect, level, realPolys }) {
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
    <div style={{ position: "absolute", inset: 0, background: "var(--bg-sunken)" }}>
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
        {/* ground */}
        <rect x={base.x} y={base.y} width={base.w} height={base.h} fill="var(--bg)" stroke="var(--line)" />

        {useReal
          ? realPolys.map((slot) => {
              const st = snapshot?.states.get(`sample-lot:real:${slot.slot_id}`) || null;
              const occupied = snapshot?.realMap?.get(slot.slot_id);
              const status = occupied == null ? "unknown" : occupied ? "occupied" : "free";
              const pts = slot.polygon.map((p) => p.join(",")).join(" ");
              const sel = selectedId === `real:${slot.slot_id}`;
              return (
                <polygon
                  key={slot.slot_id}
                  points={pts}
                  fill={FILL[status]}
                  fillOpacity={0.66}
                  stroke={sel ? "var(--accent)" : "oklch(0 0 0 / 0.55)"}
                  strokeWidth={sel ? 2.5 : 0.8}
                  style={{ cursor: "pointer", transition: "fill var(--t-med)" }}
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
              const sel = selectedId === sp.id;
              return (
                <rect
                  key={sp.id}
                  x={sp.sx}
                  y={sp.sy}
                  width={Math.max(6, sp.sw - 3)}
                  height={Math.max(6, sp.sh - 6)}
                  rx={2}
                  fill={statusFill(sp, status)}
                  fillOpacity={status === "free" ? 0.55 : 0.85}
                  stroke={sel ? "var(--accent)" : "oklch(0 0 0 / 0.4)"}
                  strokeWidth={sel ? 2.5 : 0.7}
                  style={{ cursor: "pointer", transition: "fill var(--t-med)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(sp.id);
                  }}
                >
                  <title>
                    {sp.label} · {sp.zone} — {status}
                  </title>
                </rect>
              );
            })}

        {/* zone labels (generated layouts only) */}
        {!useReal &&
          site.zones
            .filter((z) => (level == null ? true : z.id === `L${level}`))
            .map((z) => {
              const zs = spaces.filter((s) => s.zone === z.id);
              if (!zs.length) return null;
              const minX = Math.min(...zs.map((s) => s.sx));
              const minY = Math.min(...zs.map((s) => s.sy));
              return (
                <text
                  key={z.id}
                  x={minX}
                  y={minY - 8}
                  fontSize={13}
                  fontFamily="var(--font-data)"
                  fill="var(--ink-faint)"
                >
                  {z.id}
                </text>
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
          fontSize: "var(--fs-0)",
          color: "var(--ink-muted)",
          background: "var(--overlay)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-2)",
          padding: "4px 10px",
        }}
      >
        {[
          ["Free", FILL.free],
          ["Occupied", FILL.occupied],
          ["Violation", FILL.violation],
          ["EV / ADA / Res.", FILL.special],
        ].map(([label, color]) => (
          <span key={label} className="row" style={{ gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            {label}
          </span>
        ))}
        <span style={{ color: "var(--ink-faint)" }}>· scroll to zoom · double-click to reset</span>
      </div>
    </div>
  );
}
