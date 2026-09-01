// Sightline Copilot — deterministic natural-language engine over the twin.
//
// No LLM: intent parsing via patterns, answers computed from the same sim
// engine the twin renders. Swappable later for a real model with the same
// response contract.
//
// ============================ RESPONSE CONTRACT ============================
//
// askCopilot(query, ctx) -> { intent, text, blocks, error? }
//   ctx = { ts, realOccupancy, realSummary, scope? }  (scope: "portfolio"|siteId)
//   text   — plain sentence(s), may contain \n
//   error  — true when the intent threw; UI shows the failure treatment
//   blocks — array of typed payloads the panel renders in order:
//
//   { type: "stats",  items: [{ label, value }] }
//       value: Cell (see below)
//   { type: "table",  columns: [string], rows: [{ [column]: Cell }] }
//   { type: "series",   label, series: [{ ts, v }] }
//   { type: "forecast", label, series: [{ ts, mid, lo, hi }] }
//   { type: "action", text }
//       one-line recommended next step, rendered as a quiet callout
//
//   Cell = string
//        | { text, plate }                  -> opens the Vehicle drawer
//                                              (selectPlate — works everywhere)
//        | { text, siteId }                 -> scopes to the site + /twin
//        | { text, siteId, spaceId }        -> scopes + selects the space + /twin
//   Plain-string cells always keep working; refs are additive. Ref cells with
//   a plate or spaceId render in mono (they are IDs); site refs render in the
//   UI face. The panel resolves refs via optional-chained store actions so
//   either package builds standalone.
//
// copilotDigest(ctx) -> [{ id, value, text, meta?, query }]
//   2–4 one-line "right now" insights for the empty-thread state. `value` and
//   `meta` are mono (a count, clock, or delta); `query` is the full question
//   submitting the insight resolves to. Empty array = all quiet.
//
// Determinism: everything derives from ctx.ts + seeded engine queries — no
// Date.now()/Math.random() in this module. findPlate scans 48h across all
// sites, so it is memoized here on (plate, 5s bucket) — never call it in a
// render loop.
// ===========================================================================

import { SITES, siteById, KIND_LABEL } from "./sites.js";
import {
  siteSnapshot,
  siteEvents,
  siteFlow,
  activeAlerts,
  predictedIssues,
  siteForecast,
  siteRate,
  siteRevenueToday,
  findPlate,
  siteSeries,
  LOW_CONFIDENCE,
  HOUR,
  MIN,
} from "./engine.js";
import { fmtClock, fmtDuration, fmtMoney, fmtDay } from "../lib/format.js";

/* ---------- confidence line ---------- */

// Sessions under this detection confidence are treated as unverified.
// Alias of the engine's LOW_CONFIDENCE — one number, used everywhere.
export const CONF_LINE = LOW_CONFIDENCE;
const fmtConf = (c) => c.toFixed(2);

/* ---------- refs ---------- */

const plateRef = (plate) => ({ text: plate, plate });
const siteRef = (siteId) => ({ text: siteById[siteId].name, siteId });
const spaceRef = (siteId, spaceId, label) => ({ text: label, siteId, spaceId });

/* ---------- helpers ---------- */

function matchSite(q) {
  const lower = q.toLowerCase();
  for (const site of SITES) {
    const words = site.name.toLowerCase().split(/\s+/);
    if (lower.includes(site.name.toLowerCase())) return site;
    if (words.some((w) => w.length > 4 && lower.includes(w))) return site;
    if (lower.includes(site.id)) return site;
  }
  if (/\bairport\b/.test(lower)) return siteById["airport-a"];
  if (/\bgarage\b/.test(lower)) return siteById["riverside-garage"];
  if (/\bstreet\b/.test(lower)) return siteById["fifth-street"];
  if (/\btruck|yard\b/.test(lower)) return siteById["northgate-yard"];
  if (/\bsample|lot 1\b/.test(lower)) return siteById["sample-lot"];
  return null;
}

// Sites the answer should cover: named site > single-site scope > all.
function scopedIds(q, ctx) {
  const site = matchSite(q);
  if (site) return [site.id];
  if (ctx.scope && ctx.scope !== "portfolio") return [ctx.scope];
  return SITES.map((s) => s.id);
}

function scopeLabel(ids) {
  return ids.length === 1 ? siteById[ids[0]].name : "all sites";
}

// "yesterday after 6pm", "last 2 hours", "this morning" -> [from, to]
function matchRange(q, now) {
  const lower = q.toLowerCase();
  const dayStart = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  let m;
  if ((m = lower.match(/last\s+(\d+)\s*h/))) return [now - +m[1] * HOUR, now];
  if ((m = lower.match(/last\s+(\d+)\s*m(in)?/))) return [now - +m[1] * MIN, now];
  if (lower.includes("yesterday")) {
    const y0 = dayStart(now) - 24 * HOUR;
    let from = y0;
    let to = y0 + 24 * HOUR;
    if ((m = lower.match(/after\s+(\d{1,2})\s*(am|pm)?/))) {
      let h = +m[1];
      if (m[2] === "pm" && h < 12) h += 12;
      from = y0 + h * HOUR;
    }
    if ((m = lower.match(/before\s+(\d{1,2})\s*(am|pm)?/))) {
      let h = +m[1];
      if (m[2] === "pm" && h < 12) h += 12;
      to = y0 + h * HOUR;
    }
    return [from, to];
  }
  if (lower.includes("this morning")) return [dayStart(now) + 6 * HOUR, Math.min(now, dayStart(now) + 12 * HOUR)];
  if (lower.includes("today")) return [dayStart(now), now];
  if (lower.includes("this week")) return [dayStart(now) - 6 * 24 * HOUR, now];
  if ((m = lower.match(/after\s+(\d{1,2})\s*(am|pm)?/))) {
    let h = +m[1];
    if (m[2] === "pm" && h < 12) h += 12;
    return [dayStart(now) + h * HOUR, now];
  }
  return [now - 6 * HOUR, now];
}

const PLATE_RE = /[A-Z]{2,3}-?\d{2,4}/;

const nth = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

function sessionStatus(s, ts) {
  if (ts >= s.overstayAt && (!s.end || s.end > ts)) return "OVERSTAY";
  if (!s.permitOk) return "NO PERMIT";
  return s.end < ts ? "departed" : "parked";
}

const sessionRows = (list, ts) =>
  list.map((s) => ({
    plate: plateRef(s.plate),
    space: spaceRef(s.siteId, s.spaceId, s.spaceLabel),
    site: siteRef(s.siteId),
    zone: s.zone,
    arrived: fmtClock(s.start),
    dwell: fmtDuration((s.end && s.end < ts ? s.end : ts) - s.start),
    status: sessionStatus(s, ts),
  }));

// A past session overstayed if it crossed its limit before it ended.
const didOverstay = (s, ts) => s.overstayAt < Math.min(s.end, ts);

/* ---------- memoized plate history (findPlate is a 48h all-site scan) ---- */

const plateHistCache = new Map();

export function plateHistory(plate, ts) {
  const key = `${plate}|${Math.floor(ts / 5000)}`;
  const hit = plateHistCache.get(key);
  if (hit) return hit;
  const sessions = findPlate(plate, ts, { hours: 48 });
  if (plateHistCache.size > 30) plateHistCache.delete(plateHistCache.keys().next().value);
  plateHistCache.set(key, sessions);
  return sessions;
}

/* ---------- explain: evidence chains ---------- */

function zoneName(siteId, zoneId) {
  const z = siteById[siteId].zones.find((x) => x.id === zoneId);
  return z ? z.name : zoneId;
}

function pickAlertFromQuery(q, ctx) {
  const site = matchSite(q);
  const alerts = activeAlerts(ctx.ts, undefined, ctx.realSummary);
  let pool = site ? alerts.filter((a) => a.siteId === site.id) : alerts;
  if (!site && ctx.scope && ctx.scope !== "portfolio") {
    const scoped = pool.filter((a) => a.siteId === ctx.scope);
    if (scoped.length) pool = scoped;
  }
  const upper = q.toUpperCase();
  const plateM = upper.match(PLATE_RE);
  if (plateM) {
    const norm = plateM[0].replace(/[^A-Z0-9]/g, "");
    const byPlate = pool.find((a) => a.plate && a.plate.replace(/[^A-Z0-9]/g, "").includes(norm));
    if (byPlate) return byPlate;
  }
  const spaceM = upper.replace(plateM ? plateM[0] : "", "").match(/\b([A-Z]?\d{3})\b/);
  if (spaceM) {
    const bySpace = pool.find((a) => a.spaceLabel && a.spaceLabel.toUpperCase().includes(spaceM[1].toUpperCase()));
    if (bySpace) return bySpace;
  }
  return pool[0] || null; // pool is already severity-sorted
}

function confidenceCell(session) {
  const c = session.confidence;
  return c < CONF_LINE ? `${fmtConf(c)} — under ${fmtConf(CONF_LINE)}, unverified` : fmtConf(c);
}

function historyCell(plate, ts) {
  const hist = plateHistory(plate, ts);
  const ov = hist.filter((s) => didOverstay(s, ts)).length;
  const ua = hist.filter((s) => !s.permitOk).length;
  let txt = `${hist.length} session${hist.length === 1 ? "" : "s"} in 48h`;
  if (ov) txt += ` · ${nth(ov)} overstay in the window`;
  if (ua) txt += ` · ${ua} no-permit`;
  return { txt, ov, ua };
}

function explainAlert(a, ctx) {
  const site = siteById[a.siteId];
  const ts = ctx.ts;
  const rows = [];
  const row = (evidence, value) => rows.push({ evidence, value });
  let verdict = "";
  let action = "";
  const s = a.session;

  if (a.kind === "overstay" && s) {
    const parked = ts - s.start;
    const over = ts - s.overstayAt;
    verdict = `Overstay — ${s.plate} has been in ${s.spaceLabel} at ${site.name} for ${fmtDuration(parked)} against a ${s.limitMin}m posted limit.`;
    row("Trigger", `dwell ${fmtDuration(parked)} > limit ${s.limitMin}m (${fmtDuration(over)} over)`);
    row("Space", spaceRef(s.siteId, s.spaceId, `${s.spaceLabel} · ${zoneName(s.siteId, s.zone)}`));
    row("Site", siteRef(s.siteId));
    row("Arrived", `${fmtDay(s.start)} ${fmtClock(s.start)}`);
    row("Plate", plateRef(s.plate));
    row("Confidence", confidenceCell(s));
    const h = historyCell(s.plate, ts);
    row("History (48h)", h.txt);
    action =
      s.confidence < CONF_LINE
        ? `Verify the camera evidence first — detection confidence ${fmtConf(s.confidence)} is under the ${fmtConf(CONF_LINE)} line.`
        : h.ov >= 2
          ? `Repeat overstay for this plate — dispatch enforcement to ${s.spaceLabel}.`
          : `Dispatch enforcement to ${s.spaceLabel}, or waive from the space drawer if the stay is authorized.`;
  } else if (a.kind === "unauthorized" && s) {
    verdict = `Unauthorized use — ${s.plate} is in reserved space ${s.spaceLabel} at ${site.name} with no matching permit on file.`;
    row("Trigger", "reserved space · no matching permit on file");
    row("Space", spaceRef(s.siteId, s.spaceId, `${s.spaceLabel} · ${zoneName(s.siteId, s.zone)}`));
    row("Site", siteRef(s.siteId));
    row("Arrived", `${fmtDay(s.start)} ${fmtClock(s.start)}`);
    row("Plate", plateRef(s.plate));
    row("Confidence", confidenceCell(s));
    const h = historyCell(s.plate, ts);
    row("History (48h)", h.txt);
    action =
      s.confidence < CONF_LINE
        ? `Verify the camera evidence first — detection confidence ${fmtConf(s.confidence)} is under the ${fmtConf(CONF_LINE)} line.`
        : `Dispatch, or attach a permit to this plate if it is a known vehicle.`;
  } else if (a.kind === "camera_offline") {
    verdict = `Camera offline — ${a.cameraName} at ${site.name} has sent no frames since ${fmtClock(a.since)}.`;
    row("Trigger", `no frames received since ${fmtClock(a.since)}`);
    row("Camera", a.cameraName);
    row("Down for", fmtDuration(ts - a.since));
    row("Site", siteRef(a.siteId));
    row("Coverage", "covered spaces hold last-known state — marked stale, not guessed");
    action = `Check power and network at ${a.cameraName}. Covered spaces stay on last-known state until frames return.`;
  } else if (a.kind === "congestion") {
    const snap = siteSnapshot(a.siteId, ts, site.real ? ctx.realOccupancy : null);
    const flow = siteFlow(a.siteId, ts - 30 * MIN, ts);
    verdict = `Congestion risk — ${site.name} is at ${Math.round(snap.occupancy)}%, over the 90% circulation threshold.`;
    row("Trigger", `occupancy ${Math.round(snap.occupancy)}% ≥ 90% threshold`);
    row("Available", `${snap.available} of ${snap.total} spaces`);
    row("Flow (last 30m)", `${flow.inflow} in / ${flow.outflow} out`);
    row("Site", siteRef(a.siteId));
    action =
      flow.inflow > flow.outflow
        ? "Inflow still exceeds outflow — consider redirecting arrivals or posting full signage."
        : "Outflow has caught up with inflow — pressure should ease without action.";
  } else if (a.kind === "charger_contention") {
    const snap = siteSnapshot(a.siteId, ts, site.real ? ctx.realOccupancy : null);
    const evSpaces = site.spaces.filter((x) => x.type === "ev");
    let longest = 0;
    for (const sp of evSpaces) {
      const st = snap.states.get(sp.id);
      if (st?.session) longest = Math.max(longest, ts - st.session.start);
    }
    verdict = `Charger contention — all ${evSpaces.length} EV chargers at ${site.name} are occupied.`;
    row("Trigger", `${evSpaces.length} of ${evSpaces.length} EV spaces occupied`);
    row("Longest session", fmtDuration(longest));
    row("Site", siteRef(a.siteId));
    action = "Enable a charger time limit or open overflow charging for the evening ramp.";
  } else {
    verdict = `${site.name} — ${a.detail}`;
    row("Trigger", a.detail);
    row("Site", siteRef(a.siteId));
    action = "Review the alert in the Alerts view.";
  }

  return {
    text: verdict,
    blocks: [
      { type: "table", columns: ["evidence", "value"], rows },
      { type: "action", text: action },
    ],
  };
}

/* ---------- intents ---------- */

const INTENTS = [
  {
    id: "history",
    test: (q) => /\b(history|journey|trail)\b/i.test(q),
    run(q, ctx) {
      const m = q.toUpperCase().match(PLATE_RE);
      if (!m) {
        return {
          text: "Give me a plate (e.g. “history of KRT-4021”) and I'll pull every session for it across all sites in the last 48h. Clicking a plate anywhere in an answer does the same.",
          blocks: [],
        };
      }
      const hits = plateHistory(m[0], ctx.ts);
      if (!hits.length) return { text: `No sessions matching “${m[0]}” anywhere in the last 48h.`, blocks: [] };
      const siteCount = new Set(hits.map((s) => s.siteId)).size;
      const ov = hits.filter((s) => didOverstay(s, ctx.ts)).length;
      const ua = hits.filter((s) => !s.permitOk).length;
      const active = hits.find((s) => s.start <= ctx.ts && s.end > ctx.ts);
      return {
        text: `${hits[0].plate}: ${hits.length} session${hits.length === 1 ? "" : "s"} across ${siteCount} site${siteCount === 1 ? "" : "s"} in the last 48h — ${ov} overstay${ov === 1 ? "" : "s"}, ${ua} without a permit.${active ? ` Currently parked in ${active.spaceLabel} at ${siteById[active.siteId].name}.` : " Not currently on any site."}`,
        blocks: [
          {
            type: "table",
            columns: ["plate", "site", "space", "zone", "arrived", "dwell", "conf", "status"],
            rows: hits.slice(0, 14).map((s) => ({
              plate: plateRef(s.plate),
              site: siteRef(s.siteId),
              space: spaceRef(s.siteId, s.spaceId, s.spaceLabel),
              zone: s.zone,
              arrived: `${fmtDay(s.start)} ${fmtClock(s.start)}`,
              dwell: fmtDuration((s.end < ctx.ts ? s.end : ctx.ts) - s.start),
              conf: fmtConf(s.confidence),
              status: sessionStatus(s, ctx.ts),
            })),
          },
        ],
      };
    },
  },
  {
    id: "overstays",
    test: (q) => /overstay|over-?stay|over the limit|too long/i.test(q),
    run(q, ctx) {
      const [from, to] = matchRange(q, ctx.ts);
      const ids = scopedIds(q, ctx);
      const rows = [];
      for (const id of ids) {
        for (const e of siteEvents(id, from, to, { includeFlow: false, limit: 300 })) {
          if (e.kind === "overstay") rows.push(e.session);
        }
      }
      return {
        text: `${rows.length} overstay${rows.length === 1 ? "" : "s"} at ${scopeLabel(ids)} between ${fmtDay(from)} ${fmtClock(from)} and ${fmtClock(to)}. ${rows.length ? "Longest first:" : "Clean window."}`,
        blocks: rows.length
          ? [{ type: "table", columns: ["plate", "space", "site", "zone", "arrived", "dwell", "status"], rows: sessionRows(rows.sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 12), ctx.ts) }]
          : [],
      };
    },
  },
  {
    id: "find_plate",
    test: (q) => /plate|find\s+[A-Z]{2,3}-?\d|where is [A-Z]{2,3}/i.test(q),
    run(q, ctx) {
      const m = q.toUpperCase().match(PLATE_RE);
      if (!m) return { text: "Give me a plate fragment (e.g. “find KRT-4021”) and I'll search sessions across all sites.", blocks: [] };
      const hits = plateHistory(m[0], ctx.ts);
      return {
        text: hits.length
          ? `${hits.length} session${hits.length === 1 ? "" : "s"} matching “${m[0]}” in the last 48h:`
          : `No sessions matching “${m[0]}” in the last 48h.`,
        blocks: hits.length ? [{ type: "table", columns: ["plate", "space", "site", "zone", "arrived", "dwell", "status"], rows: sessionRows(hits.slice(0, 10), ctx.ts) }] : [],
      };
    },
  },
  {
    id: "low_confidence",
    test: (q) => /low[\s-]?confidence|unverified|uncertain|under\s+0?\.?7/i.test(q),
    run(q, ctx) {
      const ids = scopedIds(q, ctx);
      const rows = [];
      for (const id of ids) {
        const site = siteById[id];
        const snap = siteSnapshot(id, ctx.ts, site.real ? ctx.realOccupancy : null);
        for (const st of snap.states.values()) {
          if (st.session && st.status !== "free" && st.session.confidence < CONF_LINE) rows.push(st.session);
        }
      }
      rows.sort((a, b) => a.confidence - b.confidence);
      if (!rows.length) {
        return { text: `Every active session at ${scopeLabel(ids)} reads at or above ${fmtConf(CONF_LINE)} detection confidence right now.`, blocks: [] };
      }
      return {
        text: `${rows.length} active session${rows.length === 1 ? "" : "s"} under the ${fmtConf(CONF_LINE)} confidence line at ${scopeLabel(ids)}. Treat these as unverified — check camera evidence before enforcing on them. Lowest first:`,
        blocks: [
          {
            type: "table",
            columns: ["conf", "plate", "space", "site", "zone", "arrived", "dwell"],
            rows: rows.slice(0, 12).map((s) => ({
              conf: fmtConf(s.confidence),
              plate: plateRef(s.plate),
              space: spaceRef(s.siteId, s.spaceId, s.spaceLabel),
              site: siteRef(s.siteId),
              zone: s.zone,
              arrived: fmtClock(s.start),
              dwell: fmtDuration(ctx.ts - s.start),
            })),
          },
        ],
      };
    },
  },
  {
    id: "changed",
    test: (q) => /\bchanged\b|vs\.?\s+yesterday|compared?\s+(to|with)\s+yesterday|than yesterday/i.test(q),
    run(q, ctx) {
      const ids = scopedIds(q, ctx);
      const rows = ids.map((id) => {
        const site = siteById[id];
        const now = siteSnapshot(id, ctx.ts, site.real ? ctx.realOccupancy : null).occupancy;
        const then = siteRate(id, ctx.ts - 24 * HOUR) * 100;
        const d = Math.round(now) - Math.round(then);
        return {
          site: siteRef(id),
          now: `${Math.round(now)}%`,
          yesterday: `${Math.round(then)}%`,
          delta: `${d >= 0 ? "+" : ""}${d} pts`,
          _d: d,
        };
      });
      rows.sort((a, b) => Math.abs(b._d) - Math.abs(a._d));
      const top = rows[0];
      const table = rows.map(({ _d, ...r }) => r);
      return {
        text: `Occupancy now vs the same time yesterday (${fmtClock(ctx.ts)}), ${scopeLabel(ids)}. Biggest move: ${top.site.text} at ${top.delta}.`,
        blocks: [{ type: "table", columns: ["site", "now", "yesterday", "delta"], rows: table }],
      };
    },
  },
  {
    id: "busiest_zone",
    test: (q) => /busiest zone|which zone|zone is (the )?busiest/i.test(q),
    run(q, ctx) {
      const site = matchSite(q) || (ctx.scope && ctx.scope !== "portfolio" ? siteById[ctx.scope] : null);
      if (!site) {
        return { text: "Name a site (e.g. “busiest zone at Riverside Garage”), or set the scope to a single site, and I'll rank its zones.", blocks: [] };
      }
      const snap = siteSnapshot(site.id, ctx.ts, site.real ? ctx.realOccupancy : null);
      const rows = site.zones
        .map((z) => ({ z, agg: snap.zones[z.id] }))
        .filter((x) => x.agg && x.agg.total > 0)
        .map(({ z, agg }) => ({
          zone: { text: z.name, siteId: site.id },
          occupancy: `${Math.round((agg.occupied / agg.total) * 100)}%`,
          occupied: `${agg.occupied}/${agg.total}`,
          violations: String(agg.violations),
          _pct: agg.occupied / agg.total,
        }))
        .sort((a, b) => b._pct - a._pct);
      if (!rows.length) return { text: `${site.name} has no zone breakdown in the twin.`, blocks: [] };
      const top = rows[0];
      return {
        text: `Busiest zone at ${site.name} right now: ${top.zone.text} at ${top.occupancy} (${top.occupied} occupied).`,
        blocks: [{ type: "table", columns: ["zone", "occupancy", "occupied", "violations"], rows: rows.map(({ _pct, ...r }) => r) }],
      };
    },
  },
  {
    id: "occupancy",
    test: (q) => /occupancy|how full|available|free spaces|capacity|utilization/i.test(q),
    run(q, ctx) {
      const site = matchSite(q);
      if (site) {
        const snap = siteSnapshot(site.id, ctx.ts, site.real ? ctx.realOccupancy : null);
        return {
          text: `${site.name} is at ${Math.round(snap.occupancy)}% — ${snap.available} of ${snap.total} spaces free, ${snap.violations} active violation${snap.violations === 1 ? "" : "s"}. Average dwell ${fmtDuration(snap.avgDwellMs)}.`,
          blocks: [
            { type: "stats", items: [
              { label: "Occupancy", value: `${Math.round(snap.occupancy)}%` },
              { label: "Available", value: String(snap.available) },
              { label: "Violations", value: String(snap.violations) },
              { label: "Avg dwell", value: fmtDuration(snap.avgDwellMs) },
            ] },
            { type: "series", label: `${site.name} — last 12h`, series: siteSeries(site.id, ctx.ts - 12 * HOUR, ctx.ts, 20 * MIN).map((p) => ({ ts: p.ts, v: p.occupancy })) },
          ],
        };
      }
      const rows = SITES.map((s) => {
        const snap = siteSnapshot(s.id, ctx.ts, s.real ? ctx.realOccupancy : null);
        return { site: siteRef(s.id), kind: KIND_LABEL[s.kind], occupancy: `${Math.round(snap.occupancy)}%`, available: `${snap.available}/${snap.total}`, violations: String(snap.violations), _o: snap.occupancy };
      });
      const worst = rows.reduce((a, b) => (b._o > a._o ? b : a));
      return {
        text: `Portfolio at ${fmtClock(ctx.ts)} — tightest site is ${worst.site.text} at ${worst.occupancy}.`,
        blocks: [{ type: "table", columns: ["site", "kind", "occupancy", "available", "violations"], rows: rows.map(({ _o, ...r }) => r) }],
      };
    },
  },
  {
    id: "forecast",
    test: (q) => /forecast|predict|will .* (fill|be full)|when .* full|later|tonight|expect/i.test(q),
    run(q, ctx) {
      const site = matchSite(q) || (ctx.scope && ctx.scope !== "portfolio" ? siteById[ctx.scope] : siteById["sample-lot"]);
      const fc = siteForecast(site.id, ctx.ts, 12);
      const peak = fc.reduce((a, b) => (b.mid > a.mid ? b : a));
      const full = fc.find((p) => p.mid >= 95);
      return {
        text: `${site.name}: peak of ~${Math.round(peak.mid)}% expected around ${fmtClock(peak.ts)}${full ? `; projected to hit 95% by ${fmtClock(full.ts)}` : "; not projected to fill in the next 12h"}. Band shows forecast uncertainty.`,
        blocks: [
          { type: "stats", items: [
            { label: "Site", value: siteRef(site.id) },
            { label: "Peak", value: `${Math.round(peak.mid)}%` },
            { label: "Peak at", value: fmtClock(peak.ts) },
            { label: "95% by", value: full ? fmtClock(full.ts) : "—" },
          ] },
          { type: "forecast", label: `${site.name} — next 12h`, series: fc },
        ],
      };
    },
  },
  {
    id: "alerts",
    test: (q) => /alert|anomal|flag|wrong|issues?|problem/i.test(q) && /why|explain/i.test(q) === false,
    run(q, ctx) {
      const ids = scopedIds(q, ctx);
      const alerts = activeAlerts(ctx.ts, ids, ctx.realSummary);
      const pred = predictedIssues(ctx.ts, ids).slice(0, 4);
      return {
        text: `${alerts.length} active alert${alerts.length === 1 ? "" : "s"} at ${scopeLabel(ids)}, ${pred.length} predicted issue${pred.length === 1 ? "" : "s"} in the next hours. Ask “why was this flagged?” for the evidence chain.`,
        blocks: [
          alerts.length && {
            type: "table",
            columns: ["sev", "kind", "site", "plate", "detail"],
            rows: alerts.slice(0, 10).map((a) => ({
              sev: a.sev.toUpperCase(),
              kind: a.kind.replace(/_/g, " "),
              site: siteRef(a.siteId),
              plate: a.plate ? plateRef(a.plate) : "—",
              detail: a.detail,
            })),
          },
          pred.length && {
            type: "table",
            columns: ["sev", "eta", "site", "detail"],
            rows: pred.map((p) => ({ sev: p.sev.toUpperCase(), eta: fmtClock(p.eta), site: siteRef(p.siteId), detail: p.detail })),
          },
        ].filter(Boolean),
      };
    },
  },
  {
    id: "explain",
    test: (q) => /why|explain|evidence/i.test(q),
    run(q, ctx) {
      const a = pickAlertFromQuery(q, ctx);
      if (!a) {
        return {
          text: "Nothing is currently flagged in scope. When an alert is active, ask “why was this flagged?” — or name a plate or space — and I'll lay out the evidence: trigger condition, session record, detection confidence, and the plate's 48h history.",
          blocks: [],
        };
      }
      return explainAlert(a, ctx);
    },
  },
  {
    id: "revenue",
    test: (q) => /revenue|earning|income|money/i.test(q),
    run(q, ctx) {
      const rows = SITES.map((s) => ({ site: siteRef(s.id), today: fmtMoney(siteRevenueToday(s.id, ctx.ts)), rate: `$${s.rate}/h` }));
      const total = SITES.reduce((sum, s) => sum + siteRevenueToday(s.id, ctx.ts), 0);
      return {
        text: `Estimated revenue so far today: ${fmtMoney(total)} across ${SITES.length} sites (occupancy-derived estimate).`,
        blocks: [{ type: "table", columns: ["site", "today", "rate"], rows }],
      };
    },
  },
  {
    id: "compare",
    test: (q) => /compare|versus|vs\b|busiest|which site/i.test(q),
    run(q, ctx) {
      const rows = SITES.map((s) => {
        const snap = siteSnapshot(s.id, ctx.ts, s.real ? ctx.realOccupancy : null);
        const peak = siteForecast(s.id, ctx.ts, 8).reduce((a, b) => (b.mid > a.mid ? b : a));
        return {
          site: siteRef(s.id),
          now: `${Math.round(snap.occupancy)}%`,
          "peak (8h)": `${Math.round(peak.mid)}% @ ${fmtClock(peak.ts)}`,
          violations: String(snap.violations),
          "revenue today": fmtMoney(siteRevenueToday(s.id, ctx.ts)),
          _o: snap.occupancy,
        };
      });
      const busiest = rows.reduce((a, b) => (b._o > a._o ? b : a));
      return {
        text: `Right now the busiest site is ${busiest.site.text} at ${busiest.now}.`,
        blocks: [{ type: "table", columns: ["site", "now", "peak (8h)", "violations", "revenue today"], rows: rows.map(({ _o, ...r }) => r) }],
      };
    },
  },
  {
    id: "report",
    test: (q) => /report|summary|brief/i.test(q),
    run(q, ctx) {
      const parts = SITES.map((s) => {
        const snap = siteSnapshot(s.id, ctx.ts, s.real ? ctx.realOccupancy : null);
        return `• ${s.name}: ${Math.round(snap.occupancy)}% occupied (${snap.available} free), ${snap.violations} violations, est. ${fmtMoney(siteRevenueToday(s.id, ctx.ts))} today`;
      });
      const alerts = activeAlerts(ctx.ts, undefined, ctx.realSummary);
      return {
        text: `Operations brief — ${fmtDay(ctx.ts)} ${fmtClock(ctx.ts)}\n\n${parts.join("\n")}\n\nActive alerts: ${alerts.length} (${alerts.filter((a) => a.sev === "danger").length} critical). Full templates live in Reports.`,
        blocks: [],
      };
    },
  },
];

/* ---------- entry point ---------- */

export function askCopilot(query, ctx) {
  const q = query.trim();
  if (!q) return { text: "Ask me about occupancy, overstays, forecasts, alerts, plates, revenue, or site comparisons.", blocks: [] };
  for (const intent of INTENTS) {
    if (intent.test(q)) {
      try {
        return { intent: intent.id, ...intent.run(q, ctx) };
      } catch (err) {
        return { intent: intent.id, error: true, text: `That one failed while computing (${err.message}). Try rephrasing, or one of the suggestions.`, blocks: [] };
      }
    }
  }
  return {
    intent: "fallback",
    text: "I can answer questions like:\n• “What changed since yesterday?”\n• “Show all overstays near the entrance yesterday after 6pm”\n• “Low confidence sessions right now”\n• “History of KRT-4021” · “Find KRT-4021”\n• “Why was this flagged?”\n• “Busiest zone at Riverside Garage” · “Compare sites” · “Revenue today”",
    blocks: [],
  };
}

/* ---------- proactive digest (empty-thread "Right now" insights) ---------- */

export function copilotDigest(ctx) {
  const ts = ctx.ts;
  const ids = ctx.scope && ctx.scope !== "portfolio" ? [ctx.scope] : SITES.map((s) => s.id);
  const out = [];

  // 1 — worst active alert
  const alerts = activeAlerts(ts, ids, ctx.realSummary);
  if (alerts.length) {
    const a = alerts[0];
    const kind = a.kind.replace(/_/g, " ");
    out.push({
      id: "alerts",
      value: String(alerts.length),
      text: `active alert${alerts.length === 1 ? "" : "s"} — worst is ${kind}${a.spaceLabel ? ` in ${a.spaceLabel}` : ""} at ${siteById[a.siteId].name}`,
      meta: fmtClock(a.since),
      query: "Why was this flagged?",
    });
  }

  // 2 — next predicted issue
  const pred = predictedIssues(ts, ids);
  if (pred.length) {
    const p = pred[0];
    const name = siteById[p.siteId].name;
    if (p.kind === "zone_full") {
      out.push({ id: "pred", value: fmtClock(p.eta), text: `${name} projected near capacity — plan overflow before then`, query: `When will ${name} fill?` });
    } else if (p.kind === "overstay_pressure") {
      const n = parseInt(p.detail, 10);
      out.push({
        id: "pred",
        value: Number.isFinite(n) ? String(n) : fmtClock(p.eta),
        text: `vehicles at ${name} approaching their time limit`,
        meta: fmtClock(p.eta),
        query: `Show overstays at ${name} today`,
      });
    } else {
      out.push({ id: "pred", value: fmtClock(p.eta), text: `EV chargers at ${name} expected to saturate`, query: `What issues are open at ${name}?` });
    }
  }

  // 3 — biggest occupancy move vs the same time yesterday
  let top = null;
  for (const id of ids) {
    const site = siteById[id];
    const now = siteSnapshot(id, ts, site.real ? ctx.realOccupancy : null).occupancy;
    const then = siteRate(id, ts - 24 * HOUR) * 100;
    const d = Math.round(now) - Math.round(then);
    if (!top || Math.abs(d) > Math.abs(top.d)) top = { id, d, now };
  }
  if (top && Math.abs(top.d) >= 8) {
    out.push({
      id: "delta",
      value: `${top.d >= 0 ? "+" : ""}${top.d} pts`,
      text: `${siteById[top.id].name} vs this time yesterday`,
      meta: `${Math.round(top.now)}%`,
      query: "What changed since yesterday?",
    });
  }

  // 4 — unverified detections in scope
  let lowConf = 0;
  for (const id of ids) {
    const site = siteById[id];
    const snap = siteSnapshot(id, ts, site.real ? ctx.realOccupancy : null);
    for (const st of snap.states.values()) {
      if (st.session && st.status !== "free" && st.session.confidence < CONF_LINE) lowConf += 1;
    }
  }
  if (lowConf) {
    out.push({
      id: "lowconf",
      value: String(lowConf),
      text: `active session${lowConf === 1 ? "" : "s"} under the detection-confidence line`,
      meta: `< ${fmtConf(CONF_LINE)}`,
      query: "Low confidence sessions right now",
    });
  }

  return out.slice(0, 4);
}

/* ---------- suggestions (max 6 — the strongest queries) ---------- */

export const COPILOT_SUGGESTIONS = [
  "What changed since yesterday?",
  "Why was this flagged?",
  "Show all overstays yesterday after 6pm",
  "Low confidence sessions right now",
  "When will the airport lot fill?",
  "Busiest zone at Riverside Garage",
];
