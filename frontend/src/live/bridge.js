// Live bridge to the real Sightline backend.
//
// Opens the backend WebSocket (with backoff reconnect), seeds initial state
// over REST, and feeds the store: a Map of backendId -> occupied for the
// real site, plus the camera summary row. Everything fails soft — if the
// backend is down the twin keeps running on simulation alone.

import { deriveWsUrl, fetchSummary, fetchSlots, fetchHealth } from "../lib/api.js";
import { useStore } from "../store/useStore.js";

let started = false;

export function startBridge() {
  if (started) return;
  started = true;

  const setRealData = (patch) => useStore.getState().setRealData(patch);

  // ---- initial REST seed + health polling ----
  async function seed() {
    const health = await fetchHealth();
    setRealData({ backendUp: !!health });
    if (!health) return;
    const [summary, slots] = await Promise.all([fetchSummary(), fetchSlots("cam1")]);
    if (summary?.length) setRealData({ summary: summary[0] });
    // GET /cameras/:id/slots returns a bare array of slots
    const slotArr = Array.isArray(slots) ? slots : slots?.slots;
    if (slotArr?.length) {
      const occ = new Map();
      for (const s of slotArr) occ.set(s.slot_id, !!s.occupied);
      setRealData({ occupancy: occ });
    }
  }
  seed();
  setInterval(async () => {
    const health = await fetchHealth();
    const up = !!health;
    if (up !== useStore.getState().backendUp) setRealData({ backendUp: up });
    if (up && !useStore.getState().realOccupancy) seed();
  }, 15000);

  // ---- websocket ----
  let retry = 0;
  function connect() {
    let ws;
    try {
      ws = new WebSocket(deriveWsUrl());
    } catch {
      scheduleReconnect();
      return;
    }
    setRealData({ wsStatus: "connecting" });

    ws.onopen = () => {
      retry = 0;
      setRealData({ wsStatus: "connected" });
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "occupancy_update" && msg.camera_id === "cam1" && Array.isArray(msg.slots)) {
        const occ = new Map();
        for (const s of msg.slots) occ.set(s.slot_id, !!s.occupied);
        setRealData({ occupancy: occ, backendUp: true });
        if (Array.isArray(msg.summary) && msg.summary.length) {
          setRealData({ summary: msg.summary.find((c) => c.camera_id === "cam1") || msg.summary[0] });
        }
      } else if (msg.type === "full_state" && msg.cameras?.cam1) {
        // full_state sends cameras.cam1 as a bare slot array
        const arr = Array.isArray(msg.cameras.cam1) ? msg.cameras.cam1 : msg.cameras.cam1.slots;
        if (arr?.length) {
          const occ = new Map();
          for (const s of arr) occ.set(s.slot_id, !!s.occupied);
          setRealData({ occupancy: occ, backendUp: true });
        }
      }
    };

    ws.onclose = () => {
      setRealData({ wsStatus: "reconnecting" });
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
  }

  function scheduleReconnect() {
    const delay = Math.min(1200 * 2 ** retry, 12000);
    retry += 1;
    setTimeout(connect, delay);
  }

  connect();

  // ---- clock tick (drives live twin re-render) ----
  setInterval(() => {
    const s = useStore.getState();
    s.tick();
    if (s.mode === "replay" && s.playSpeed > 0) {
      s.advanceCursor(s.playSpeed * 1000);
    }
  }, 1000);
}
