// Live Twin — the main screen. Map or schematic projection of every space,
// right rail of situational awareness, bottom time scrubber for replay.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, twinTime } from "../store/useStore.js";
import { SITES, siteById, KIND_LABEL } from "../sim/sites.js";
import {
  siteSnapshot,
  siteFlow,
  activeAlerts,
  predictedIssues,
  siteSessions,
  cameraHealth,
  siteRevenueToday,
  MIN,
  HOUR,
} from "../sim/engine.js";
import { fmtDuration, fmtClock, fmtAgo, fmtMoney, fmtPct } from "../lib/format.js";
import { mjpegUrl } from "../lib/api.js";
import { Stat, Pill, Dot, Segmented, Drawer, EmptyState } from "../components/ui.jsx";
import { Bars } from "../components/charts.jsx";
import { MapView } from "../components/twin/MapView.jsx";
import { SchematicView } from "../components/twin/SchematicView.jsx";
import { TimeScrubber } from "../components/twin/TimeScrubber.jsx";
import { fetchSlots } from "../lib/api.js";
import { useAskCopilot } from "../components/CopilotPanel.jsx";

/* ================= right rail panels ================= */

function RailPanel({ title, extra, children }) {
  return (
    <section className="panel" style={{ borderRadius: "var(--r-3)" }}>
      <div className="panel-head" style={{ padding: "7px 11px" }}>
        <span className="panel-title">{title}</span>
        <div className="spacer" />
        {extra}
      </div>
      <div className="panel-body" style={{ padding: 11 }}>{children}</div>
    </section>
  );
}

function LiveCamera() {
  const backendUp = useStore((s) => s.backendUp);
  const [err, setErr] = useState(false);
  if (!backendUp || err) {
    return (
      <div className="empty" style={{ padding: "18px 8px" }}>
        <strong>No live feed</strong>
        <span>{backendUp ? "Stream unavailable" : "Backend offline"}</span>
      </div>
    );
  }
  return (
    <img
      src={mjpegUrl("cam1")}
      alt="cam1 live detection stream"
      onError={() => setErr(true)}
      style={{ width: "100%", borderRadius: "var(--r-2)", border: "1px solid var(--line)", display: "block" }}
    />
  );
}

function AlertsRail({ alerts, onLocate }) {
  const ackAlert = useStore((s) => s.ackAlert);
  const ack = useStore((s) => s.ackAlerts);
  const createCase = useStore((s) => s.createCase);
  const addToast = useStore((s) => s.addToast);
  const visible = alerts.filter((a) => !ack.has(a.id)).slice(0, 6);
  if (!visible.length) return <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)" }}>All clear.</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {visible.map((a) => (
        <div key={a.id} style={{ display: "grid", gap: 3 }}>
          <div className="row" style={{ gap: 6 }}>
            <Dot tone={a.sev === "danger" ? "danger" : "warn"} />
            <span style={{ fontSize: "var(--fs-1)", fontWeight: 600 }}>
              {a.kind.replace(/_/g, " ")}
            </span>
            <span className="spacer" />
            <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>{fmtAgo(a.since)}</span>
          </div>
          <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", paddingLeft: 13 }} className="truncate">
            {a.detail}
          </div>
          <div className="row" style={{ paddingLeft: 13, gap: 4 }}>
            {a.spaceId && (
              <button className="btn ghost sm" style={{ fontSize: 10 }} onClick={() => onLocate(a)}>
                Locate
              </button>
            )}
            <button
              className="btn ghost sm"
              style={{ fontSize: 10 }}
              onClick={() => {
                createCase({ plate: a.plate, siteId: a.siteId, spaceId: a.spaceId, spaceLabel: a.spaceLabel, kind: a.kind, detail: a.detail, sev: a.sev });
                addToast("Case created");
              }}
            >
              Case
            </button>
            <button className="btn ghost sm" style={{ fontSize: 10 }} onClick={() => ackAlert(a.id)}>
              Ack
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================= space drawer ================= */

function SpaceDrawer({ scope, ts }) {
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const selectSpace = useStore((s) => s.selectSpace);
  const realOccupancy = useStore((s) => s.realOccupancy);
  const createCase = useStore((s) => s.createCase);
  const addToast = useStore((s) => s.addToast);
  const setCopilotOpen = useStore((s) => s.setCopilotOpen);
  const ask = useAskCopilot();

  const site = siteById[scope];

  const info = useMemo(() => {
    if (!selectedSpaceId || !site) return null;
    if (selectedSpaceId.startsWith("real:")) {
      const slotId = selectedSpaceId.slice(5);
      return { real: true, slotId, occupied: realOccupancy?.get(slotId) };
    }
    const space = site.spaces.find((s) => s.id === selectedSpaceId);
    if (!space) return null;
    const snap = siteSnapshot(scope, ts);
    const st = snap.states.get(space.id);
    const history = siteSessions(scope, ts - 24 * HOUR, ts, { limit: 2000 }).filter((s) => s.spaceId === space.id).slice(0, 5);
    return { space, st, history };
  }, [selectedSpaceId, scope, Math.floor(ts / 5000), realOccupancy, site]);

  if (!info) return null;

  if (info.real) {
    return (
      <Drawer title={`Space ${info.slotId}`} meta="Sample Lot 1 · live camera detection" onClose={() => selectSpace(null)}>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="row">
            <Pill tone={info.occupied ? "danger" : "ok"}>{info.occupied ? "OCCUPIED" : "FREE"}</Pill>
            <Pill>real detection</Pill>
          </div>
          <p style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)", lineHeight: 1.6 }}>
            This space is tracked by the live YOLOv8 pipeline on cam1. State comes from vote-smoothed
            oriented-box detections mapped onto this space's calibrated polygon.
          </p>
          <LiveCamera />
        </div>
      </Drawer>
    );
  }

  const { space, st, history } = info;
  const s = st?.session;
  const dwell = s ? ts - s.start : 0;
  const limitMs = s ? s.limitMin * MIN : 0;
  const overFrac = s ? Math.min(1, dwell / limitMs) : 0;

  return (
    <Drawer
      title={`Space ${space.label}`}
      meta={`${site.name} · zone ${space.zone}${space.level ? ` · level ${space.level}` : ""} · ${space.type}`}
      onClose={() => selectSpace(null)}
      footer={
        st?.status === "violation" && (
          <button
            className="btn danger"
            style={{ width: "100%" }}
            onClick={() => {
              createCase({ plate: s?.plate, siteId: scope, spaceId: space.id, spaceLabel: space.label, kind: st.overstay ? "overstay" : "unauthorized", detail: `Space ${space.label} — ${st.overstay ? "overstay" : "no permit"}`, sev: "danger" });
              addToast("Enforcement case created");
            }}
          >
            Create enforcement case
          </button>
        )
      }
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div className="row">
          <Pill tone={st?.status === "free" ? "ok" : st?.status === "violation" ? "danger" : undefined}>
            {(st?.status || "unknown").toUpperCase()}
          </Pill>
          {st?.overstay && <Pill tone="danger">overstay</Pill>}
          {st?.unauthorized && <Pill tone="danger">no permit</Pill>}
        </div>

        {s ? (
          <>
            <div className="row" style={{ gap: 24 }}>
              <Stat label="Plate" value={<span className="num">{s.plate}</span>} />
              <Stat label="Vehicle" value={s.vehicleClass} />
              <Stat label="Confidence" value={fmtPct(s.confidence * 100)} />
            </div>
            <div className="row" style={{ gap: 24 }}>
              <Stat label="Arrived" value={fmtClock(s.start)} />
              <Stat label="Dwell" value={fmtDuration(dwell)} />
              <Stat label="Limit" value={fmtDuration(limitMs)} />
            </div>
            <div>
              <div className="row" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginBottom: 4 }}>
                <span>Time used</span>
                <span className="spacer" />
                <span className="num">{Math.round(overFrac * 100)}% of limit</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${overFrac * 100}%`,
                    height: "100%",
                    background: overFrac >= 1 ? "var(--danger)" : overFrac > 0.75 ? "var(--warn)" : "var(--ok)",
                    transition: "width var(--t-med) var(--ease-out)",
                  }}
                />
              </div>
            </div>
            <button
              className="btn"
              onClick={() => {
                setCopilotOpen(true);
                ask(`Why was space ${space.label} flagged?`);
              }}
            >
              Ask Copilot about this space
            </button>
          </>
        ) : (
          <p style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)" }}>
            Space is free. Type <strong style={{ color: "var(--ink-mid)" }}>{space.type}</strong>, posted limit{" "}
            {fmtDuration((site.limits[space.type] ?? site.limits.standard) * MIN)}.
          </p>
        )}

        <div>
          <div style={{ fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--ink-muted)", marginBottom: 6 }}>
            LAST 24H IN THIS SPACE
          </div>
          {history.length ? (
            <div style={{ display: "grid", gap: 5 }}>
              {history.map((h) => (
                <div key={h.id} className="row" style={{ fontSize: "var(--fs-1)" }}>
                  <span className="num">{h.plate}</span>
                  <span style={{ color: "var(--ink-faint)" }}>{h.vehicleClass}</span>
                  <span className="spacer" />
                  <span className="num" style={{ color: "var(--ink-muted)" }}>
                    {fmtClock(h.start)}–{h.end < ts ? fmtClock(h.end) : "now"} · {fmtDuration(Math.min(h.end, ts) - h.start)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-faint)" }}>No sessions in the last 24h.</div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/* ================= page ================= */

export default function TwinPage() {
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);
  const mode = useStore((s) => s.mode);
  const realOccupancy = useStore((s) => s.realOccupancy);
  const realSummary = useStore((s) => s.realSummary);
  const settings = useStore((s) => s.settings);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const selectSpace = useStore((s) => s.selectSpace);
  const ts = useStore(twinTime);
  const navigate = useNavigate();

  const [view, setView] = useState(settings.mapStyle || "map");
  const [heat, setHeat] = useState(false);
  const [level, setLevel] = useState(null);
  const [realPolys, setRealPolys] = useState(null);

  const site = scope === "portfolio" ? null : siteById[scope];

  useEffect(() => {
    setLevel(null);
    selectSpace(null);
  }, [scope, selectSpace]);

  // real slot polygons for the schematic (sample-lot only)
  useEffect(() => {
    if (scope === "sample-lot" && !realPolys) {
      fetchSlots("cam1").then((res) => {
        const arr = Array.isArray(res) ? res : res?.slots;
        if (arr?.length && arr[0].polygon) setRealPolys(arr);
      });
    }
  }, [scope, realPolys]);

  /* ---- snapshots (coarse buckets keep renders cheap) ---- */
  const bucket = Math.floor(ts / 2000);

  const snapshot = useMemo(() => {
    if (!site) return null;
    const override = site.real && mode === "live" ? realOccupancy : null;
    const snap = siteSnapshot(site.id, ts, override);
    snap.selectedId = selectedSpaceId;
    snap.realMap = override;
    return snap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, bucket, mode, realOccupancy, selectedSpaceId]);

  const portfolio = useMemo(() => {
    if (site) return null;
    const per = {};
    const agg = { total: 0, occupied: 0, violations: 0, revenue: 0 };
    for (const s of SITES) {
      const snap = siteSnapshot(s.id, ts, s.real && mode === "live" ? realOccupancy : null);
      per[s.id] = snap.occupancy;
      agg.total += snap.total;
      agg.occupied += snap.occupied;
      agg.violations += snap.violations;
      agg.revenue += siteRevenueToday(s.id, ts);
    }
    return { per, agg };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, Math.floor(ts / 5000), mode, realOccupancy]);

  const alerts = useMemo(
    () => activeAlerts(ts, site ? [site.id] : undefined, realSummary),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(ts / 10000), scope, realSummary],
  );

  const predicted = useMemo(
    () => predictedIssues(ts, site ? [site.id] : undefined).slice(0, 3),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(ts / 30000), scope],
  );

  const flow = useMemo(
    () => (site ? siteFlow(site.id, ts - 15 * MIN, ts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site, Math.floor(ts / 30000)],
  );

  const locateAlert = (a) => {
    if (a.siteId !== scope) setScope(a.siteId);
    if (a.spaceId) selectSpace(a.spaceId);
  };

  /* ---- render ---- */
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* ---------- twin canvas ---------- */}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          {view === "map" ? (
            <MapView
              scope={scope}
              ts={ts}
              level={level}
              snapshot={site ? snapshot : { portfolio: portfolio?.per }}
              onSelectSpace={(id) => selectSpace(id)}
              onDrill={(siteId) => setScope(siteId)}
              heat={heat}
            />
          ) : site ? (
            <SchematicView
              site={site}
              snapshot={snapshot}
              selectedId={selectedSpaceId}
              onSelect={(id) => selectSpace(id)}
              level={level}
              realPolys={mode === "live" ? realPolys : null}
            />
          ) : (
            <div className="empty" style={{ position: "absolute", inset: 0 }}>
              <strong>Schematic needs a site</strong>
              <span>Pick a site to see its layout, or use the map for the portfolio view.</span>
            </div>
          )}

          {/* floating controls */}
          <div
            className="row"
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              gap: 8,
              background: "var(--overlay)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-3)",
              padding: 6,
              zIndex: 2,
            }}
          >
            <Segmented
              options={[
                { value: "map", label: "Map" },
                { value: "schematic", label: "Schematic" },
              ]}
              value={view}
              onChange={setView}
            />
            {view === "map" && site && (
              <Segmented
                options={[
                  { value: "off", label: "Spaces" },
                  { value: "on", label: "Dwell heat" },
                ]}
                value={heat ? "on" : "off"}
                onChange={(v) => setHeat(v === "on")}
              />
            )}
            {site?.levels && (
              <Segmented
                options={[{ value: "all", label: "All" }, ...Array.from({ length: site.levels }, (_, i) => ({ value: String(i + 1), label: `L${i + 1}` }))]}
                value={level == null ? "all" : String(level)}
                onChange={(v) => setLevel(v === "all" ? null : Number(v))}
              />
            )}
          </div>

          {/* scope breadcrumb */}
          <div
            className="row"
            style={{
              position: "absolute",
              top: 10,
              right: 48,
              gap: 6,
              background: "var(--overlay)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-3)",
              padding: "5px 10px",
              fontSize: "var(--fs-1)",
              zIndex: 2,
            }}
          >
            <button className="truncate" style={{ color: scope === "portfolio" ? "var(--ink)" : "var(--ink-muted)", fontWeight: 600 }} onClick={() => setScope("portfolio")}>
              Portfolio
            </button>
            {site && (
              <>
                <span style={{ color: "var(--ink-faint)" }}>/</span>
                <span style={{ fontWeight: 600 }}>{site.name}</span>
                <Pill>{KIND_LABEL[site.kind]}</Pill>
                {site.real && <Pill tone="ok">live camera</Pill>}
              </>
            )}
          </div>
        </div>

        {/* ---------- right rail ---------- */}
        <aside
          className="scroll"
          style={{
            width: 296,
            flexShrink: 0,
            borderLeft: "1px solid var(--line)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "var(--bg)",
          }}
        >
          {site && snapshot ? (
            <>
              <RailPanel title={site.name.toUpperCase()} extra={<Pill tone={snapshot.occupancy >= 90 ? "danger" : snapshot.occupancy >= 70 ? "warn" : "ok"}>{fmtPct(snapshot.occupancy)}</Pill>}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Stat label="Available" value={snapshot.available} tone="ok" />
                  <Stat label="Occupied" value={snapshot.occupied} />
                  <Stat label="Violations" value={snapshot.violations} tone={snapshot.violations ? "danger" : undefined} />
                  <Stat label="Avg dwell" value={fmtDuration(snapshot.avgDwellMs)} />
                  {flow && <Stat label="In · last 15m" value={flow.inflow} />}
                  {flow && <Stat label="Out · last 15m" value={flow.outflow} />}
                </div>
              </RailPanel>

              {site.real && (
                <RailPanel
                  title="LIVE CAMERA · CAM1"
                  extra={<Dot tone={realSummary?.status === "connected" ? "ok" : "danger"} pulse={realSummary?.status === "connected"} />}
                >
                  <LiveCamera />
                </RailPanel>
              )}

              <RailPanel title="ZONES">
                <Bars
                  data={site.zones.map((z) => {
                    const za = snapshot.zones[z.id];
                    const v = za?.total ? (za.occupied / za.total) * 100 : 0;
                    return { label: z.name, v, tone: v >= 90 ? "var(--danger)" : v >= 70 ? "var(--warn)" : "var(--ok)" };
                  })}
                />
              </RailPanel>

              <RailPanel title="CAMERAS">
                <div style={{ display: "grid", gap: 6 }}>
                  {site.cameras.map((cam) => {
                    const h = cam.real ? { online: realSummary?.status === "connected" } : cameraHealth(site.id, cam.id, ts);
                    return (
                      <div key={cam.id} className="row" style={{ fontSize: "var(--fs-1)" }}>
                        <Dot tone={h.online ? "ok" : "danger"} />
                        <span className="truncate">{cam.name}</span>
                        <span className="spacer" />
                        <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
                          {h.online ? (cam.real ? "live" : `${h.fps} fps`) : "offline"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </RailPanel>
            </>
          ) : (
            portfolio && (
              <>
                <RailPanel title="PORTFOLIO" extra={<Pill>{SITES.length} sites</Pill>}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Stat label="Occupancy" value={fmtPct((portfolio.agg.occupied / portfolio.agg.total) * 100)} size="lg" />
                    <Stat label="Available" value={portfolio.agg.total - portfolio.agg.occupied} tone="ok" size="lg" />
                    <Stat label="Violations" value={portfolio.agg.violations} tone={portfolio.agg.violations ? "danger" : undefined} />
                    <Stat label="Est. revenue" value={fmtMoney(portfolio.agg.revenue)} />
                  </div>
                </RailPanel>
                <RailPanel title="SITES">
                  <div style={{ display: "grid", gap: 7 }}>
                    {SITES.map((s) => {
                      const v = portfolio.per[s.id];
                      return (
                        <button key={s.id} className="row" style={{ fontSize: "var(--fs-1)", textAlign: "left" }} onClick={() => setScope(s.id)}>
                          <Dot tone={v >= 90 ? "danger" : v >= 70 ? "warn" : "ok"} />
                          <span className="truncate" style={{ color: "var(--ink-mid)" }}>{s.name}</span>
                          <span className="spacer" />
                          <span className="num">{fmtPct(v)}</span>
                        </button>
                      );
                    })}
                  </div>
                </RailPanel>
              </>
            )
          )}

          <RailPanel title="ACTIVE ALERTS" extra={alerts.length ? <Pill tone="danger">{alerts.length}</Pill> : null}>
            <AlertsRail alerts={alerts} onLocate={locateAlert} />
          </RailPanel>

          <RailPanel title="PREDICTED">
            {predicted.length ? (
              <div style={{ display: "grid", gap: 7 }}>
                {predicted.map((p) => (
                  <div key={p.id} className="row" style={{ fontSize: "var(--fs-0)", alignItems: "flex-start" }}>
                    <Dot tone={p.sev === "danger" ? "danger" : p.sev === "warn" ? "warn" : undefined} />
                    <span style={{ color: "var(--ink-muted)", lineHeight: 1.45 }}>{p.detail}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)" }}>Nothing predicted.</div>
            )}
            <button className="btn ghost sm" style={{ marginTop: 8, fontSize: 10 }} onClick={() => navigate("/events")}>
              Open Events & Alerts →
            </button>
          </RailPanel>
        </aside>
      </div>

      <TimeScrubber scope={scope} />
      {site && <SpaceDrawer scope={scope} ts={ts} />}
    </div>
  );
}
