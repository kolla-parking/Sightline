// Deterministic simulation engine for the digital twin.
//
// Everything derives from pure functions of (site, space, timestamp) seeded
// by stable hashes — no stored state, so any moment in the past replays
// identically (the time scrubber depends on this) and the future is a
// smooth continuation (forecasts extend the same curves).
//
// Model: each space flips occupancy on a per-space block grid (block length
// depends on site kind / space type). A block is occupied with probability
// tracking the site's demand curve at that moment. Contiguous occupied
// blocks form a "session" with a seeded vehicle identity.

import { unit, rngFor, smoothNoise, fakePlate, pick } from "../lib/seeded.js";
import { SITES, siteById } from "./sites.js";

export const HOUR = 3600_000;
export const MIN = 60_000;

/* ================= demand curves ================= */

const bell = (h, mu, sig) => Math.exp(-((h - mu) ** 2) / (2 * sig * sig));

function localParts(ts) {
  const d = new Date(ts);
  return { h: d.getHours() + d.getMinutes() / 60, dow: d.getDay(), ts };
}

function baseRate(kind, ts) {
  const { h, dow } = localParts(ts);
  const weekend = dow === 0 || dow === 6;
  switch (kind) {
    case "surface":
      return weekend
        ? 0.14 + 0.38 * bell(h, 20, 3.2) + 0.12 * bell(h, 12, 3)
        : 0.16 + 0.52 * bell(h, 10.5, 2.3) + 0.44 * bell(h, 14.6, 2.6) + 0.1 * bell(h, 19, 2);
    case "garage":
      return weekend
        ? 0.2 + 0.55 * bell(h, 21, 2.8) + 0.15 * bell(h, 13, 3)
        : 0.24 + 0.48 * bell(h, 11, 3) + 0.3 * bell(h, 19.5, 2.4);
    case "street":
      return weekend
        ? 0.1 + 0.62 * bell(h, 21.5, 2.6) + 0.2 * bell(h, 13, 2.5)
        : 0.12 + 0.3 * bell(h, 12.5, 2) + 0.5 * bell(h, 20.5, 2.6);
    case "airport": {
      // slow multi-day swell + soft daily wave
      const week = (ts / (7 * 24 * HOUR)) % 1;
      return 0.58 + 0.18 * Math.sin(week * Math.PI * 2) + 0.1 * bell(h, 9, 4);
    }
    case "truck":
      return 0.3 + 0.42 * bell(((h + 12) % 24), 14, 3.4) + 0.22 * bell(h, 13, 2.2);
    default:
      return 0.4;
  }
}

// Minute-bucketed memo — siteRate is the innermost call of every block
// walk (hundreds of thousands of hits per snapshot without a cache).
const rateCache = new Map();

export function siteRate(siteId, ts) {
  const key = `${siteId}|${(ts / 60000) | 0}`;
  const hit = rateCache.get(key);
  if (hit !== undefined) return hit;
  const site = siteById[siteId];
  const noise = smoothNoise(`${siteId}:n`, ts / HOUR / 1.7) * 0.14 - 0.07;
  const phase = unit(siteId, "phase") * 0.06 - 0.03;
  const v = Math.min(0.97, Math.max(0.04, baseRate(site.kind, ts) + noise + phase));
  if (rateCache.size > 20000) rateCache.clear();
  rateCache.set(key, v);
  return v;
}

const zoneMultCache = new Map();
function zoneMult(siteId, zone) {
  const key = `${siteId}|${zone}`;
  let v = zoneMultCache.get(key);
  if (v === undefined) {
    v = 0.88 + unit(siteId, zone, "zm") * 0.24;
    zoneMultCache.set(key, v);
  }
  return v;
}

// hour-of-day lookup without a Date allocation per block walk
const hourCache = new Map();
function hourOf(ts) {
  const key = (ts / 60000) | 0;
  let h = hourCache.get(key);
  if (h === undefined) {
    const d = new Date(ts);
    h = d.getHours() + d.getMinutes() / 60;
    if (hourCache.size > 20000) hourCache.clear();
    hourCache.set(key, h);
  }
  return h;
}

function typeMult(type, ts) {
  if (type === "ev") return hourOf(ts) > 16 ? 1.35 : 1.12;
  if (type === "ada") return 0.5;
  if (type === "reserved") return 0.62;
  return 1;
}

/* ================= per-space block model ================= */

const BLOCK_MIN = {
  surface: { standard: 70, ev: 45, ada: 130, reserved: 320, truck: 300 },
  garage: { standard: 165, ev: 60, ada: 200, reserved: 400 },
  street: { standard: 42, ev: 42, ada: 90, reserved: 60 },
  airport: { standard: 1560, ev: 900, ada: 1800, reserved: 1560 },
  truck: { standard: 420, truck: 430 },
};

export function blockLenMs(site, space) {
  const table = BLOCK_MIN[site.kind] || BLOCK_MIN.surface;
  const min = table[space.type] || table.standard;
  // ±18% per-space so the whole lot doesn't share one cycle
  return Math.round(min * (0.82 + unit(space.id, "bl") * 0.36)) * MIN;
}

function blockIndex(site, space, ts) {
  const len = blockLenMs(site, space);
  const phase = Math.floor(unit(space.id, "ph") * len);
  return { k: Math.floor((ts - phase) / len), len, phase };
}

function blockOccupied(site, space, k, len, phase) {
  const mid = k * len + phase + len / 2;
  const p = Math.min(0.99, Math.max(0.02, siteRate(site.id, mid) * zoneMult(site.id, space.zone) * typeMult(space.type, mid)));
  return unit(space.id, "b", k) < p;
}

/* ================= sessions ================= */

function sessionAround(site, space, ts) {
  const { k, len, phase } = blockIndex(site, space, ts);
  if (!blockOccupied(site, space, k, len, phase)) return null;
  let k0 = k;
  while (k - k0 < 40 && blockOccupied(site, space, k0 - 1, len, phase)) k0 -= 1;
  let k1 = k;
  while (k1 - k < 40 && blockOccupied(site, space, k1 + 1, len, phase)) k1 += 1;
  const jitterIn = unit(space.id, "ji", k0) * len * 0.3;
  const jitterOut = unit(space.id, "jo", k1) * len * 0.3;
  const start = k0 * len + phase + jitterIn;
  const end = (k1 + 1) * len + phase - jitterOut;
  if (ts < start || ts >= end) return null;
  return makeSession(site, space, k0, start, end);
}

const VEHICLE_CLASSES = {
  surface: ["sedan", "suv", "suv", "pickup", "van", "hatchback"],
  garage: ["sedan", "suv", "sedan", "hatchback", "ev sedan"],
  street: ["sedan", "hatchback", "suv", "delivery van"],
  airport: ["sedan", "suv", "suv", "van", "pickup"],
  truck: ["semi", "semi", "box truck", "flatbed"],
};

function makeSession(site, space, k0, start, end) {
  const rand = rngFor(space.id, "veh", k0);
  const limitMin = (site.limits[space.type] ?? site.limits.standard) || 240;
  const permitOk = space.type !== "reserved" ? true : rand() < 0.85;
  return {
    id: `${space.id}@${k0}`,
    siteId: site.id,
    spaceId: space.id,
    spaceLabel: space.label,
    zone: space.zone,
    level: space.level,
    type: space.type,
    plate: fakePlate(rand),
    vehicleClass: pick(rand, VEHICLE_CLASSES[site.kind] || VEHICLE_CLASSES.surface),
    confidence: 0.62 + rand() * 0.37,
    permitOk,
    start,
    end,
    limitMin,
    overstayAt: start + limitMin * MIN,
  };
}

/* ================= public: twin state ================= */

// State of one space at ts: { status, session? }
// status: free | occupied | violation | unknown
export function spaceState(site, space, ts) {
  const session = sessionAround(site, space, ts);
  if (!session) return { status: "free", session: null };
  const overstay = ts >= session.overstayAt;
  const unauthorized = !session.permitOk;
  return {
    status: overstay || unauthorized ? "violation" : "occupied",
    session,
    overstay,
    unauthorized,
  };
}

// Full site snapshot at ts. `realOverride` (from the live backend bridge)
// maps backendId -> occupied for the real site in LIVE mode.
//
// Snapshots are expensive (per-space session walks), and several surfaces
// ask for the same site at nearly the same moment — so pure-sim snapshots
// are cached on a 2s bucket. Overridden (live real-data) snapshots bypass
// the cache; only the 100-space real site uses them.
const snapCache = new Map();

export function siteSnapshot(siteId, ts, realOverride = null) {
  if (!realOverride) {
    const key = `${siteId}|${Math.floor(ts / 2000)}`;
    const hit = snapCache.get(key);
    if (hit) return hit;
    const snap = computeSnapshot(siteId, ts, null);
    if (snapCache.size > 40) snapCache.delete(snapCache.keys().next().value);
    snapCache.set(key, snap);
    return snap;
  }
  return computeSnapshot(siteId, ts, realOverride);
}

function computeSnapshot(siteId, ts, realOverride) {
  const site = siteById[siteId];
  const states = new Map();
  let occupied = 0;
  let violations = 0;
  let dwellSum = 0;
  const zoneAgg = {};
  for (const z of site.zones) zoneAgg[z.id] = { total: 0, occupied: 0, violations: 0 };

  for (const space of site.spaces) {
    let st;
    if (realOverride && space.backendId != null && realOverride.has(space.backendId)) {
      const occ = realOverride.get(space.backendId);
      st = occ
        ? { status: "occupied", session: sessionAround(site, space, ts) || makeSession(site, space, Math.floor(ts / HOUR), ts - 45 * MIN, ts + 45 * MIN), real: true }
        : { status: "free", session: null, real: true };
    } else {
      st = spaceState(site, space, ts);
    }
    states.set(space.id, st);
    const za = zoneAgg[space.zone];
    if (za) za.total += 1;
    if (st.status !== "free") {
      occupied += 1;
      if (za) za.occupied += 1;
      if (st.status === "violation") {
        violations += 1;
        if (za) za.violations += 1;
      }
      if (st.session) dwellSum += Math.max(0, ts - st.session.start);
    }
  }
  const total = site.spaces.length;
  return {
    siteId,
    ts,
    total,
    occupied,
    available: total - occupied,
    violations,
    occupancy: (occupied / total) * 100,
    avgDwellMs: occupied ? dwellSum / occupied : 0,
    zones: zoneAgg,
    states,
  };
}

/* ================= flows / series ================= */

// Arrivals + departures in [from, to) by scanning block boundaries.
export function siteFlow(siteId, from, to) {
  const site = siteById[siteId];
  let inflow = 0;
  let outflow = 0;
  for (const space of site.spaces) {
    const len = blockLenMs(site, space);
    const phase = Math.floor(unit(space.id, "ph") * len);
    const kFrom = Math.floor((from - phase) / len) - 1;
    const kTo = Math.floor((to - phase) / len) + 1;
    for (let k = kFrom; k <= kTo; k++) {
      const a = blockOccupied(site, space, k, len, phase);
      const b = blockOccupied(site, space, k + 1, len, phase);
      if (a === b) continue;
      const t = (k + 1) * len + phase;
      if (t >= from && t < to) {
        if (b) inflow += 1;
        else outflow += 1;
      }
    }
  }
  return { inflow, outflow };
}

const seriesCache = new Map();

// Occupancy series by scanning spaces (twin truth). Cached.
export function siteSeries(siteId, from, to, stepMs) {
  const key = `${siteId}|${Math.round(from / stepMs)}|${Math.round(to / stepMs)}|${stepMs}`;
  if (seriesCache.has(key)) return seriesCache.get(key);
  const site = siteById[siteId];
  const out = [];
  for (let t = from; t <= to; t += stepMs) {
    let occ = 0;
    for (const space of site.spaces) {
      const { k, len, phase } = blockIndex(site, space, t);
      if (blockOccupied(site, space, k, len, phase)) occ += 1;
    }
    out.push({ ts: t, occupied: occ, occupancy: (occ / site.spaces.length) * 100 });
  }
  if (seriesCache.size > 60) seriesCache.delete(seriesCache.keys().next().value);
  seriesCache.set(key, out);
  return out;
}

// Cheap closed-form series for portfolio / comparison charts.
export function siteRateSeries(siteId, from, to, stepMs) {
  const out = [];
  for (let t = from; t <= to; t += stepMs) {
    out.push({ ts: t, occupancy: siteRate(siteId, t) * 100 });
  }
  return out;
}

/* ================= forecast ================= */

export function siteForecast(siteId, from, hours = 12, stepMs = 15 * MIN) {
  const out = [];
  for (let t = from; t <= from + hours * HOUR; t += stepMs) {
    const horizonH = (t - from) / HOUR;
    const band = 2.5 + horizonH * 1.15; // pct points, widens with horizon
    const mid = siteRate(siteId, t) * 100;
    out.push({
      ts: t,
      mid,
      lo: Math.max(0, mid - band),
      hi: Math.min(100, mid + band),
    });
  }
  return out;
}

/* ================= sessions list ================= */

export function siteSessions(siteId, from, to, { limit = 400 } = {}) {
  const site = siteById[siteId];
  const sessions = [];
  for (const space of site.spaces) {
    const len = blockLenMs(site, space);
    const phase = Math.floor(unit(space.id, "ph") * len);
    let k = Math.floor((from - phase) / len) - 1;
    const kEnd = Math.floor((to - phase) / len) + 1;
    while (k <= kEnd) {
      if (blockOccupied(site, space, k, len, phase)) {
        let k1 = k;
        while (k1 <= kEnd + 40 && blockOccupied(site, space, k1 + 1, len, phase)) k1 += 1;
        const jitterIn = unit(space.id, "ji", k) * len * 0.3;
        const jitterOut = unit(space.id, "jo", k1) * len * 0.3;
        const start = k * len + phase + jitterIn;
        const end = (k1 + 1) * len + phase - jitterOut;
        if (end > from && start < to) sessions.push(makeSession(site, space, k, start, end));
        k = k1 + 2;
      } else {
        k += 1;
      }
    }
  }
  sessions.sort((a, b) => b.start - a.start);
  return sessions.slice(0, limit);
}

/* ================= cameras ================= */

// Simulated cameras drop offline occasionally (seeded per camera per day).
export function cameraHealth(siteId, camId, ts) {
  const day = Math.floor(ts / (24 * HOUR));
  for (const d of [day - 1, day]) {
    if (unit(camId, "off", d) < 0.22) {
      const start = d * 24 * HOUR + Math.floor(unit(camId, "offs", d) * 22 * HOUR);
      const durMs = (8 + unit(camId, "offd", d) * 34) * MIN;
      if (ts >= start && ts < start + durMs) {
        return { online: false, since: start, until: start + durMs };
      }
    }
  }
  const fps = 4 + Math.round(smoothNoise(`${camId}:fps`, ts / MIN / 8) * 4);
  const latency = 90 + Math.round(smoothNoise(`${camId}:lat`, ts / MIN / 5) * 220);
  return { online: true, fps, latencyMs: latency };
}

/* ================= events + alerts ================= */

const EVENT_KIND = {
  arrival: { label: "Arrival", sev: "info" },
  departure: { label: "Departure", sev: "info" },
  overstay: { label: "Overstay", sev: "warn" },
  unauthorized: { label: "Unauthorized use", sev: "danger" },
  double_park: { label: "Double parking", sev: "danger" },
  camera_offline: { label: "Camera offline", sev: "warn" },
  camera_online: { label: "Camera recovered", sev: "info" },
  congestion: { label: "Congestion risk", sev: "warn" },
};

export function eventMeta(kind) {
  return EVENT_KIND[kind] || { label: kind, sev: "info" };
}

// All events for a site in [from, to], newest first.
export function siteEvents(siteId, from, to, { includeFlow = true, limit = 500 } = {}) {
  const site = siteById[siteId];
  const events = [];
  const push = (e) => events.push(e);

  const sessions = siteSessions(siteId, from - 2 * HOUR, to, { limit: 5000 });
  for (const s of sessions) {
    if (includeFlow && s.start >= from && s.start <= to) {
      push({ id: `${s.id}:in`, ts: s.start, kind: "arrival", siteId, spaceId: s.spaceId, spaceLabel: s.spaceLabel, zone: s.zone, plate: s.plate, session: s });
    }
    if (includeFlow && s.end >= from && s.end <= to) {
      push({ id: `${s.id}:out`, ts: s.end, kind: "departure", siteId, spaceId: s.spaceId, spaceLabel: s.spaceLabel, zone: s.zone, plate: s.plate, session: s });
    }
    if (s.overstayAt >= from && s.overstayAt <= to && s.overstayAt < s.end) {
      push({ id: `${s.id}:ov`, ts: s.overstayAt, kind: "overstay", siteId, spaceId: s.spaceId, spaceLabel: s.spaceLabel, zone: s.zone, plate: s.plate, session: s });
    }
    if (!s.permitOk && s.start >= from && s.start <= to) {
      push({ id: `${s.id}:ua`, ts: s.start + 4 * MIN, kind: "unauthorized", siteId, spaceId: s.spaceId, spaceLabel: s.spaceLabel, zone: s.zone, plate: s.plate, session: s });
    }
  }

  // double parking — seeded per site-hour
  for (let hb = Math.floor(from / HOUR); hb <= Math.floor(to / HOUR); hb++) {
    if (unit(siteId, "dp", hb) < 0.09) {
      const ts = hb * HOUR + Math.floor(unit(siteId, "dpt", hb) * HOUR);
      if (ts < from || ts > to) continue;
      const rand = rngFor(siteId, "dpv", hb);
      const space = pick(rand, site.spaces);
      push({
        id: `${siteId}:dp:${hb}`,
        ts,
        kind: "double_park",
        siteId,
        spaceId: space.id,
        spaceLabel: space.label,
        zone: space.zone,
        plate: fakePlate(rand),
        durationMs: (6 + rand() * 18) * MIN,
      });
    }
  }

  // camera windows
  for (const cam of site.cameras) {
    if (cam.real) continue;
    for (let d = Math.floor(from / (24 * HOUR)) - 1; d <= Math.floor(to / (24 * HOUR)); d++) {
      if (unit(cam.id, "off", d) < 0.22) {
        const start = d * 24 * HOUR + Math.floor(unit(cam.id, "offs", d) * 22 * HOUR);
        const durMs = (8 + unit(cam.id, "offd", d) * 34) * MIN;
        if (start >= from && start <= to) {
          push({ id: `${cam.id}:off:${d}`, ts: start, kind: "camera_offline", siteId, cameraId: cam.id, cameraName: cam.name, durationMs: durMs });
        }
        if (start + durMs >= from && start + durMs <= to) {
          push({ id: `${cam.id}:on:${d}`, ts: start + durMs, kind: "camera_online", siteId, cameraId: cam.id, cameraName: cam.name });
        }
      }
    }
  }

  // congestion crossings (rate crossing 0.92 upward)
  let prev = siteRate(siteId, from - 10 * MIN);
  for (let t = from; t <= to; t += 10 * MIN) {
    const r = siteRate(siteId, t);
    if (prev < 0.92 && r >= 0.92) {
      push({ id: `${siteId}:cg:${t}`, ts: t, kind: "congestion", siteId, occupancy: r * 100 });
    }
    prev = r;
  }

  events.sort((a, b) => b.ts - a.ts);
  return events.slice(0, limit);
}

// Active alerts across sites at `ts` (twin "now" or replay cursor).
// Cached on a 10s bucket — the shell badge, twin rail, and events page all
// ask for this constantly.
const alertsCache = new Map();

export function activeAlerts(ts, siteIds = SITES.map((s) => s.id), realCamStatus = null) {
  const key = `${Math.floor(ts / 10000)}|${siteIds.join(",")}|${realCamStatus?.status || ""}`;
  const hit = alertsCache.get(key);
  if (hit) return hit;
  const alerts = computeAlerts(ts, siteIds, realCamStatus);
  if (alertsCache.size > 20) alertsCache.delete(alertsCache.keys().next().value);
  alertsCache.set(key, alerts);
  return alerts;
}

function computeAlerts(ts, siteIds, realCamStatus) {
  const alerts = [];
  for (const siteId of siteIds) {
    const site = siteById[siteId];
    const snap = siteSnapshot(siteId, ts);

    for (const space of site.spaces) {
      const st = snap.states.get(space.id);
      if (!st || !st.session) continue;
      if (st.overstay) {
        const overMs = ts - st.session.overstayAt;
        alerts.push({
          id: `ov:${st.session.id}`,
          kind: "overstay",
          sev: overMs > 45 * MIN ? "danger" : "warn",
          siteId,
          spaceId: space.id,
          spaceLabel: space.label,
          zone: space.zone,
          plate: st.session.plate,
          since: st.session.overstayAt,
          detail: `${space.label} over limit — parked ${Math.round((ts - st.session.start) / MIN)}m, limit ${st.session.limitMin}m`,
          session: st.session,
        });
      } else if (st.unauthorized) {
        alerts.push({
          id: `ua:${st.session.id}`,
          kind: "unauthorized",
          sev: "danger",
          siteId,
          spaceId: space.id,
          spaceLabel: space.label,
          zone: space.zone,
          plate: st.session.plate,
          since: st.session.start,
          detail: `${space.label} reserved — no matching permit for ${st.session.plate}`,
          session: st.session,
        });
      }
    }

    for (const cam of site.cameras) {
      if (cam.real) {
        if (realCamStatus && realCamStatus.status && realCamStatus.status !== "connected") {
          alerts.push({
            id: `cam:${cam.id}`,
            kind: "camera_offline",
            sev: "danger",
            siteId,
            cameraId: cam.id,
            cameraName: cam.name,
            since: ts,
            detail: `${cam.name} — backend reports "${realCamStatus.status}"`,
          });
        }
        continue;
      }
      const h = cameraHealth(siteId, cam.id, ts);
      if (!h.online) {
        alerts.push({
          id: `cam:${cam.id}:${h.since}`,
          kind: "camera_offline",
          sev: "warn",
          siteId,
          cameraId: cam.id,
          cameraName: cam.name,
          since: h.since,
          detail: `${cam.name} offline — no frames since ${new Date(h.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        });
      }
    }

    const rate = snap.occupancy / 100;
    if (rate >= 0.9) {
      alerts.push({
        id: `cg:${siteId}`,
        kind: "congestion",
        sev: rate >= 0.95 ? "danger" : "warn",
        siteId,
        since: ts,
        detail: `${site.name} at ${Math.round(snap.occupancy)}% — circulation risk`,
      });
    }

    const evSpaces = site.spaces.filter((s) => s.type === "ev");
    if (evSpaces.length) {
      const evOcc = evSpaces.filter((s) => snap.states.get(s.id)?.status !== "free").length;
      if (evOcc === evSpaces.length) {
        alerts.push({
          id: `ev:${siteId}`,
          kind: "charger_contention",
          sev: "warn",
          siteId,
          since: ts,
          detail: `All ${evSpaces.length} EV chargers occupied at ${site.name}`,
        });
      }
    }
  }
  const sevRank = { danger: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || b.since - a.since);
  return alerts;
}

/* ================= predictions ================= */

export function predictedIssues(ts, siteIds = SITES.map((s) => s.id)) {
  const issues = [];
  for (const siteId of siteIds) {
    const site = siteById[siteId];
    // full-zone risk: first future crossing of 95%
    for (let t = ts; t <= ts + 8 * HOUR; t += 15 * MIN) {
      if (siteRate(siteId, t) >= 0.95) {
        issues.push({
          id: `full:${siteId}`,
          kind: "zone_full",
          sev: t - ts < 90 * MIN ? "danger" : "warn",
          siteId,
          eta: t,
          detail: `${site.name} projected ≥95% by ${new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        });
        break;
      }
    }
    // overstay pressure: sessions within 25% of limit
    const snap = siteSnapshot(siteId, ts);
    let nearLimit = 0;
    for (const st of snap.states.values()) {
      if (st.session && !st.overstay && ts > st.session.overstayAt - st.session.limitMin * MIN * 0.25) nearLimit += 1;
    }
    if (nearLimit >= 3) {
      issues.push({
        id: `ovp:${siteId}`,
        kind: "overstay_pressure",
        sev: "warn",
        siteId,
        eta: ts + 30 * MIN,
        detail: `${nearLimit} vehicles at ${site.name} within 25% of time limit`,
      });
    }
    // EV contention ahead (evening ramp)
    const evSpaces = site.spaces.filter((s) => s.type === "ev");
    if (evSpaces.length >= 3 && localHour(ts) >= 14 && localHour(ts) <= 18) {
      issues.push({
        id: `evp:${siteId}`,
        kind: "charger_contention",
        sev: "info",
        siteId,
        eta: ts + 3 * HOUR,
        detail: `EV demand at ${site.name} typically exceeds chargers after 17:00`,
      });
    }
  }
  const sevRank = { danger: 0, warn: 1, info: 2 };
  issues.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || a.eta - b.eta);
  return issues;
}

function localHour(ts) {
  return new Date(ts).getHours();
}

/* ================= revenue ================= */

export function siteRevenueToday(siteId, ts) {
  const site = siteById[siteId];
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  let rev = 0;
  for (let t = d.getTime(); t < ts; t += HOUR) {
    rev += siteRate(siteId, t) * site.spaces.length * site.rate * 0.82;
  }
  return rev;
}

/* ================= search ================= */

export function findPlate(query, ts, { hours = 48 } = {}) {
  const q = query.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (q.length < 2) return [];
  const hits = [];
  for (const site of SITES) {
    const sessions = siteSessions(site.id, ts - hours * HOUR, ts, { limit: 3000 });
    for (const s of sessions) {
      if (s.plate.replace(/[^A-Z0-9]/g, "").includes(q)) hits.push(s);
    }
  }
  hits.sort((a, b) => b.start - a.start);
  return hits.slice(0, 50);
}
