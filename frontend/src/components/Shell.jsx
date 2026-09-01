// App chrome (Daylight v3): left sidebar of job-named nav (grid-mark +
// wordmark, grouped links, link telemetry in the footer) beside a topbar
// (search/⌘K, clock, scope, copilot, session) over a full-bleed content
// area. Global keyboard map (g-keys, ⌘K, \, l, [ ]) is unchanged.

import { useEffect, useMemo, useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useStore, twinTime } from "../store/useStore.js";
import { SITES, siteById } from "../sim/sites.js";
import { activeAlerts } from "../sim/engine.js";
import { fmtClockSec, fmtDateTime } from "../lib/format.js";
import { apiLogout } from "../lib/api.js";
import { Kbd, Mark, Toasts } from "./ui.jsx";
import { CommandPalette } from "./CommandPalette.jsx";
import { CopilotSidePanel } from "./CopilotPanel.jsx";
import { VehicleDrawer } from "./VehicleDrawer.jsx";

/* ---------- nav icons: minimal 15px strokes, currentColor ---------- */

const ic = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };

const Icons = {
  live: (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...ic}>
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <path d="M4.5 4.5a5 5 0 0 0 0 7M11.5 4.5a5 5 0 0 1 0 7" />
    </svg>
  ),
  alerts: (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...ic}>
      <path d="M8 2.2a3.8 3.8 0 0 0-3.8 3.8v2.6L3 11h10l-1.2-2.4V6A3.8 3.8 0 0 0 8 2.2Z" />
      <path d="M6.6 13.2a1.5 1.5 0 0 0 2.8 0" />
    </svg>
  ),
  copilot: (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...ic}>
      <path d="M8 2.5 9.3 6.7 13.5 8l-4.2 1.3L8 13.5 6.7 9.3 2.5 8l4.2-1.3L8 2.5Z" />
    </svg>
  ),
  sites: (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...ic}>
      <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1" />
      <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1" />
      <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1" />
      <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1" />
    </svg>
  ),
  enforcement: (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...ic}>
      <path d="M8 2.2 13 4v3.6c0 3.2-2.1 5.3-5 6.2-2.9-.9-5-3-5-6.2V4l5-1.8Z" />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...ic}>
      <path d="M3 13.5V9M8 13.5V5.5M13 13.5V2.5" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...ic}>
      <path d="M4 2.5h5.5L12.5 5v8.5H4V2.5Z" />
      <path d="M6 8h4.5M6 10.5h4.5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...ic}>
      <path d="M3 5h10M3 11h10" />
      <circle cx="6" cy="5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 16 16" aria-hidden="true" width="13" height="13" {...ic}>
      <circle cx="7" cy="7" r="4" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  ),
};

/* ---------- nav model: job-named labels; routes/paths unchanged ---------- */

const NAV_GROUPS = [
  {
    label: "Operate",
    items: [
      { to: "/console/twin", label: "Live", icon: "live" },
      { to: "/console/events", label: "Alerts", icon: "alerts", badge: true },
      { to: "/console/copilot", label: "Copilot", icon: "copilot" },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { to: "/console/sites", label: "Sites", icon: "sites" },
      { to: "/console/enforcement", label: "Enforcement", icon: "enforcement" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { to: "/console/analytics", label: "Analytics", icon: "analytics" },
      { to: "/console/reports", label: "Reports", icon: "reports" },
    ],
  },
];

const G_KEYS = { o: "/console/sites", t: "/console/twin", a: "/console/analytics", e: "/console/events", n: "/console/enforcement", r: "/console/reports", c: "/console/copilot", s: "/console/settings" };

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
  return <span className="nav-badge">{count}</span>;
}

function StatusChip() {
  const backendUp = useStore((s) => s.backendUp);
  const wsStatus = useStore((s) => s.wsStatus);
  return (
    <div className="status-chip" role="status" aria-label="Data link status">
      <span className="row" style={{ gap: 5 }}>
        <span className={`dot ${backendUp ? "ok pulse" : "danger"}`} />
        <span>Backend {backendUp ? "up" : "down"}</span>
      </span>
      <span className="row" style={{ gap: 5 }}>
        <span className={`dot ${wsStatus === "connected" ? "ok" : "warn"}`} />
        <span>Stream {wsStatus}</span>
      </span>
    </div>
  );
}

function SideLink({ item }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) => `side-link${isActive ? " active" : ""}`}
      title={item.label}
    >
      {Icons[item.icon]}
      <span>{item.label}</span>
      {item.badge && (
        <>
          <span className="spacer" aria-hidden="true" />
          <AlertBadge />
        </>
      )}
    </NavLink>
  );
}

export function Shell({ children }) {
  const navigate = useNavigate();
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setCopilotOpen = useStore((s) => s.setCopilotOpen);
  const jumpLive = useStore((s) => s.jumpLive);
  const authUser = useStore((s) => s.authUser);
  const clearAuth = useStore((s) => s.clearAuth);
  const gRef = useRef(0);

  const signOut = () => {
    apiLogout(useStore.getState().authToken); // fire-and-forget
    clearAuth();
    window.location.assign("/login");
  };

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
    <div className="shell">
      {/* ---------- sidebar ---------- */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Mark size={20} />
          <span className="sidebar-word">Sightline</span>
          <span className="sidebar-ops">OPS</span>
        </div>

        <nav className="side-nav" aria-label="Primary">
          {NAV_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="side-group">{g.label}</div>
              {g.items.map((item) => (
                <SideLink key={item.to} item={item} />
              ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <SideLink item={{ to: "/console/settings", label: "Settings", icon: "settings" }} />
          <StatusChip />
        </div>
      </aside>

      {/* ---------- main column ---------- */}
      <div className="shell-main">
        <header className="topbar">
          <button
            className="topbar-search"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
          >
            {Icons.search}
            <span>Search or command…</span>
            <Kbd>⌘K</Kbd>
          </button>

          <div className="spacer" />

          <Clock />
          <div className="select-wrap">
            <select
              className="select"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              aria-label="Site scope"
              title={scope !== "portfolio" ? siteById[scope]?.address : undefined}
              style={{ maxWidth: 190, fontWeight: 500 }}
            >
              <option value="portfolio">Portfolio — all sites</option>
              {SITES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn ghost sm"
            onClick={() => setCopilotOpen(!useStore.getState().copilotOpen)}
            title="Toggle Copilot (\)"
          >
            <span className="dot accent" />
            Copilot
          </button>
          {authUser?.email && (
            <span className="pill" title={authUser.email} style={{ maxWidth: 180 }}>
              <span className="truncate">{authUser.email}</span>
            </span>
          )}
          <button className="btn ghost sm" onClick={signOut}>
            Sign out
          </button>
        </header>

        {/* ---------- full-bleed content ---------- */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <main className="scroll" style={{ flex: 1, minWidth: 0 }}>
            {children}
          </main>
          <CopilotSidePanel />
        </div>
      </div>

      <CommandPalette />
      {/* Vehicle identity drawer — mounted once so plate links work from
          any page (twin, alerts, copilot). */}
      <VehicleDrawer />
      <Toasts />
    </div>
  );
}
