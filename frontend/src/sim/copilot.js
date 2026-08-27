// Sightline Copilot — deterministic natural-language engine over the twin.
//
// No LLM: intent parsing via patterns, answers computed from the same sim
// engine the twin renders. Every answer returns { text, blocks } where
// blocks are typed payloads the UI renders (stat rows, tables, series).
// Swappable later for a real model with the same response contract.

import { SITES, siteById, KIND_LABEL } from "./sites.js";
import {
  siteSnapshot,
  siteSessions,
  siteEvents,
  activeAlerts,
  predictedIssues,
  siteForecast,
  siteRate,
  siteRevenueToday,
  findPlate,
  siteSeries,
  HOUR,
  MIN,
} from "./engine.js";
import { fmtClock, fmtDuration, fmtMoney, fmtDay } from "../lib/format.js";

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

const sessionRows = (list, ts) =>
  list.map((s) => ({
    plate: s.plate,
    space: s.spaceLabel,
    site: siteById[s.siteId].name,
    zone: s.zone,
    arrived: fmtClock(s.start),
    dwell: fmtDuration((s.end && s.end < ts ? s.end : ts) - s.start),
    status: ts >= s.overstayAt && (!s.end || s.end > ts) ? "OVERSTAY" : !s.permitOk ? "NO PERMIT" : s.end < ts ? "departed" : "parked",
  }));

/* ---------- intents ---------- */

const INTENTS = [
  {
    id: "overstays",
    test: (q) => /overstay|over-?stay|over the limit|too long/i.test(q),
    run(q, ctx) {
      const site = matchSite(q);
      const [from, to] = matchRange(q, ctx.ts);
      const siteIds = site ? [site.id] : SITES.map((s) => s.id);
      const rows = [];
      for (const id of siteIds) {
        for (const e of siteEvents(id, from, to, { includeFlow: false, limit: 300 })) {
          if (e.kind === "overstay") rows.push(e.session);
        }
      }
      const scopeTxt = site ? site.name : "all sites";
      return {
        text: `${rows.length} overstay${rows.length === 1 ? "" : "s"} at ${scopeTxt} between ${fmtDay(from)} ${fmtClock(from)} and ${fmtClock(to)}. ${rows.length ? "Longest first:" : "Clean window."}`,
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
      const m = q.toUpperCase().match(/[A-Z]{2,3}-?\d{2,4}/);
      if (!m) return { text: "Give me a plate fragment (e.g. “find KRT-4021”) and I'll search sessions across all sites.", blocks: [] };
      const hits = findPlate(m[0], ctx.ts);
      return {
        text: hits.length
          ? `${hits.length} session${hits.length === 1 ? "" : "s"} matching “${m[0]}” in the last 48h:`
          : `No sessions matching “${m[0]}” in the last 48h.`,
        blocks: hits.length ? [{ type: "table", columns: ["plate", "space", "site", "zone", "arrived", "dwell", "status"], rows: sessionRows(hits.slice(0, 10), ctx.ts) }] : [],
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
        return { site: s.name, kind: KIND_LABEL[s.kind], occupancy: `${Math.round(snap.occupancy)}%`, available: `${snap.available}/${snap.total}`, violations: String(snap.violations) };
      });
      const worst = rows.reduce((a, b) => (parseInt(b.occupancy) > parseInt(a.occupancy) ? b : a));
      return {
        text: `Portfolio at ${fmtClock(ctx.ts)} — tightest site is ${worst.site} at ${worst.occupancy}.`,
        blocks: [{ type: "table", columns: ["site", "kind", "occupancy", "available", "violations"], rows }],
      };
    },
  },
  {
    id: "forecast",
    test: (q) => /forecast|predict|will .* (fill|be full)|when .* full|later|tonight|expect/i.test(q),
    run(q, ctx) {
      const site = matchSite(q) || siteById["sample-lot"];
      const fc = siteForecast(site.id, ctx.ts, 12);
      const peak = fc.reduce((a, b) => (b.mid > a.mid ? b : a));
      const full = fc.find((p) => p.mid >= 95);
      return {
        text: `${site.name}: peak of ~${Math.round(peak.mid)}% expected around ${fmtClock(peak.ts)}${full ? `; projected to hit 95% by ${fmtClock(full.ts)}` : "; not projected to fill in the next 12h"}. Band shows forecast uncertainty.`,
        blocks: [{ type: "forecast", label: `${site.name} — next 12h`, series: fc }],
      };
    },
  },
  {
    id: "alerts",
    test: (q) => /alert|anomal|flag|wrong|issues?|problem/i.test(q) && /why|explain/i.test(q) === false,
    run(q, ctx) {
      const site = matchSite(q);
      const alerts = activeAlerts(ctx.ts, site ? [site.id] : undefined, ctx.realSummary);
      const pred = predictedIssues(ctx.ts, site ? [site.id] : undefined).slice(0, 4);
      return {
        text: `${alerts.length} active alert${alerts.length === 1 ? "" : "s"}${site ? ` at ${site.name}` : " across the portfolio"}, ${pred.length} predicted issue${pred.length === 1 ? "" : "s"} in the next hours.`,
        blocks: [
          alerts.length && { type: "table", columns: ["sev", "kind", "site", "detail"], rows: alerts.slice(0, 10).map((a) => ({ sev: a.sev.toUpperCase(), kind: a.kind.replace(/_/g, " "), site: siteById[a.siteId].name, detail: a.detail })) },
          pred.length && { type: "table", columns: ["sev", "eta", "detail"], rows: pred.map((p) => ({ sev: p.sev.toUpperCase(), eta: fmtClock(p.eta), detail: p.detail })) },
        ].filter(Boolean),
      };
    },
  },
  {
    id: "explain",
    test: (q) => /why|explain/i.test(q),
    run(q, ctx) {
      const alerts = activeAlerts(ctx.ts, undefined, ctx.realSummary);
      const site = matchSite(q);
      const pool = site ? alerts.filter((a) => a.siteId === site.id) : alerts;
      const a = pool[0];
      if (!a) return { text: "Nothing is currently flagged. When an alert is active, ask “why was this flagged?” and I'll walk through the trigger conditions.", blocks: [] };
      const reasons = {
        overstay: `The detection pipeline tracked continuous occupancy in ${a.spaceLabel ?? "the space"} since ${fmtClock(a.since)}. The posted limit for this space type is ${a.session?.limitMin ?? "—"} minutes; dwell passed the limit plus the operator grace period, so the space was flagged. Confidence comes from vote-smoothed per-frame detections, not a single frame.`,
        unauthorized: `${a.plate ?? "The vehicle"} parked in a reserved space with no matching permit on file. Plate reads below 90% confidence are never auto-flagged — this one cleared the threshold.`,
        camera_offline: `No frames have arrived from ${a.cameraName} since ${fmtClock(a.since)}. Spaces covered only by this camera fall back to last-known state and are marked stale rather than guessed.`,
        congestion: `Occupancy crossed the configured congestion threshold with inbound flow still exceeding outbound, which historically precedes queueing at entries within ~20 minutes.`,
        charger_contention: `Every EV charger is taken and typical evening EV arrivals exceed charger turnover. Suggested action: enable the 2h EV limit or open overflow charging.`,
      };
      return { text: `${siteById[a.siteId].name} — ${a.detail}\n\n${reasons[a.kind] || "Flagged by the anomaly detector against this site's seasonal baseline."}`, blocks: [] };
    },
  },
  {
    id: "revenue",
    test: (q) => /revenue|earning|income|money/i.test(q),
    run(q, ctx) {
      const rows = SITES.map((s) => ({ site: s.name, today: fmtMoney(siteRevenueToday(s.id, ctx.ts)), rate: `$${s.rate}/h` }));
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
          site: s.name,
          now: `${Math.round(snap.occupancy)}%`,
          "peak (8h)": `${Math.round(peak.mid)}% @ ${fmtClock(peak.ts)}`,
          violations: String(snap.violations),
          "revenue today": fmtMoney(siteRevenueToday(s.id, ctx.ts)),
        };
      });
      const busiest = rows.reduce((a, b) => (parseInt(b.now) > parseInt(a.now) ? b : a));
      return { text: `Right now the busiest site is ${busiest.site} at ${busiest.now}.`, blocks: [{ type: "table", columns: ["site", "now", "peak (8h)", "violations", "revenue today"], rows }] };
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
        return { intent: intent.id, text: `I hit an error answering that (${err.message}).`, blocks: [] };
      }
    }
  }
  return {
    intent: "fallback",
    text: "I can answer questions like:\n• “Show all overstays near the entrance yesterday after 6pm”\n• “How full is Riverside Garage?”\n• “When will the airport lot fill up?”\n• “Find KRT-4021”\n• “Why was this flagged?”\n• “Compare sites” · “Revenue today” · “Give me a report”",
    blocks: [],
  };
}

export const COPILOT_SUGGESTIONS = [
  "Show all overstays yesterday after 6pm",
  "How full is Riverside Garage?",
  "When will the airport lot fill?",
  "Compare sites",
  "Why was this flagged?",
  "Revenue today",
];
