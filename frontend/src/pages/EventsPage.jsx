// EventsPage — Events & Alerts triage. Scope-aware.
//
// Left: active alerts (ack / case actions) + filterable 6h event stream.
// Right: predicted issues + camera health. Drawers (event detail with
// session timeline, camera live view) render at page level from store.drawer.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, useTwinTime, scopedSites } from "../store/useStore.js";
import {
  activeAlerts,
  predictedIssues,
  siteEvents,
  cameraHealth,
  eventMeta,
  HOUR,
  MIN,
} from "../sim/engine.js";
import { siteById } from "../sim/sites.js";
import { Pill, Dot, EmptyState, Segmented, Drawer, Kbd, PlateButton, SEV_TONE } from "../components/ui.jsx";
import { fmtClock, fmtAgo, fmtDuration, fmtDateTime, fmtPct } from "../lib/format.js";
import { alertVerb, alertNoun } from "../lib/alarms.js";
import { mjpegUrl } from "../lib/api.js";

/* ================= constants ================= */

const KIND_SETS = {
  violations: new Set(["overstay", "unauthorized", "double_park"]),
  flow: new Set(["arrival", "departure"]),
  cameras: new Set(["camera_offline", "camera_online"]),
};

const KIND_OPTIONS = [
  { value: "all", label: "All" },
  { value: "violations", label: "Violations" },
  { value: "flow", label: "Flow" },
  { value: "cameras", label: "Cameras" },
];

const PRED_LABEL = {
  zone_full: "Zone full risk",
  overstay_pressure: "Overstay pressure",
  charger_contention: "EV charger contention",
};

const EVENT_RENDER_CAP = 150;

// eventMeta doesn't know alert-only kinds; keep labels readable.
function kindLabel(kind) {
  if (kind === "charger_contention") return "EV charger contention";
  return eventMeta(kind).label;
}

/* ================= small pieces ================= */

function DetailRow({ label, value, num = false }) {
  return (
    <div
      className="row"
      style={{
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)", flexShrink: 0 }}>
        {label}
      </span>
      <span className={`truncate ${num ? "num" : ""}`} style={{ fontSize: "var(--fs-1)" }}>
        {value}
      </span>
    </div>
  );
}

// Mini session timeline: arrival → limit → now, simple divs on a track.
function SessionTimeline({ session, ts }) {
  const start = session.start;
  const end = Math.max(ts, session.overstayAt);
  const span = Math.max(1, end - start);
  const pct = (t) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const nowPct = pct(Math.min(ts, end));
  const limitPct = pct(session.overstayAt);
  const over = ts > session.overstayAt;

  return (
    <div>
      <div
        style={{
          fontSize: "var(--fs-0)",
          fontWeight: 600,
          color: "var(--ink-muted)",
          marginBottom: 6,
        }}
      >
        Session timeline
      </div>
      <div style={{ position: "relative", height: 24 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 9,
            height: 6,
            borderRadius: 3,
            background: "var(--surface-2)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 9,
            height: 6,
            borderRadius: 3,
            width: `${Math.min(nowPct, limitPct)}%`,
            background: "var(--ok)",
            opacity: 0.75,
          }}
        />
        {over && (
          <div
            style={{
              position: "absolute",
              left: `${limitPct}%`,
              top: 9,
              height: 6,
              width: `${Math.max(0, nowPct - limitPct)}%`,
              borderRadius: "0 3px 3px 0",
              background: "var(--danger)",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: `${limitPct}%`,
            top: 5,
            width: 2,
            height: 14,
            borderRadius: 1,
            background: "var(--warn)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${nowPct}%`,
            top: 3,
            width: 2,
            height: 18,
            borderRadius: 1,
            background: "var(--ink)",
          }}
        />
      </div>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          fontSize: "var(--fs-0)",
          color: "var(--ink-muted)",
          marginTop: 2,
        }}
      >
        <span className="num">arrived {fmtClock(start)}</span>
        <span className="num" style={{ color: "var(--warn)" }}>
          limit {fmtClock(session.overstayAt)}
        </span>
        <span className="num">now {fmtClock(ts)}</span>
      </div>
    </div>
  );
}

/* ================= drawers ================= */

function EventDrawer({ event, ts, onClose, onCreateCase, onViewTwin }) {
  const meta = eventMeta(event.kind);
  const site = siteById[event.siteId];
  const s = event.session;
  const dwellMs = s ? Math.max(0, Math.min(ts, s.end) - s.start) : null;

  return (
    <Drawer
      title={meta.label}
      meta={`${site?.name || event.siteId} · ${fmtDateTime(event.ts)}`}
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" onClick={onCreateCase}>
            Create case
          </button>
          <button className="btn" onClick={onViewTwin}>
            View on twin
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div className="row" style={{ gap: 8 }}>
          <Pill tone={SEV_TONE[meta.sev]}>{meta.label}</Pill>
          {event.zone && <Pill>{event.zone}</Pill>}
          {s?.real && <Pill tone="accent">LIVE</Pill>}
        </div>

        {s ? (
          <>
            <div>
              <div
                style={{
                  fontSize: "var(--fs-0)",
                  fontWeight: 600,
                  color: "var(--ink-muted)",
                  marginBottom: 4,
                }}
              >
                Session
              </div>
              <DetailRow label="Plate" value={<PlateButton plate={s.plate} />} num />
              <DetailRow label="Vehicle" value={s.vehicleClass} />
              <DetailRow label="Confidence" value={fmtPct(s.confidence * 100)} num />
              <DetailRow label="Arrived" value={fmtClock(s.start)} num />
              <DetailRow label="Limit" value={fmtDuration(s.limitMin * MIN)} num />
              <DetailRow label="Overstay at" value={fmtClock(s.overstayAt)} num />
              <DetailRow label="Dwell so far" value={fmtDuration(dwellMs)} num />
              <DetailRow label="Zone / space" value={`${s.zone} · ${s.spaceLabel}`} num />
            </div>
            <SessionTimeline session={s} ts={ts} />
          </>
        ) : (
          <div>
            <div
              style={{
                fontSize: "var(--fs-0)",
                fontWeight: 600,
                color: "var(--ink-muted)",
                marginBottom: 4,
              }}
            >
              Details
            </div>
            <DetailRow label="Time" value={fmtDateTime(event.ts)} num />
            <DetailRow label="Site" value={site?.name || event.siteId} />
            {event.cameraName && <DetailRow label="Camera" value={event.cameraName} />}
            {event.spaceLabel && <DetailRow label="Space" value={event.spaceLabel} num />}
            {event.plate && <DetailRow label="Plate" value={<PlateButton plate={event.plate} />} num />}
            {event.durationMs != null && (
              <DetailRow label="Duration" value={fmtDuration(event.durationMs)} num />
            )}
            {event.occupancy != null && (
              <DetailRow label="Occupancy" value={fmtPct(event.occupancy)} num />
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function CameraDrawer({ drawer, ts, backendUp, realSummary, onClose }) {
  const [streamError, setStreamError] = useState(false);
  const cameraId = drawer.cameraId || "cam1";
  const isReal = drawer.real ?? cameraId === "cam1";
  const site = drawer.siteId ? siteById[drawer.siteId] : siteById["sample-lot"];
  const realOnline = backendUp && realSummary?.status === "connected";
  const health = !isReal && drawer.siteId ? cameraHealth(drawer.siteId, cameraId, ts) : null;

  return (
    <Drawer
      title={drawer.name || cameraId}
      meta={site ? site.name : undefined}
      onClose={onClose}
    >
      {isReal ? (
        <div style={{ display: "grid", gap: 10 }}>
          {streamError ? (
            <EmptyState
              title="Stream unavailable"
              hint="The MJPEG stream could not be loaded from the backend."
            />
          ) : (
            <div className="evidence">
              <img
                src={mjpegUrl("cam1")}
                alt="cam1 live stream"
                onError={() => setStreamError(true)}
                style={{ minHeight: 120 }}
              />
              <div className="evidence-meta">
                <span>CAM1</span>
                <span className="spacer" />
                <span>{site?.name || "Sample Lot 1"}</span>
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <Dot tone={realOnline ? "ok" : "danger"} pulse={realOnline} />
            <span style={{ fontSize: "var(--fs-1)" }}>
              {realOnline
                ? "Live — backend connected"
                : backendUp
                  ? `Backend status: ${realSummary?.status || "no summary"}`
                  : "Backend offline — no live frames"}
            </span>
          </div>
        </div>
      ) : (
        <EmptyState
          title="Simulated camera — no live feed"
          hint={
            health
              ? health.online
                ? `Health at cursor: ${health.fps} fps · ${health.latencyMs} ms`
                : `Offline since ${fmtClock(health.since)} — expected back ${fmtClock(health.until)}`
              : "No health data at cursor."
          }
        />
      )}
    </Drawer>
  );
}

/* ================= page ================= */

export default function EventsPage() {
  const ts = useTwinTime();
  const scope = useStore((s) => s.scope);
  // scopedSites returns a fresh array for site scopes — as a zustand selector
  // that is an unstable snapshot (infinite re-render); derive it instead.
  const sites = useMemo(() => scopedSites({ scope }), [scope]);
  const realSummary = useStore((s) => s.realSummary);
  const backendUp = useStore((s) => s.backendUp);
  const ackAlerts = useStore((s) => s.ackAlerts);
  const drawer = useStore((s) => s.drawer);
  const openDrawer = useStore((s) => s.openDrawer);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const ackAlert = useStore((s) => s.ackAlert);
  const addToast = useStore((s) => s.addToast);
  const createCase = useStore((s) => s.createCase);
  const setScope = useStore((s) => s.setScope);
  const navigate = useNavigate();

  const [kindFilter, setKindFilter] = useState("all");
  const [zone, setZone] = useState("all");
  const [search, setSearch] = useState("");
  const [hoverAlert, setHoverAlert] = useState(null);
  const [hoverPred, setHoverPred] = useState(null);
  const [hoverCam, setHoverCam] = useState(null);

  /* ---- alert triage keyboard: j/k focus, a ack, Enter open ---- */
  const [focusIdx, setFocusIdx] = useState(-1);
  const focusIdxRef = useRef(-1);
  const focusRowRef = useRef(null);
  const groupsRef = useRef([]);
  const setFocus = (i) => {
    focusIdxRef.current = i;
    setFocusIdx(i);
  };

  const singleSite = sites.length === 1 ? sites[0] : null;
  const siteKey = sites.map((s) => s.id).join("|");

  useEffect(() => {
    setZone("all");
  }, [scope]);

  /* ---- active alerts (30s bucket) ---- */
  const alertTs = Math.floor(ts / 30000) * 30000;
  const alerts = useMemo(
    () => activeAlerts(alertTs, sites.map((s) => s.id), realSummary),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alertTs, siteKey, realSummary],
  );
  const visibleAlerts = useMemo(
    () => alerts.filter((a) => !ackAlerts.has(a.id)),
    [alerts, ackAlerts],
  );
  const dangerCount = visibleAlerts.filter((a) => a.sev === "danger").length;
  const warnCount = visibleAlerts.filter((a) => a.sev === "warn").length;

  /* ---- alarm doctrine: roll up repeats (site × kind), rank by tier ---- */
  const SEV_RANK = { danger: 0, warn: 1, info: 2 };
  const alertGroups = useMemo(() => {
    const map = new Map();
    for (const a of visibleAlerts) {
      const key = `${a.siteId}:${a.kind}`;
      const g = map.get(key);
      if (!g) {
        map.set(key, { key, alerts: [a], top: a });
      } else {
        g.alerts.push(a);
        const better =
          (SEV_RANK[a.sev] ?? 3) < (SEV_RANK[g.top.sev] ?? 3) ||
          ((SEV_RANK[a.sev] ?? 3) === (SEV_RANK[g.top.sev] ?? 3) && a.since > g.top.since);
        if (better) g.top = a;
      }
    }
    return [...map.values()].sort(
      (x, y) =>
        (SEV_RANK[x.top.sev] ?? 3) - (SEV_RANK[y.top.sev] ?? 3) ||
        y.top.since - x.top.since,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAlerts]);

  /* ---- event stream: last 6h, bucketed by minute ---- */
  const evTo = Math.floor(ts / MIN) * MIN;
  const events = useMemo(() => {
    const from = evTo - 6 * HOUR;
    const all = [];
    for (const site of sites) {
      all.push(...siteEvents(site.id, from, evTo, { includeFlow: true, limit: 400 }));
    }
    all.sort((a, b) => b.ts - a.ts);
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evTo, siteKey]);

  const filteredEvents = useMemo(() => {
    let out = events;
    if (kindFilter !== "all") out = out.filter((e) => KIND_SETS[kindFilter].has(e.kind));
    if (zone !== "all") out = out.filter((e) => e.zone === zone);
    const q = search.trim().toUpperCase();
    if (q) {
      out = out.filter(
        (e) =>
          (e.plate && e.plate.toUpperCase().includes(q)) ||
          (e.spaceLabel && e.spaceLabel.toUpperCase().includes(q)) ||
          (e.cameraName && e.cameraName.toUpperCase().includes(q)) ||
          (e.zone && String(e.zone).toUpperCase().includes(q)) ||
          eventMeta(e.kind).label.toUpperCase().includes(q),
      );
    }
    return out;
  }, [events, kindFilter, zone, search]);

  /* ---- predicted issues (60s bucket) ---- */
  const predTs = Math.floor(ts / 60000) * 60000;
  const predictions = useMemo(
    () => predictedIssues(predTs, sites.map((s) => s.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [predTs, siteKey],
  );

  /* ---- camera health (30s bucket) ---- */
  const camTs = Math.floor(ts / 30000) * 30000;
  const cameras = useMemo(() => {
    const out = [];
    for (const site of sites) {
      for (const cam of site.cameras) {
        out.push({
          site,
          cam,
          real: !!cam.real,
          health: cam.real ? null : cameraHealth(site.id, cam.id, camTs),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camTs, siteKey]);
  const realOnline = backendUp && realSummary?.status === "connected";

  /* ---- actions ---- */

  const handleAlertCase = (a) => {
    createCase({
      plate: a.plate,
      siteId: a.siteId,
      spaceId: a.spaceId,
      spaceLabel: a.spaceLabel,
      kind: a.kind,
      detail: a.detail,
      sev: a.sev,
    });
    addToast("Case created");
  };

  const handleEventCase = (e) => {
    const meta = eventMeta(e.kind);
    createCase({
      plate: e.plate || e.session?.plate,
      siteId: e.siteId,
      spaceId: e.spaceId,
      spaceLabel: e.spaceLabel,
      kind: e.kind,
      detail: `${meta.label}${e.spaceLabel ? ` at ${e.spaceLabel}` : ""} — ${fmtDateTime(e.ts)}`,
      sev: meta.sev,
    });
    addToast("Case created");
  };

  const handleViewTwin = (e) => {
    setScope(e.siteId);
    navigate("/twin");
  };

  // Enter on a focused alert opens the related entity: vehicle drawer for a
  // plate, twin locate for a space, camera drawer for a camera, site twin
  // otherwise. Ref-mirrored so the window listener stays dependency-free.
  const openEntity = (a) => {
    const store = useStore.getState();
    if (a.plate) {
      store.selectPlate?.(a.plate);
    } else if (a.spaceId) {
      setScope(a.siteId);
      store.selectSpace(a.spaceId);
      navigate("/twin");
    } else if (a.cameraId) {
      // Resolve `real` from the site model — camera_offline alerts fire for
      // the REAL camera too, and hardcoding false would render its drawer in
      // simulated mode with fabricated sim health.
      const real = !!siteById[a.siteId]?.cameras.find((c) => c.id === a.cameraId)?.real;
      openDrawer({ type: "camera", cameraId: a.cameraId, siteId: a.siteId, name: a.cameraName, real });
    } else if (a.siteId) {
      setScope(a.siteId);
      navigate("/twin");
    }
  };
  const openEntityRef = useRef(openEntity);
  openEntityRef.current = openEntity;

  useEffect(() => {
    groupsRef.current = alertGroups;
    if (focusIdxRef.current >= alertGroups.length) setFocus(alertGroups.length - 1);
  }, [alertGroups]);

  useEffect(() => {
    focusRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusIdx]);

  useEffect(() => {
    const gTs = { current: 0 };
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const store = useStore.getState();
      // keep hands off while an overlay is up
      if (store.paletteOpen || store.drawer || store.selectedPlate) return;
      if (e.key === "g") {
        // the shell's g-chord (g a → Analytics, …) starts here — remember it
        gTs.current = Date.now();
        return;
      }
      const groups = groupsRef.current;
      if (e.key === "j" || e.key === "k") {
        if (!groups.length) return;
        e.preventDefault();
        const i = focusIdxRef.current;
        setFocus(e.key === "j" ? Math.min(i + 1, groups.length - 1) : Math.max(i - 1, 0));
        return;
      }
      if (e.key === "a") {
        if (Date.now() - gTs.current < 900) return; // don't fight g-a
        const g = groups[focusIdxRef.current];
        if (!g) return;
        g.alerts.forEach((x) => store.ackAlert(x.id));
        store.addToast(g.alerts.length > 1 ? `${g.alerts.length} alerts acknowledged` : "Alert acknowledged");
        return;
      }
      if (e.key === "Enter") {
        if (tag === "BUTTON") return; // a focused button keeps its Enter
        const g = groups[focusIdxRef.current];
        if (g) openEntityRef.current(g.top);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shownEvents = filteredEvents.slice(0, EVENT_RENDER_CAP);
  const showSiteCol = !singleSite;

  return (
    <div
      style={{
        padding: 16,
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
        gap: 12,
        alignItems: "start",
      }}
    >
      {/* ================= LEFT ================= */}
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        {/* ---- Active alerts ---- */}
        <section className="panel">
          <header className="panel-head">
            <span className="panel-title">Active alerts</span>
            {dangerCount > 0 && <Pill tone="danger">{dangerCount} critical</Pill>}
            {warnCount > 0 && <Pill tone="warn">{warnCount} warning</Pill>}
            <div className="spacer" />
            <span
              className="row"
              aria-hidden="true"
              style={{ gap: 4, fontSize: "var(--fs-0)", color: "var(--ink-faint)", whiteSpace: "nowrap" }}
            >
              <Kbd>j</Kbd>
              <Kbd>k</Kbd> move <Kbd>a</Kbd> ack <Kbd>↵</Kbd> open
            </span>
            <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
              {visibleAlerts.length}
            </span>
          </header>
          <div className="panel-body flush">
            {alertGroups.length === 0 ? (
              <EmptyState title="All clear" hint="No active alerts across scoped sites." />
            ) : (
              <ul className="scroll" style={{ maxHeight: 340 }}>
                {alertGroups.map((g, gi) => {
                  const a = g.top;
                  const n = g.alerts.length;
                  const hovered = hoverAlert === g.key;
                  const focused = gi === focusIdx;
                  const critical = a.sev === "danger";
                  return (
                    <li
                      key={g.key}
                      ref={focused ? focusRowRef : undefined}
                      onMouseEnter={() => setHoverAlert(g.key)}
                      onMouseLeave={() => setHoverAlert(null)}
                      onFocus={() => setHoverAlert(g.key)}
                      onBlur={() => setHoverAlert(null)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: critical ? "11px 14px" : "9px 14px",
                        borderBottom: "1px solid var(--border)",
                        background: hovered || focused ? "var(--bg-2)" : "transparent",
                        boxShadow: focused ? "inset 2px 0 0 var(--focus)" : "none",
                        transition: "background var(--t-fast)",
                      }}
                    >
                      <Pill tone={SEV_TONE[a.sev]}>{critical ? "CRIT" : a.sev === "warn" ? "WARN" : "INFO"}</Pill>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span
                            style={{
                              fontSize: critical ? "var(--fs-2)" : "var(--fs-1)",
                              fontWeight: 600,
                            }}
                          >
                            {alertVerb(a.kind)}
                          </span>
                          <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
                            {alertNoun(a.kind)} · {siteById[a.siteId]?.name}
                          </span>
                          {a.plate && (
                            <PlateButton plate={a.plate} style={{ fontSize: "var(--fs-0)" }} />
                          )}
                          {n > 1 && (
                            <span
                              className="num"
                              title={`${n} active alerts of this kind at this site`}
                              style={{ fontSize: "var(--fs-0)", color: "var(--ink-mid)", fontWeight: 600 }}
                            >
                              ×{n}
                            </span>
                          )}
                        </div>
                        <div
                          className="truncate"
                          title={a.detail}
                          style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}
                        >
                          {a.detail}
                        </div>
                      </div>
                      <span
                        className="num"
                        style={{
                          fontSize: "var(--fs-0)",
                          color: "var(--ink-faint)",
                          flexShrink: 0,
                        }}
                      >
                        {n > 1 ? `latest ${fmtAgo(g.alerts.reduce((m, x) => Math.max(m, x.since), 0), ts)}` : fmtAgo(a.since, ts)}
                      </span>
                      <div
                        className="row"
                        style={{
                          gap: 6,
                          flexShrink: 0,
                          opacity: hovered || focused ? 1 : 0,
                          pointerEvents: hovered || focused ? "auto" : "none",
                          transition: "opacity var(--t-fast)",
                        }}
                      >
                        <button
                          className="btn sm"
                          title={n > 1 ? `Acknowledge all ${n}` : "Acknowledge"}
                          onClick={() => {
                            g.alerts.forEach((x) => ackAlert(x.id));
                            addToast(n > 1 ? `${n} alerts acknowledged` : "Alert acknowledged");
                          }}
                        >
                          Ack{n > 1 ? ` ×${n}` : ""}
                        </button>
                        <button className="btn sm" onClick={() => handleAlertCase(a)}>
                          Case
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ---- Event stream ---- */}
        <section className="panel">
          <header className="panel-head">
            <span className="panel-title">Activity log</span>
            <Pill>last 6h</Pill>
            <div className="spacer" />
            <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
              {filteredEvents.length} events
            </span>
          </header>
          <div className="panel-body flush">
            <div
              className="row"
              style={{
                gap: 8,
                padding: "10px 14px",
                borderBottom: "1px solid var(--line)",
                flexWrap: "wrap",
              }}
            >
              <Segmented options={KIND_OPTIONS} value={kindFilter} onChange={setKindFilter} />
              {singleSite && (
                <div className="select-wrap">
                  <select
                    className="select"
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    aria-label="Zone filter"
                  >
                    <option value="all">All zones</option>
                    {singleSite.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <input
                className="input"
                style={{ flex: 1, minWidth: 140 }}
                placeholder="Search plate, space, camera…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search events"
              />
            </div>
            {shownEvents.length === 0 ? (
              <EmptyState
                title="No events match"
                hint="Adjust the kind filter, zone, or search query."
              />
            ) : (
              <div className="scroll" style={{ maxHeight: 480 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Event</th>
                      {showSiteCol && <th>Site</th>}
                      <th>Space / camera</th>
                      <th>Plate</th>
                      <th>Zone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownEvents.map((e) => {
                      const meta = eventMeta(e.kind);
                      const selected = drawer?.type === "event" && drawer.event?.id === e.id;
                      return (
                        <tr
                          key={e.id}
                          className={`clickable ${selected ? "selected" : ""}`}
                          onClick={() => openDrawer({ type: "event", event: e })}
                        >
                          <td className="num">{fmtClock(e.ts)}</td>
                          <td>
                            {/* firehose stays quiet — never alert-chip styling */}
                            <span className="row" style={{ gap: 6 }}>
                              <span className="dot" style={meta.sev === "danger" ? { background: "var(--danger)" } : undefined} />
                              <span style={{ color: "var(--ink-mid)" }}>{meta.label}</span>
                            </span>
                          </td>
                          {showSiteCol && <td>{siteById[e.siteId]?.name}</td>}
                          <td className="num">{e.spaceLabel || e.cameraName || "—"}</td>
                          <td className="num">{e.plate ? <PlateButton plate={e.plate} /> : "—"}</td>
                          <td>{e.zone || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredEvents.length > EVENT_RENDER_CAP && (
                  <div
                    style={{
                      padding: "8px 14px",
                      fontSize: "var(--fs-0)",
                      color: "var(--ink-faint)",
                    }}
                  >
                    Showing first {EVENT_RENDER_CAP} of {filteredEvents.length} events — narrow
                    the filters to see the rest.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ================= RIGHT ================= */}
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        {/* ---- Predicted issues ---- */}
        <section className="panel">
          <header className="panel-head">
            <span className="panel-title">Predicted issues</span>
            <div className="spacer" />
            <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
              {predictions.length}
            </span>
          </header>
          <div className="panel-body flush">
            {predictions.length === 0 ? (
              <EmptyState title="No predicted problems in the next hours" />
            ) : (
              <ul className="scroll" style={{ maxHeight: 280 }}>
                {predictions.map((p) => (
                  <li
                    key={p.id}
                    onMouseEnter={() => setHoverPred(p.id)}
                    onMouseLeave={() => setHoverPred(null)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 14px",
                      borderBottom: "1px solid var(--line)",
                      background: hoverPred === p.id ? "var(--surface-2)" : "transparent",
                      transition: "background var(--t-fast)",
                    }}
                  >
                    <Dot tone={SEV_TONE[p.sev]} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "var(--fs-1)", fontWeight: 600 }}>
                        {PRED_LABEL[p.kind] || kindLabel(p.kind)}
                      </div>
                      <div
                        className="truncate"
                        title={p.detail}
                        style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}
                      >
                        {p.detail}
                      </div>
                    </div>
                    <span
                      className="num"
                      style={{ fontSize: "var(--fs-0)", color: "var(--ink-mid)", flexShrink: 0 }}
                    >
                      {fmtClock(p.eta)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ---- Camera health ---- */}
        <section className="panel">
          <header className="panel-head">
            <span className="panel-title">Camera health</span>
            <div className="spacer" />
            <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
              {cameras.length}
            </span>
          </header>
          <div className="panel-body flush">
            {cameras.length === 0 ? (
              <EmptyState title="No cameras" hint="No cameras registered for scoped sites." />
            ) : (
              <ul className="scroll" style={{ maxHeight: 340 }}>
                {cameras.map(({ site, cam, real, health }) => {
                  const online = real ? realOnline : health?.online;
                  const selected = drawer?.type === "camera" && drawer.cameraId === cam.id;
                  const hovered = hoverCam === cam.id;
                  return (
                    <li
                      key={cam.id}
                      onMouseEnter={() => setHoverCam(cam.id)}
                      onMouseLeave={() => setHoverCam(null)}
                      onClick={() =>
                        openDrawer({
                          type: "camera",
                          cameraId: cam.id,
                          siteId: site.id,
                          name: cam.name,
                          real,
                        })
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 14px",
                        borderBottom: "1px solid var(--line)",
                        cursor: "pointer",
                        background: selected
                          ? "var(--accent-dim)"
                          : hovered
                            ? "var(--surface-2)"
                            : "transparent",
                        transition: "background var(--t-fast)",
                      }}
                    >
                      <Dot tone={online ? "ok" : "danger"} pulse={real && online} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span
                            className="truncate"
                            style={{ fontSize: "var(--fs-1)", fontWeight: 600 }}
                          >
                            {cam.name}
                          </span>
                          {real && <Pill tone="accent">LIVE</Pill>}
                        </div>
                        <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
                          {site.name}
                        </div>
                      </div>
                      <span
                        className="num"
                        style={{
                          fontSize: "var(--fs-0)",
                          flexShrink: 0,
                          color: online ? "var(--ink-mid)" : "var(--danger)",
                        }}
                      >
                        {real
                          ? online
                            ? "connected"
                            : backendUp
                              ? realSummary?.status || "no summary"
                              : "backend down"
                          : online
                            ? `${health.fps} fps · ${health.latencyMs} ms`
                            : "offline"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ================= drawers ================= */}
      {drawer?.type === "event" && drawer.event && (
        <EventDrawer
          event={drawer.event}
          ts={ts}
          onClose={closeDrawer}
          onCreateCase={() => handleEventCase(drawer.event)}
          onViewTwin={() => handleViewTwin(drawer.event)}
        />
      )}
      {drawer?.type === "camera" && (
        <CameraDrawer
          drawer={drawer}
          ts={ts}
          backendUp={backendUp}
          realSummary={realSummary}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
