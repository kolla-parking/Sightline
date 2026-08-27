import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import "./styles/tokens.css";
import "./styles/base.css";

import { Shell } from "./components/Shell.jsx";
import { startBridge } from "./live/bridge.js";

import SitesPage from "./pages/SitesPage.jsx";
import TwinPage from "./pages/TwinPage.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import EventsPage from "./pages/EventsPage.jsx";
import EnforcementPage from "./pages/EnforcementPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import CopilotPage from "./pages/CopilotPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import LegacyDashboard from "./pages/Dashboard.jsx";

export default function App() {
  useEffect(() => {
    startBridge();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/legacy" element={<LegacyDashboard />} />
        <Route
          path="*"
          element={
            <Shell>
              <Routes>
                <Route path="/" element={<Navigate to="/twin" replace />} />
                <Route path="/sites" element={<SitesPage />} />
                <Route path="/twin" element={<TwinPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/events" element={<EventsPage />} />
                <Route path="/enforcement" element={<EnforcementPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/copilot" element={<CopilotPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/twin" replace />} />
              </Routes>
            </Shell>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
