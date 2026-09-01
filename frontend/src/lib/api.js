// REST client for the real Sightline backend. Every call fails soft —
// the dashboard must stay fully usable when the backend is down.

// VITE_API_URL may be a bare host (deploy tooling); default it to https.
const RAW_API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const API_URL = (/^https?:\/\//i.test(RAW_API_URL) ? RAW_API_URL : "https://" + RAW_API_URL).replace(/\/$/, "");

export function deriveWsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (/^https?:\/\//i.test(API_URL)) {
    return API_URL.replace(/^http/i, "ws") + "/ws";
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

async function get(path) {
  try {
    const res = await fetch(`${API_URL}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const fetchCameras = () => get("/cameras");
export const fetchSlots = (cameraId) => get(`/cameras/${encodeURIComponent(cameraId)}/slots`);
export const fetchSummary = () => get("/summary");
export const fetchHistory = (cameraId, hours = 24) =>
  get(`/analytics/${encodeURIComponent(cameraId)}/history?hours=${hours}`);
export const fetchHealth = () => get("/health");

export const mjpegUrl = (cameraId) =>
  `${API_URL}/cameras/${encodeURIComponent(cameraId)}/stream`;

// ---- auth ----
// Unlike get(), auth calls must distinguish "backend unreachable" from
// "rejected" — status 0 means network failure, anything else is the HTTP
// status. Never throws.

async function authFetch(path, { method = "GET", body, token } = {}) {
  try {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const apiLogin = (email, password) =>
  authFetch("/auth/member/login", { method: "POST", body: { email, password } });
export const apiMe = (token) => authFetch("/auth/member/me", { token });
export const apiLogout = (token) => authFetch("/auth/member/logout", { method: "POST", token });
