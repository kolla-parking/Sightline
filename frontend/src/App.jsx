import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import "./styles/tokens.css";
import "./styles/base.css";

import { Shell } from "./components/Shell.jsx";
import { Mark } from "./components/ui.jsx";
import { startBridge } from "./live/bridge.js";
import { useStore } from "./store/useStore.js";
import { apiMe } from "./lib/api.js";

import SitesPage from "./pages/SitesPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import TwinPage from "./pages/TwinPage.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import EventsPage from "./pages/EventsPage.jsx";
import EnforcementPage from "./pages/EnforcementPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import CopilotPage from "./pages/CopilotPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import LegacyDashboard from "./pages/Dashboard.jsx";

// Boot-gate: verify the stored token against /auth/member/me before showing
// the app. Backend unreachable (status 0) stays fail-soft — let the operator
// in optimistically; the offline dot already communicates backend state.
function RequireAuth({ children }) {
  const authStatus = useStore((s) => s.authStatus);
  const authToken = useStore((s) => s.authToken);
  const setAuth = useStore((s) => s.setAuth);
  const clearAuth = useStore((s) => s.clearAuth);

  useEffect(() => {
    if (authStatus !== "checking") return;
    if (!authToken) {
      clearAuth(); // no token — straight to anon
      return;
    }
    let alive = true;
    apiMe(authToken).then((res) => {
      if (!alive) return;
      if (res.ok) setAuth({ token: authToken, user: res.data?.member || null });
      else if (res.status === 401 || res.status === 403) clearAuth();
      else setAuth({ token: authToken, user: null }); // status 0 — authed-optimistic
    });
    return () => {
      alive = false;
    };
  }, [authStatus, authToken, setAuth, clearAuth]);

  if (authStatus === "checking") {
    return (
      <div
        role="status"
        aria-label="Checking your session"
        style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--bg)" }}
      >
        <div style={{ display: "grid", gap: "var(--sp-3)", justifyItems: "center" }}>
          <Mark size={28} />
          <div className="display" style={{ lineHeight: 1 }}>
            Sightline
          </div>
          <div
            className="mono"
            style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-faint)" }}
          >
            OPERATIONS CONSOLE
          </div>
          <div
            className="skeleton"
            aria-hidden="true"
            style={{ width: 88, height: 3, borderRadius: "var(--r-1)" }}
          />
        </div>
      </div>
    );
  }
  if (authStatus === "anon") return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => {
    startBridge();
  }, []);

  // Theme (Daylight v3): mirror the persisted explicit choice onto <html>.
  // "light" / "dark" stamp data-theme; anything else (including "system"
  // and legacy values) removes the attribute so tokens.css follows
  // prefers-color-scheme. index.html pre-paints the same attribute before
  // CSS loads so neither theme flashes the other. The theme-color metas
  // (browser/mobile chrome) track the same choice: pinned to the explicit
  // theme's ground, media-gated per scheme when following the system.
  useEffect(() => {
    const explicit = theme === "dark" || theme === "light";
    if (explicit) {
      document.documentElement.dataset.theme = theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    metas.forEach((m, i) => {
      const scheme = explicit ? theme : i === 0 ? "light" : "dark";
      m.setAttribute("content", scheme === "dark" ? "#0F1412" : "#FBFCFB");
      if (explicit) m.removeAttribute("media");
      else m.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
    });
  }, [theme]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/console/legacy" element={<LegacyDashboard />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <Shell>
                <Routes>
                  <Route path="/" element={<Navigate to="/console/twin" replace />} />
                  <Route path="/console/sites" element={<SitesPage />} />
                  <Route path="/console/twin" element={<TwinPage />} />
                  <Route path="/console/analytics" element={<AnalyticsPage />} />
                  <Route path="/console/events" element={<EventsPage />} />
                  <Route path="/console/enforcement" element={<EnforcementPage />} />
                  <Route path="/console/reports" element={<ReportsPage />} />
                  <Route path="/console/copilot" element={<CopilotPage />} />
                  <Route path="/console/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/console/twin" replace />} />
                </Routes>
              </Shell>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
