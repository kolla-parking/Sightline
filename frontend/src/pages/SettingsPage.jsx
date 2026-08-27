// SettingsPage — operator preferences, data-source health, simulation info.
// All settings persist via the store (localStorage: sightline.settings.v1).

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, useTwinTime } from "../store/useStore.js";
import { SITES } from "../sim/sites.js";
import { cameraHealth } from "../sim/engine.js";
import { Pill, Dot, Kbd, Segmented } from "../components/ui.jsx";
import { API_URL } from "../lib/api.js";
import { fmtClock } from "../lib/format.js";

/* ---------------- local building blocks ---------------- */

function Section({ title, right, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title">{title}</div>
        {right && (
          <>
            <div className="spacer" />
            {right}
          </>
        )}
      </div>
      {children}
    </section>
  );
}

function SettingRow({ label, help, control, last = false }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 0",
        borderBottom: last ? "none" : "1px solid var(--line)",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 500 }}>{label}</div>
        {help && (
          <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)", marginTop: 2 }}>
            {help}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 999,
        padding: 2,
        background: checked ? "var(--accent)" : "var(--surface-3)",
        border: `1px solid ${checked ? "transparent" : "var(--line-strong)"}`,
        display: "inline-flex",
        alignItems: "center",
        transition: "background var(--t-fast), border-color var(--t-fast)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: checked ? "var(--accent-ink)" : "var(--ink-mid)",
          transform: checked ? "translateX(14px)" : "translateX(0)",
          transition: "transform var(--t-fast) var(--ease-out), background var(--t-fast)",
          display: "block",
        }}
      />
    </button>
  );
}

function KeySeq({ keys }) {
  return (
    <span className="row" style={{ gap: 4, display: "inline-flex" }}>
      {keys.map((k, i) =>
        k === "then" || k === "/" ? (
          <span key={i} style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
            {k}
          </span>
        ) : (
          <Kbd key={i}>{k}</Kbd>
        ),
      )}
    </span>
  );
}

const SHORTCUTS = [
  { keys: ["⌘", "K"], action: "Open command palette" },
  { keys: ["G", "then", "T"], action: "Go to Twin" },
  { keys: ["G", "then", "A"], action: "Go to Analytics" },
  { keys: ["G", "then", "E"], action: "Go to Events" },
  { keys: ["G", "then", "N"], action: "Go to Enforcement" },
  { keys: ["G", "then", "R"], action: "Go to Reports" },
  { keys: ["G", "then", "C"], action: "Go to Copilot" },
  { keys: ["G", "then", "S"], action: "Go to Sites" },
  { keys: ["G", "then", "O"], action: "Go to Settings" },
  { keys: ["\\"], action: "Toggle copilot panel" },
  { keys: ["L"], action: "Jump to live" },
  { keys: ["[", "/", "]"], action: "Scrub twin time −15m / +15m" },
];

/* ---------------- page ---------------- */

export default function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const addToast = useStore((s) => s.addToast);
  const backendUp = useStore((s) => s.backendUp);
  const wsStatus = useStore((s) => s.wsStatus);
  const realSummary = useStore((s) => s.realSummary);

  const ts = useTwinTime();
  const camBucket = Math.floor(ts / 30000); // coarse bucket — camera list refresh

  /* debounce the "Saved" toast so sliders don't spam */
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const save = (key, value) => {
    setSetting(key, value);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => addToast("Saved"), 450);
  };

  /* grace minutes — local draft so the field can be edited freely */
  const [graceDraft, setGraceDraft] = useState(String(settings.overstayGraceMin));
  const onGraceChange = (raw) => {
    setGraceDraft(raw);
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(0, Math.min(60, Math.round(n)));
    save("overstayGraceMin", clamped);
  };
  const onGraceBlur = () => {
    setGraceDraft(String(useStore.getState().settings.overstayGraceMin));
  };

  /* camera inventory across ALL sites, simulated health seeded on twin time */
  const cameraRows = useMemo(() => {
    const t = camBucket * 30000;
    const rows = [];
    for (const site of SITES) {
      for (const cam of site.cameras) {
        rows.push({
          key: `${site.id}:${cam.id}`,
          cam,
          site,
          real: !!cam.real,
          health: cam.real ? null : cameraHealth(site.id, cam.id, t),
        });
      }
    }
    return rows;
  }, [camBucket]);

  const wsTone =
    wsStatus === "connected" || wsStatus === "open"
      ? "ok"
      : wsStatus === "connecting"
        ? "warn"
        : "danger";

  const onReset = () => {
    const ok = window.confirm(
      "Reset local data? This clears saved enforcement cases and local settings, then reloads the app.",
    );
    if (!ok) return;
    try {
      localStorage.removeItem("sightline.cases.v1");
      localStorage.removeItem("sightline.settings.v1");
    } catch {
      /* storage unavailable */
    }
    window.location.reload();
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-4)" }}>Settings</h1>
          <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)", marginTop: 2 }}>
            Operator preferences — stored locally in this browser.
          </div>
        </div>

        {/* ---------------- 1 · Detection & alerting ---------------- */}
        <Section title="Detection & alerting">
          <div className="panel-body">
            <SettingRow
              label="Overstay grace period"
              help="Minutes past a space's posted time limit before a session is flagged as an overstay. 0 flags the moment the limit is exceeded."
              control={
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input num"
                    type="number"
                    min={0}
                    max={60}
                    step={1}
                    value={graceDraft}
                    onChange={(e) => onGraceChange(e.target.value)}
                    onBlur={onGraceBlur}
                    style={{ width: 72, textAlign: "right" }}
                    aria-label="Overstay grace minutes"
                  />
                  <span style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)" }}>min</span>
                </div>
              }
            />
            <SettingRow
              label="Congestion alert threshold"
              help="Site occupancy at which a congestion-risk alert is raised and the twin flags the site as near capacity."
              last
              control={
                <div className="row" style={{ gap: 10 }}>
                  <input
                    type="range"
                    min={70}
                    max={100}
                    step={1}
                    value={settings.congestionPct}
                    onChange={(e) => save("congestionPct", Number(e.target.value))}
                    style={{ width: 150, accentColor: "var(--accent)" }}
                    aria-label="Congestion threshold percent"
                  />
                  <span
                    className="num"
                    style={{
                      fontSize: "var(--fs-2)",
                      fontWeight: 600,
                      minWidth: 40,
                      textAlign: "right",
                    }}
                  >
                    {settings.congestionPct}%
                  </span>
                </div>
              }
            />
          </div>
        </Section>

        {/* ---------------- 2 · Display ---------------- */}
        <Section title="Display">
          <div className="panel-body">
            <SettingRow
              label="Default twin view"
              help="Projection the digital twin opens with — geographic map or schematic grid."
              control={
                <Segmented
                  options={[
                    { value: "map", label: "Map" },
                    { value: "schematic", label: "Schematic" },
                  ]}
                  value={settings.mapStyle}
                  onChange={(v) => save("mapStyle", v)}
                />
              }
            />
            <SettingRow
              label="Density"
              help="Row spacing across tables and lists."
              control={
                <Segmented
                  options={[
                    { value: "dense", label: "Dense" },
                    { value: "comfortable", label: "Comfortable" },
                  ]}
                  value={settings.density}
                  onChange={(v) => save("density", v)}
                />
              }
            />
            <SettingRow
              label="Show flow arrows"
              help="Overlay entry / exit flow arrows on the twin while in live mode."
              last
              control={
                <Toggle
                  checked={!!settings.showFlow}
                  onChange={(v) => save("showFlow", v)}
                  label="Show flow arrows"
                />
              }
            />
          </div>
        </Section>

        {/* ---------------- 3 · Data sources ---------------- */}
        <Section title="Data sources">
          <div className="panel-body">
            <SettingRow
              label="Backend API"
              help={<span className="mono">{API_URL}</span>}
              control={
                <span className="row" style={{ gap: 6 }}>
                  <Dot tone={backendUp ? "ok" : "danger"} pulse={backendUp} />
                  <span
                    style={{
                      fontSize: "var(--fs-1)",
                      color: backendUp ? "var(--ok)" : "var(--danger)",
                      fontWeight: 600,
                    }}
                  >
                    {backendUp ? "Online" : "Offline"}
                  </span>
                </span>
              }
            />
            <SettingRow
              label="WebSocket"
              help="Live occupancy push channel for the real camera feed."
              last
              control={
                <span className="row" style={{ gap: 6 }}>
                  <Dot tone={wsTone} pulse={wsTone === "ok"} />
                  <span
                    style={{
                      fontSize: "var(--fs-1)",
                      color: `var(--${wsTone === "ok" ? "ok" : wsTone === "warn" ? "warn" : "danger"})`,
                      fontWeight: 600,
                      textTransform: "capitalize",
                    }}
                  >
                    {wsStatus}
                  </span>
                </span>
              }
            />
          </div>
          <div
            className="scroll"
            style={{
              borderTop: "1px solid var(--line)",
              maxHeight: 340,
              borderRadius: "0 0 var(--r-4) var(--r-4)",
            }}
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Camera</th>
                  <th>Site</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>FPS</th>
                  <th style={{ textAlign: "right" }}>Latency</th>
                </tr>
              </thead>
              <tbody>
                {cameraRows.map((r) => {
                  const online = r.real ? backendUp : r.health.online;
                  const fps = r.real
                    ? realSummary?.fps != null
                      ? realSummary.fps
                      : null
                    : r.health.online
                      ? r.health.fps
                      : null;
                  const latency = r.real
                    ? realSummary?.latencyMs != null
                      ? realSummary.latencyMs
                      : null
                    : r.health.online
                      ? r.health.latencyMs
                      : null;
                  return (
                    <tr key={r.key}>
                      <td style={{ fontWeight: 500 }}>{r.cam.name}</td>
                      <td style={{ color: "var(--ink-mid)" }}>{r.site.name}</td>
                      <td>
                        {r.real ? (
                          <Pill tone="accent">Real</Pill>
                        ) : (
                          <Pill>Simulated</Pill>
                        )}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <Dot tone={online ? "ok" : "danger"} />
                          <span style={{ color: online ? "var(--ink-mid)" : "var(--danger)" }}>
                            {online ? "Online" : "Offline"}
                          </span>
                          {!online && !r.real && r.health.until && (
                            <span style={{ color: "var(--ink-faint)", fontSize: "var(--fs-0)" }}>
                              est. {fmtClock(r.health.until)}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>
                        {fps != null ? fps : "—"}
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>
                        {latency != null ? `${latency} ms` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---------------- 4 · Simulation ---------------- */}
        <Section title="Simulation">
          <div className="panel-body">
            <p style={{ fontSize: "var(--fs-1)", color: "var(--ink-mid)", lineHeight: 1.55 }}>
              Every site except Sample Lot 1 is powered by a deterministic, seeded simulation.
              Occupancy, sessions, events, and camera health are derived purely from the
              timestamp, so live and replay views are reproducible — the same moment always
              renders the same state, on any machine.
            </p>
            <p
              className="row"
              style={{
                fontSize: "var(--fs-1)",
                color: "var(--ink-mid)",
                marginTop: 8,
                gap: 6,
                alignItems: "baseline",
              }}
            >
              <Pill tone="accent">Real</Pill>
              <span>
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>Sample Lot 1</span>{" "}
                (<span className="mono">sample-lot</span>) is live — its current occupancy
                comes from the backend camera over the WebSocket when connected.
              </span>
            </p>
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "var(--fs-2)", fontWeight: 500, color: "var(--danger)" }}>
                  Reset local data
                </div>
                <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)", marginTop: 2 }}>
                  Clears saved enforcement cases (<span className="mono">sightline.cases.v1</span>)
                  and local settings (<span className="mono">sightline.settings.v1</span>), then
                  reloads the app.
                </div>
              </div>
              <button className="btn danger" onClick={onReset} style={{ flexShrink: 0 }}>
                Reset local data
              </button>
            </div>
          </div>
        </Section>

        {/* ---------------- 5 · Keyboard shortcuts ---------------- */}
        <Section title="Keyboard shortcuts">
          <div
            className="panel-body flush scroll"
            style={{ borderRadius: "0 0 var(--r-4) var(--r-4)" }}
          >
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>Keys</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {SHORTCUTS.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <KeySeq keys={s.keys} />
                    </td>
                    <td style={{ color: "var(--ink-mid)" }}>{s.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
