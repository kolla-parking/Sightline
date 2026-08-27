// REST client for the real Sightline backend. Every call fails soft —
// the dashboard must stay fully usable when the backend is down.

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");

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
