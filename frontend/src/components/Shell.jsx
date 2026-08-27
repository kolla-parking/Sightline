// App shell: sidebar nav + topbar + global keyboard map + copilot panel.

import { useEffect, useMemo, useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useStore, twinTime } from "../store/useStore.js";
import { SITES, siteById } from "../sim/sites.js";
import { activeAlerts } from "../sim/engine.js";
import { fmtClockSec, fmtDateTime } from "../lib/format.js";
import { Kbd, Toasts } from "./ui.jsx";
import { CommandPalette } from "./CommandPalette.jsx";
import { CopilotSidePanel } from "./CopilotPanel.jsx";

const I = {
  sites: <path d="M2 6l5-3 5 3 5-3v8l-5 3-5-3-5 3V6zm5-3v8m5-5v8" />,
  twin: <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 3a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm0 2.4a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z" />,
  analytics: <path d="M2 14V9m4 5V5m4 9v-4m4 4V2" />,
  events: <path d="M8 2a4 4 0 00-4 4v3l-1.5 2.5h11L12 9V6a4 4 0 00-4-4zm-1.5 11a1.5 1.5 0 003 0" />,
  enforcement: <path d="M8 1.5l5.5 2v4c0 3.5-2.3 6-5.5 7-3.2-1-5.5-3.5-5.5-7v-4l5.5-2zM5.8 8l1.6 1.6L10.6 6" />,
  reports: <path d="M4 1.5h6l3 3v10H4v-13zm6 0v3h3M6.5 8h4m-4 3h4" />,
  copilot: <path d="M8 1.5l1.3 4.2 4.2 1.3-4.2 1.3L8 12.5 6.7 8.3 2.5 7l4.2-1.3L8 1.5zm5 8.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3z" />,
  settings: <path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1v2m0 10v2M2 8h2m8 0h2M3.8 3.8l1.4 1.4m5.6 5.6l1.4 1.4m0-8.4l-1.4 1.4M5.2 10.8l-1.4 1.4" />,
};

function Icon({ name }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      {I[name]}
    </svg>
  );
}

const NAV = [
  { to: "/sites", icon: "sites", label: "Sites" },
  { to: "/twin", icon: "twin", label: "Live Twin" },
  { to: "/analytics", icon: "analytics", label: "Analytics" },
  { to: "/events", icon: "events", label: "Events & Alerts" },
  { to: "/enforcement", icon: "enforcement", label: "Enforcement" },
  { to: "/reports", icon: "reports", label: "Reports" },
  { to: "/copilot", icon: "copilot", label: "Copilot" },
  { to: "/settings", icon: "settings", label: "Settings" },
];

const G_KEYS = { o: "/sites", t: "/twin", a: "/analytics", e: "/events", n: "/enforcement", r: "/reports", c: "/copilot", s: "/settings" };

function Clock() {
  const now = useStore((s) => s.now);
  const mode = useStore((s) => s.mode);
  const t = useStore(twinTime);
  return (
    <div className="row" style={{ gap: 8 }}>
      {mode === "replay" && (
        <span className="pill warn" title="The twin is showing a past moment">
          REPLAY · {fmtDateTime(t)}
        </span>
      )}
      <span className="num" style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)" }}>{fmtClockSec(now)}</span>
    </div>
  );
}

function AlertBadge() {
  const now = useStore((s) => s.now);
  const realSummary = useStore((s) => s.realSummary);
  // coarse 30s bucket — this is a badge, not a feed
  const bucket = Math.floor(now / 30000);
  const count = useMemo(
    () => activeAlerts(bucket * 30000, undefined, realSummary).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, realSummary?.status],
  );
  if (!count) return null;
  return (
    <span
      className="num"
      style={{
        marginLeft: "auto",
        fontSize: 10,
        fontWeight: 700,
        background: "var(--danger-dim)",
        color: "var(--danger)",
        borderRadius: 999,
        padding: "1px 6px",
      }}
    >
      {count}
    </span>
  );
}

export function Shell({ children }) {
  const navigate = useNavigate();
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setCopilotOpen = useStore((s) => s.setCopilotOpen);
  const jumpLive = useStore((s) => s.jumpLive);
  const backendUp = useStore((s) => s.backendUp);
  const wsStatus = useStore((s) => s.wsStatus);
  const gRef = useRef(0);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (typing) return;
      if (e.key === "g") {
        gRef.current = Date.now();
        return;
      }
      if (Date.now() - gRef.current < 900 && G_KEYS[e.key]) {
        navigate(G_KEYS[e.key]);
        gRef.current = 0;
        return;
      }
      if (e.key === "\\") {
        setCopilotOpen(!useStore.getState().copilotOpen);
      } else if (e.key === "l") {
        jumpLive();
      } else if (e.key === "[" || e.key === "]") {
        const s = useStore.getState();
        s.setCursor((s.mode === "live" ? s.now : s.cursor) + (e.key === "]" ? 15 : -15) * 60000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setPaletteOpen, setCopilotOpen, jumpLive]);

  return (
    <div style={{ display: "flex", height: "100%", minWidth: 0 }}>
      {/* ---------- sidebar ---------- */}
      <nav
        style={{
          width: 208,
          flexShrink: 0,
          background: "var(--bg-sunken)",
          borderRight: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
        }}
        aria-label="Primary"
      >
        <div className="row" style={{ padding: "14px 16px 12px", gap: 9 }}>
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="12" stroke="var(--accent)" strokeWidth="2.5" />
            <circle cx="16" cy="16" r="3.5" fill="var(--ok)" />
          </svg>
          <div>
            <div style={{ fontWeight: 700, fontSize: "var(--fs-2)", letterSpacing: "-0.01em" }}>Sightline</div>
            <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>Operations · v10</div>
          </div>
        </div>

        <div style={{ padding: "4px 10px 10px" }}>
          <button
            className="row"
            style={{
              width: "100%",
              padding: "6px 9px",
              borderRadius: "var(--r-2)",
              border: "1px solid var(--line)",
              background: "var(--surface)",
              fontSize: "var(--fs-1)",
              color: "var(--ink-mid)",
            }}
            onClick={() => setPaletteOpen(true)}
          >
            <span>Search or command…</span>
            <span className="spacer" />
            <Kbd>⌘K</Kbd>
          </button>
        </div>

        <div style={{ flex: 1, padding: "0 8px", display: "grid", gap: 1, alignContent: "start" }}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className="row"
              style={({ isActive }) => ({
                padding: "6px 9px",
                borderRadius: "var(--r-2)",
                fontSize: "var(--fs-1)",
                fontWeight: 500,
                color: isActive ? "var(--ink)" : "var(--ink-muted)",
                background: isActive ? "var(--surface-2)" : "transparent",
                transition: "background var(--t-fast), color var(--t-fast)",
              })}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.to === "/events" && <AlertBadge />}
            </NavLink>
          ))}
        </div>

        <div style={{ padding: 12, borderTop: "1px solid var(--line)", display: "grid", gap: 6 }}>
          <div className="row" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
            <span className={`dot ${backendUp ? "ok pulse" : "danger"}`} />
            <span>Backend {backendUp ? "connected" : "offline"}</span>
          </div>
          <div className="row" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
            <span className={`dot ${wsStatus === "connected" ? "ok" : "warn"}`} />
            <span>Stream {wsStatus}</span>
          </div>
        </div>
      </nav>

      {/* ---------- main column ---------- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          className="row"
          style={{
            height: 46,
            padding: "0 14px",
            borderBottom: "1px solid var(--line)",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div className="select-wrap">
            <select
              className="select"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              aria-label="Site scope"
              style={{ minWidth: 190, fontWeight: 600 }}
            >
              <option value="portfolio">Portfolio — all sites</option>
              {SITES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {scope !== "portfolio" && (
            <span className="pill">{siteById[scope]?.address}</span>
          )}
          <div className="spacer" />
          <Clock />
          <button className="btn ghost sm" onClick={() => setCopilotOpen(!useStore.getState().copilotOpen)} title="Toggle Copilot (\\)">
            <span className="dot accent" />
            Copilot
          </button>
        </header>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <main className="scroll" style={{ flex: 1, minWidth: 0 }}>
            {children}
          </main>
          <CopilotSidePanel />
        </div>
      </div>

      <CommandPalette />
      <Toasts />
    </div>
  );
}
