// Interactive map twin (MapLibre + dark raster tiles).
//
// Portfolio scope: one marker per site (occupancy ring), click to drill.
// Site scope: every space as a GeoJSON polygon colored by live status,
// camera markers with health, optional dwell heat layer.

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../styles/map.css";
import { SITES, siteById, CITY_CENTER } from "../../sim/sites.js";
import { cameraHealth } from "../../sim/engine.js";
import { useStore } from "../../store/useStore.js";

// OpenFreeMap: free vector tiles, no API key. Dark style fits the room.
const STYLE = "https://tiles.openfreemap.org/styles/dark";

const STATUS_COLOR = {
  free: "#3ddc8f",
  occupied: "#8f3d33",
  violation: "#ef4f38",
  unknown: "#3a3f4a",
};

function spacesFC(site, snapshot, selectedId, level) {
  const spaces = level == null ? site.spaces : site.spaces.filter((s) => s.level === level || s.level == null);
  return {
    type: "FeatureCollection",
    features: spaces.map((sp) => {
      const st = snapshot?.states.get(sp.id);
      const status = st ? st.status : "unknown";
      return {
        type: "Feature",
        id: undefined,
        properties: {
          id: sp.id,
          color: sp.type !== "standard" && status === "free" ? "#4f8fd9" : STATUS_COLOR[status] || STATUS_COLOR.unknown,
          selected: sp.id === selectedId ? 1 : 0,
          dwell: st?.session ? Math.max(0, (snapshot.ts - st.session.start) / 60000) : 0,
          occupied: status === "free" ? 0 : 1,
        },
        geometry: { type: "Polygon", coordinates: [sp.poly] },
      };
    }),
  };
}

export function MapView({ scope, snapshot, ts, heat, level, onSelectSpace, onDrill }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);

  /* ---- init once ---- */
  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: CITY_CENTER,
      zoom: 12,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("spaces", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "spaces-fill",
        type: "fill",
        source: "spaces",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.72 },
      });
      map.addLayer({
        id: "spaces-line",
        type: "line",
        source: "spaces",
        paint: { "line-color": "#0a0c10", "line-width": 0.6 },
      });
      map.addLayer({
        id: "spaces-selected",
        type: "line",
        source: "spaces",
        filter: ["==", ["get", "selected"], 1],
        paint: { "line-color": "#ff6a4e", "line-width": 2.2 },
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
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.3, "rgba(61,120,90,0.55)",
            0.6, "rgba(210,160,60,0.6)",
            1, "rgba(239,79,56,0.75)",
          ],
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
      map.getSource("spaces")?.setData(spacesFC(site, snapshot, snapshot.selectedId, level));
    }
  }, [snapshot, scope, level]);

  /* ---- heat toggle ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const vis = heat ? "visible" : "none";
    if (map.getLayer("spaces-heat")) map.setLayoutProperty("spaces-heat", "visibility", vis);
    if (map.getLayer("spaces-fill")) map.setPaintProperty("spaces-fill", "fill-opacity", heat ? 0.25 : 0.72);
  }, [heat]);

  return <div ref={box} style={{ position: "absolute", inset: 0 }} />;
}
