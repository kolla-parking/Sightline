// Member sign-in. Shell-less (like /legacy) — renders before any auth
// exists, verifies credentials against the real backend, then hands off
// to the app via the store's auth slice.

import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore.js";
import { apiLogin } from "../lib/api.js";
import { Mark } from "../components/ui.jsx";

export default function LoginPage() {
  const navigate = useNavigate();
  const authStatus = useStore((s) => s.authStatus);
  const setAuth = useStore((s) => s.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // The live kick (bridge.js) leaves a note before hard-navigating here.
  // Read it WITHOUT clearing: the store update during a kick can client-route
  // a throwaway LoginPage into the dying page, and a clear-on-mount there
  // would eat the flag before the fresh document loads. The flag is cleared
  // on successful sign-in instead.
  const [notice] = useState(() => {
    try {
      const kicked = sessionStorage.getItem("sl.kicked");
      if (!kicked) return null;
      return kicked === "403"
        ? "Your organization's access was revoked by Sightline. Contact your administrator if this is unexpected."
        : "Your session ended — please sign in again.";
    } catch {
      return null;
    }
  });

  if (authStatus === "authed") return <Navigate to="/console/twin" replace />;

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await apiLogin(email.trim(), password);
    if (res.ok && res.data?.token) {
      try {
        sessionStorage.removeItem("sl.kicked");
      } catch {
        /* storage unavailable */
      }
      setAuth({ token: res.data.token, user: res.data.member || null });
      navigate("/console/twin", { replace: true });
      return;
    }
    setBusy(false);
    if (res.status === 0) {
      setError("Backend unreachable — check that the Sightline server is running.");
    } else if (res.status === 403) {
      setError(
        "Your organization's access was revoked by Sightline. Contact your administrator if this is unexpected.",
      );
    } else {
      setError("Invalid email or password.");
    }
  }

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        padding: "var(--sp-4)",
        background: "var(--bg)",
      }}
    >
      <div style={{ width: "min(380px, 100%)", display: "grid", gap: "var(--sp-4)" }}>
        {/* display moment: mark + Schibsted wordmark ≥28px */}
        <div style={{ display: "grid", gap: "var(--sp-2)", justifyItems: "start", padding: "0 2px" }}>
          <div className="row" style={{ gap: 10 }}>
            <Mark size={26} />
            <span className="display" style={{ lineHeight: 1 }}>Sightline</span>
          </div>
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-muted)" }}
          >
            OPERATIONS CONSOLE
          </span>
        </div>

        <form
          className="panel"
          style={{ boxShadow: "var(--shadow-2)" }}
          onSubmit={submit}
        >
        <div style={{ padding: "var(--sp-5)", display: "grid", gap: "var(--sp-3)" }}>
          {notice && (
            <div
              role="status"
              style={{
                padding: "var(--sp-2) var(--sp-3)",
                borderRadius: "var(--r-2)",
                border: "1px solid var(--warn)",
                background: "var(--warn-dim)",
                color: "var(--warn)",
                fontSize: "var(--fs-1)",
                lineHeight: 1.45,
              }}
            >
              {notice}
            </div>
          )}

          <label style={{ display: "grid", gap: "var(--sp-1)" }}>
            <span
              className="mono"
              style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-muted)" }}
            >
              EMAIL
            </span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label style={{ display: "grid", gap: "var(--sp-1)" }}>
            <span
              className="mono"
              style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-muted)" }}
            >
              PASSWORD
            </span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && (
            <div role="alert" style={{ fontSize: "var(--fs-1)", color: "var(--danger)", lineHeight: 1.45 }}>
              {error}
            </div>
          )}

          <button className="btn primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
        </form>
      </div>
    </div>
  );
}
