// Global app store (zustand). One store, flat and explicit.
//
// Time model: the twin renders at `twinTime(state)` — live "now" when
// mode==="live", or the frozen `cursor` when scrubbing/replaying. All sim
// queries take that timestamp, so every page follows the scrubber.

import { create } from "zustand";
import { SITES } from "../sim/sites.js";

const CASES_KEY = "sightline.cases.v1";
const SETTINGS_KEY = "sightline.settings.v1";
const AUTH_KEY = "sightline.auth.v1";

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

const defaultSettings = {
  overstayGraceMin: 10,
  congestionPct: 90,
  mapStyle: "map", // "map" | "schematic"
  refreshSec: 5,
  showFlow: true,
  density: "dense",
  theme: "system", // "system" | "light" | "dark" — explicit choices are
  // mirrored as data-theme on <html>; "system" (or any legacy value)
  // leaves the attribute off so CSS follows prefers-color-scheme.
};

export const useStore = create((set, get) => ({
  /* ---- clock ---- */
  now: Date.now(),
  mode: "live", // "live" | "replay"
  cursor: Date.now(),
  playSpeed: 0, // replay playback: 0 paused, else x-multiplier

  /* ---- scope ---- */
  scope: "portfolio", // "portfolio" | siteId

  /* ---- real backend bridge ---- */
  realOccupancy: null, // Map(backendId -> occupied) | null when backend down
  realSummary: null, // camera summary row from backend
  backendUp: false,
  wsStatus: "connecting",

  /* ---- ui ---- */
  selectedSpaceId: null,
  selectedPlate: null, // plate string opens the Vehicle drawer; null closes
  drawer: null, // { type: "space"|"alert"|"case"|"session", ... }
  paletteOpen: false,
  copilotOpen: false,
  ackAlerts: new Set(),
  toasts: [],

  /* ---- copilot ---- */
  copilotMessages: [],

  /* ---- enforcement ---- */
  cases: loadJSON(CASES_KEY, []),

  /* ---- settings ---- */
  settings: { ...defaultSettings, ...loadJSON(SETTINGS_KEY, {}) },

  /* ---- auth ---- */
  authToken: loadJSON(AUTH_KEY, {}).token || null,
  authStatus: "checking", // "checking" | "authed" | "anon"
  authUser: null, // member row from /auth/member/me (null until verified)

  /* ================= actions ================= */

  tick: () => set({ now: Date.now() }),

  setScope: (scope) => set({ scope, selectedSpaceId: null, drawer: null }),

  setMode: (mode) =>
    set((s) => ({
      mode,
      playSpeed: 0,
      cursor: mode === "replay" ? s.cursor || s.now : s.cursor,
    })),

  setCursor: (cursor) => set({ cursor, mode: "replay", playSpeed: 0 }),

  jumpLive: () => set({ mode: "live", playSpeed: 0, cursor: Date.now() }),

  setPlaySpeed: (playSpeed) => set({ playSpeed, mode: "replay" }),

  advanceCursor: (ms) =>
    set((s) => {
      const next = s.cursor + ms;
      if (next >= Date.now()) return { mode: "live", playSpeed: 0, cursor: Date.now() };
      return { cursor: next };
    }),

  selectSpace: (selectedSpaceId) => set({ selectedSpaceId }),

  selectPlate: (plate) => set({ selectedPlate: plate }),

  openDrawer: (drawer) => set({ drawer }),
  closeDrawer: () => set({ drawer: null, selectedSpaceId: null }),

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setCopilotOpen: (copilotOpen) => set({ copilotOpen }),

  ackAlert: (id) =>
    set((s) => {
      const ack = new Set(s.ackAlerts);
      ack.add(id);
      return { ackAlerts: ack };
    }),

  addToast: (text, sev = "info") => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, text, sev }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },

  /* ---- bridge ---- */
  setRealData: ({ occupancy, summary, backendUp, wsStatus }) =>
    set((s) => ({
      realOccupancy: occupancy !== undefined ? occupancy : s.realOccupancy,
      realSummary: summary !== undefined ? summary : s.realSummary,
      backendUp: backendUp !== undefined ? backendUp : s.backendUp,
      wsStatus: wsStatus !== undefined ? wsStatus : s.wsStatus,
    })),

  /* ---- copilot ---- */
  pushCopilot: (msg) => set((s) => ({ copilotMessages: [...s.copilotMessages, msg] })),
  clearCopilot: () => set({ copilotMessages: [] }),

  /* ---- enforcement cases ---- */
  createCase: (payload) => {
    const c = {
      id: `C-${String(get().cases.length + 1).padStart(4, "0")}`,
      status: "open",
      createdAt: Date.now(),
      notes: [],
      ...payload,
    };
    const cases = [c, ...get().cases];
    saveJSON(CASES_KEY, cases);
    set({ cases });
    return c;
  },

  updateCase: (id, patch) => {
    const cases = get().cases.map((c) => (c.id === id ? { ...c, ...patch } : c));
    saveJSON(CASES_KEY, cases);
    set({ cases });
  },

  addCaseNote: (id, text) => {
    const cases = get().cases.map((c) =>
      c.id === id ? { ...c, notes: [...c.notes, { ts: Date.now(), text }] } : c,
    );
    saveJSON(CASES_KEY, cases);
    set({ cases });
  },

  /* ---- settings ---- */
  setSetting: (key, value) => {
    const settings = { ...get().settings, [key]: value };
    saveJSON(SETTINGS_KEY, settings);
    set({ settings });
  },

  /* ---- auth ---- */
  setAuth: ({ token, user }) => {
    saveJSON(AUTH_KEY, { token });
    set({ authToken: token, authUser: user || null, authStatus: "authed" });
  },

  clearAuth: () => {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* storage unavailable */
    }
    set({ authToken: null, authUser: null, authStatus: "anon" });
  },
}));

// dev console access: window.sightlineStore.getState()
if (typeof window !== "undefined") window.sightlineStore = useStore;

/* ================= selectors / helpers ================= */

export const twinTime = (s) => (s.mode === "live" ? s.now : s.cursor);

export const scopedSites = (s) =>
  s.scope === "portfolio" ? SITES : SITES.filter((x) => x.id === s.scope);

export const useTwinTime = () => useStore(twinTime);
