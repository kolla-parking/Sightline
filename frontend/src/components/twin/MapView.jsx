// Interactive map twin (MapLibre + theme-matched vector tiles).
//
// Portfolio scope: one marker per site (occupancy ring), click to drill.
// Site scope: every space as a GeoJSON polygon colored by live status,
// camera markers with health, optional dwell heat layer.

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../styles/map.css";
import { SITES, siteById, CITY_CENTER } from "../../sim/sites.js";
import { cameraHealth, sessionPhase } from "../../sim/engine.js";
import { matchesStallFilter } from "./stallFilters.js";
import { useStore } from "../../store/useStore.js";

// OpenFreeMap: free vector tiles, no API key. Basemap follows the theme —
// quiet light-gray (Positron) in the light room, dark for overnight.
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

// Theme is read ONCE at map init (the map remounts on navigation, so a
// theme change picks up on the next visit). GL layers cannot read CSS vars
// live — no dynamic theme wiring here (known limitation, see CONTRACT.md).
function isDarkTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
}

// GL layer constants — canvas-side hexes that MIRROR the --stall-* twin
// vocabulary in tokens.css (ISA-101: healthy quiet, saturation = abnormal;
// blue = selected, amber = attention, red = violation) and must be kept in
// sync by hand.
const GL = {
  light: {
    free: "rgba(255,255,255,0.45)",     /* mirrors --stall-free-fill (quiet) */
    occupied: "#dae1dc",                /* mirrors --stall-occ-fill (muted neutral) */
    attention: "#fedf89",               /* mirrors --stall-attention-fill */
    violation: "#d92d20",               /* mirrors --stall-violation-line (saturated = abnormal) */
    special: "rgba(23,92,211,0.16)",    /* mirrors --stall-special-line */
    unknown: "rgba(21,27,23,0.08)",     /* mirrors --stall-unknown-fill */
    outline: "#a5b1aa",                 /* mirrors --stall-line family */
    selected: "#175cd3",                /* mirrors --stall-selected */
    heat: [
      "interpolate", ["linear"], ["heatmap-density"],
      0, "rgba(0,0,0,0)",
      0.3, "rgba(122,133,126,0.3)",
      0.6, "rgba(181,71,8,0.5)",
      1, "rgba(217,45,32,0.65)",
    ],
  },
  dark: {
    free: "rgba(228,234,230,0.06)",
    occupied: "#2a332e",                /* mirrors --stall-occ-fill (dark) */
    attention: "#ffc46b",               /* mirrors --stall-attention-line (dark) */
    violation: "#ff8a80",               /* mirrors --stall-violation-line (dark) */
    special: "rgba(138,180,255,0.18)",
    unknown: "rgba(228,234,230,0.04)",
    outline: "#4c5850",
    selected: "#8ab4ff",
    heat: [
      "interpolate", ["linear"], ["heatmap-density"],
      0, "rgba(0,0,0,0)",
      0.3, "rgba(154,166,159,0.3)",
      0.6, "rgba(255,196,107,0.5)",
      1, "rgba(255,138,128,0.65)",
    ],
  },
};

const ATTENTION_MS = 10 * 60000; // occupied and inside 10 min of the limit

// Data-driven opacities: the active state filter DIMS non-matching stalls
// (never hides geometry). `dim` is a feature property set in spacesFC.
const FILL_OPACITY = ["case", ["==", ["get", "dim"], 1], 0.18, 0.8];
const LINE_OPACITY = ["case", ["==", ["get", "dim"], 1], 0.25, 1];

function statusColor(c, sp, st, snapshotTs) {
  const status = st ? st.status : "unknown";
  if (status === "violation") return c.violation;
  if (status === "occupied") {
    const s = st?.session;
    if (s?.overstayAt && snapshotTs != null && s.overstayAt - snapshotTs < ATTENTION_MS) return c.attention;
    return c.occupied;
  }
  if (status === "free") return sp.type !== "standard" ? c.special : c.free;
  return c.unknown;
}

function spacesFC(site, snapshot, selectedId, level, c, stateFilter) {
  const spaces = level == null ? site.spaces : site.spaces.filter((s) => s.level === level || s.level == null);
  return {
    type: "FeatureCollection",
    features: spaces.map((sp) => {
      const st = snapshot?.states.get(sp.id);
      const ph = st?.session ? sessionPhase(st.session, snapshot.ts) : null;
      return {
        type: "Feature",
        id: undefined,
        properties: {
          id: sp.id,
          color: statusColor(c, sp, st, snapshot?.ts),
          selected: sp.id === selectedId ? 1 : 0,
          dwell: st?.session ? Math.max(0, (snapshot.ts - st.session.start) / 60000) : 0,
          occupied: !st || st.status === "free" ? 0 : 1,
          lowconf: ph?.unverified ? 1 : 0, // uncertainty = dashed line treatment
          dim: matchesStallFilter(stateFilter, sp, st) ? 0 : 1,
        },
        geometry: { type: "Polygon", coordinates: [sp.poly] },
      };
    }),
  };
}

// Point per space whose session started/ends within the turnover window —
// rendered as a small static dot (GL layer; the schematic carries the pulse).
function turnoverFC(site, snapshot, level) {
  const spaces = level == null ? site.spaces : site.spaces.filter((s) => s.level === level || s.level == null);
  const features = [];
  for (const sp of spaces) {
    const st = snapshot?.states.get(sp.id);
    const ph = st?.session ? sessionPhase(st.session, snapshot.ts) : null;
    if (ph?.turning) {
      features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: sp.center } });
    }
  }
  return { type: "FeatureCollection", features };
}

export function MapView({ scope, snapshot, ts, heat, level, onSelectSpace, onDrill, stateFilter = "all" }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);
  // theme pinned at mount — GL constants + basemap style are canvas-side
  const glRef = useRef(null);
  if (glRef.current == null) glRef.current = isDarkTheme() ? GL.dark : GL.light;

  /* ---- init once ---- */
  useEffect(() => {
    const c = glRef.current;
    const map = new maplibregl.Map({
      container: box.current,
      style: c === GL.dark ? STYLE_DARK : STYLE_LIGHT,
      center: CITY_CENTER,
      zoom: 12,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("spaces", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("turnover", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "spaces-fill",
        type: "fill",
        source: "spaces",
        paint: { "fill-color": ["get", "color"], "fill-opacity": FILL_OPACITY },
      });
      map.addLayer({
        id: "spaces-line",
        type: "line",
        source: "spaces",
        // quiet stall outlines — mirrors --stall-line. GL constant.
        // Low-confidence sessions get the dashed layer below instead.
        filter: ["!=", ["get", "lowconf"], 1],
        paint: { "line-color": c.outline, "line-width": 0.6, "line-opacity": LINE_OPACITY },
      });
      map.addLayer({
        id: "spaces-lowconf",
        type: "line",
        source: "spaces",
        filter: ["==", ["get", "lowconf"], 1],
        // uncertainty = LINE treatment (dashed), same quiet outline hue —
        // never a new color. GL constant.
        paint: {
          "line-color": c.outline,
          "line-width": 1.3,
          "line-dasharray": [1.6, 1.3],
          "line-opacity": LINE_OPACITY,
        },
      });
      map.addLayer({
        id: "turnover-dots",
        type: "circle",
        source: "turnover",
        // quiet static dot: session starting/ending at the viewed time
        paint: { "circle-radius": 2.4, "circle-color": c.outline, "circle-opacity": 0.9 },
      });
      map.addLayer({
        id: "spaces-selected",
        type: "line",
        source: "spaces",
        filter: ["==", ["get", "selected"], 1],
        // blue = selected (ISA-101) — mirrors --stall-selected. GL constant.
        paint: { "line-color": c.selected, "line-width": 2.2 },
      });
      map.addLayer({
        id: "spaces-heat",
        type: "heatmap",
        source: "spaces",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["min", 1, ["/", ["get", "dwell"], 120]],
          "heatmap-radius": 26,
          "heatmap-intensity": 1.1,
          "heatmap-opacity": 0.85,
          // dwell ramp: quiet neutral → amber attention → red. Mirrors the
          // semantic tokens per theme. GL constant.
          "heatmap-color": c.heat,
        },
      });

      map.on("click", "spaces-fill", (e) => {
        const f = e.features?.[0];
        if (f) onSelectSpaceRef.current?.(f.properties.id);
      });
      map.on("mouseenter", "spaces-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "spaces-fill", () => (map.getCanvas().style.cursor = ""));

      readyRef.current = true;
      syncRef.current?.();
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  const onSelectSpaceRef = useRef(onSelectSpace);
  onSelectSpaceRef.current = onSelectSpace;
  const onDrillRef = useRef(onDrill);
  onDrillRef.current = onDrill;

  /* ---- markers (no camera movement) ---- */
  const refreshMarkers = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (scope === "portfolio") {
      for (const site of SITES) {
        const el = document.createElement("div");
        const occ = snapshot?.portfolio?.[site.id];
        const pct = occ != null ? Math.round(occ) : null;
        el.className = `site-marker ${pct >= 90 ? "danger" : pct >= 70 ? "warn" : ""}`;
        el.innerHTML = `<div class="ring">${pct != null ? pct + "%" : "…"}</div><div class="tag">${site.name}</div>`;
        el.addEventListener("click", () => onDrillRef.current?.(site.id));
        markersRef.current.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(site.center).addTo(map));
      }
    } else {
      const site = siteById[scope];
      if (!site) return;
      for (const cam of site.cameras) {
        const el = document.createElement("div");
        const health = cam.real ? null : cameraHealth(site.id, cam.id, ts);
        const offline = health ? !health.online : false;
        el.className = `cam-marker ${offline ? "offline" : ""}`;
        el.title = `${cam.name}${offline ? " — OFFLINE" : ""}`;
        const jitter = 0.00035;
        const idx = site.cameras.indexOf(cam);
        const pos = [
          site.center[0] + Math.cos((idx / site.cameras.length) * Math.PI * 2) * jitter * 2.2,
          site.center[1] + Math.sin((idx / site.cameras.length) * Math.PI * 2) * jitter * 1.6,
        ];
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(map));
      }
    }
  };

  /* ---- full sync: camera + markers (scope change / first load) ---- */
  const syncRef = useRef(null);
  syncRef.current = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (scope === "portfolio") {
      map.getSource("spaces")?.setData({ type: "FeatureCollection", features: [] });
      map.getSource("turnover")?.setData({ type: "FeatureCollection", features: [] });
      const bounds = new maplibregl.LngLatBounds();
      for (const site of SITES) bounds.extend(site.center);
      map.fitBounds(bounds, { padding: 90, duration: 700, maxZoom: 13 });
    } else {
      const site = siteById[scope];
      if (site) map.flyTo({ center: site.center, zoom: site.mapZoom, duration: 700 });
    }
    refreshMarkers();
  };

  useEffect(() => {
    syncRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  /* ---- live data (camera untouched) ---- */
  const refreshMarkersRef = useRef(refreshMarkers);
  refreshMarkersRef.current = refreshMarkers;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (scope === "portfolio") {
      refreshMarkersRef.current();
      return;
    }
    const site = siteById[scope];
    if (site && snapshot?.states) {
      map.getSource("spaces")?.setData(spacesFC(site, snapshot, snapshot.selectedId, level, glRef.current, stateFilter));
      map.getSource("turnover")?.setData(turnoverFC(site, snapshot, level));
    }
  }, [snapshot, scope, level, stateFilter]);

  /* ---- heat toggle ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const vis = heat ? "visible" : "none";
    if (map.getLayer("spaces-heat")) map.setLayoutProperty("spaces-heat", "visibility", vis);
    if (map.getLayer("spaces-fill")) map.setPaintProperty("spaces-fill", "fill-opacity", heat ? 0.25 : FILL_OPACITY);
  }, [heat]);

  return <div ref={box} style={{ position: "absolute", inset: 0 }} />;
}
