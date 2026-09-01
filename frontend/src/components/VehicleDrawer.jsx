// VehicleDrawer — persistent vehicle identity, made queryable.
//
// Mounted ONCE in Shell.jsx so a plate link on ANY page (twin, alerts,
// copilot) opens the same drawer. Opens when store.selectedPlate is a plate
// string; selectPlate(null) closes. Content is the plate's 48h session
// history from findPlate — every sighting across every site and zone, with
// per-session confidence from the sim. Esc closes the topmost drawer only
// (a capture-phase listener stops the event reaching drawers underneath).

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, twinTime } from "../store/useStore.js";
import { siteById } from "../sim/sites.js";
import { findPlate, sessionPhase, LOW_CONFIDENCE } from "../sim/engine.js";
import { fmtClock, fmtDateTime, fmtDuration, fmtAgo, fmtPct } from "../lib/format.js";
import { Drawer, Pill, Dot, Stat, EmptyState } from "./ui.jsx";

function SessionRow({ s, ts, isLast, onLocate }) {
  const ph = sessionPhase(s, ts);
  const active = ph.active;
  const overstay = (active ? ts : s.end) > s.overstayAt;
  const unauthorized = !s.permitOk;
  const unverified = s.confidence < LOW_CONFIDENCE;
  const site = siteById[s.siteId];
  const dwell = Math.max(0, Math.min(s.end, ts) - s.start);

  return (
    <div style={{ display: "flex", gap: 10 }}>
      {/* rail: status dot + connecting line */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
        <Dot tone={active ? (overstay || unauthorized ? "danger" : "ok") : undefined} pulse={active && !overstay && !unauthorized} />
        {!isLast && <div style={{ flex: 1, width: 1, background: "var(--border)", marginTop: 4 }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 14 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--fs-1)", fontWeight: 600 }} className="truncate">
            {site?.name || s.siteId}
          </span>
          <span className="spacer" />
          {active && !overstay && !unauthorized && <Pill tone="ok">active</Pill>}
          {overstay && <Pill tone="danger">overstay</Pill>}
          {unauthorized && <Pill tone="danger">no permit</Pill>}
          {!active && !overstay && !unauthorized && <Pill>departed</Pill>}
          {unverified && <Pill tone="warn">unverified</Pill>}
        </div>

        <div className="num" style={{ fontSize: "var(--fs-1)", color: "var(--ink-mid)", marginTop: 3 }}>
          {s.spaceLabel} · zone {s.zone}
          {s.level != null && ` · L${s.level}`}
        </div>

        <div className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginTop: 2 }}>
          {fmtDateTime(s.start)} → {active ? "now" : fmtClock(s.end)} · {fmtDuration(dwell)} ·{" "}
          <span style={unverified ? { color: "var(--warn)" } : undefined}>
            conf {fmtPct(s.confidence * 100)}
          </span>
        </div>

        {active && (
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => onLocate(s)}>
            Locate on twin
          </button>
        )}
      </div>
    </div>
  );
}

function VehicleDrawerBody({ plate }) {
  const ts = useStore(twinTime);
  const navigate = useNavigate();
  // 5s bucket: findPlate scans 48h of sessions across ALL sites — never
  // per-render, never per-second.
  const queryTs = Math.floor(ts / 5000) * 5000;

  // Deferred compute: first paint shows the skeleton, the scan runs on the
  // next frame. On a bucket tick the previous result stays up (no flicker).
  const [result, setResult] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      setResult({ plate, sessions: findPlate(plate, queryTs, { hours: 48 }) });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [plate, queryTs]);

  const loading = !result || result.plate !== plate;
  const sessions = loading ? [] : result.sessions;

  const close = () => useStore.getState().selectPlate(null);

  // Esc closes THIS drawer only: capture-phase listener runs before the
  // bubble listeners of any drawer underneath and stops the event there.
  // The command palette stays the exception — it sits on top.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (useStore.getState().paletteOpen) return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const summary = useMemo(() => {
    if (!sessions.length) return null;
    let dwell = 0;
    let conf = 0;
    const sites = new Set();
    for (const s of sessions) {
      dwell += Math.max(0, Math.min(s.end, queryTs) - s.start);
      conf += s.confidence;
      sites.add(s.siteId);
    }
    return { count: sessions.length, dwell, avgConf: conf / sessions.length, sites: sites.size };
  }, [sessions, queryTs]);

  const locate = (s) => {
    const st = useStore.getState();
    st.setScope(s.siteId);
    st.selectSpace(s.spaceId);
    st.selectPlate(null);
    navigate("/twin");
  };

  return (
    <Drawer
      title={
        <span className="num" style={{ fontSize: "var(--fs-5)", fontWeight: 600, letterSpacing: "0.02em" }}>
          {plate}
        </span>
      }
      meta="Vehicle · sessions across sites · last 48h"
      onClose={close}
    >
      {loading ? (
        <div style={{ display: "grid", gap: 10 }} aria-label="Loading vehicle history" role="status">
          <div className="skeleton" style={{ height: 44 }} />
          <div className="skeleton" style={{ height: 62 }} />
          <div className="skeleton" style={{ height: 62 }} />
          <div className="skeleton" style={{ height: 62 }} />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          title={`No sightings of ${plate}`}
          hint="No sessions matched this plate at any site in the last 48 hours."
        />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Stat label="Sessions" value={summary.count} sub="48h" />
            <Stat label="Total dwell" value={fmtDuration(summary.dwell)} />
            <Stat
              label="Avg confidence"
              value={fmtPct(summary.avgConf * 100)}
              tone={summary.avgConf < LOW_CONFIDENCE ? "warn" : undefined}
            />
            <Stat label="Sites visited" value={summary.sites} />
          </div>

          <div>
            <div style={{ fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--ink-muted)", marginBottom: 8 }}>
              Session history · newest first
            </div>
            <div>
              {sessions.map((s, i) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  ts={queryTs}
                  isLast={i === sessions.length - 1}
                  onLocate={locate}
                />
              ))}
            </div>
          </div>

          <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
            Latest arrival {fmtAgo(sessions[0].start, queryTs)} · confidence values come from
            per-session detections.
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function VehicleDrawer() {
  const plate = useStore((s) => s.selectedPlate);
  if (!plate) return null;
  return <VehicleDrawerBody plate={plate} />;
}
