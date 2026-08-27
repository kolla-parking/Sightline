// ReportsPage — /reports
//
// Document-style rendered reports computed live from the twin engine at the
// twin timestamp (live or replay cursor). Four templates, a period switch,
// copy-as-text / print / send-to-copilot toolbar.

import { useMemo, useState } from "react";
import { useStore, useTwinTime } from "../store/useStore.js";
import { SITES, siteById, KIND_LABEL } from "../sim/sites.js";
import {
  siteSnapshot,
  siteSeries,
  siteRateSeries,
  siteFlow,
  siteEvents,
  activeAlerts,
  predictedIssues,
  siteRevenueToday,
  HOUR,
  MIN,
} from "../sim/engine.js";
import { Pill, Dot, Stat, Segmented, EmptyState, SEV_TONE } from "../components/ui.jsx";
import { TimeChart, Bars } from "../components/charts.jsx";
import { useAskCopilot } from "../components/CopilotPanel.jsx";
import {
  fmtPct,
  fmtDuration,
  fmtClock,
  fmtDateTime,
  fmtMoney,
  fmtNum,
} from "../lib/format.js";

/* ================= templates ================= */

const TEMPLATES = [
  { id: "daily", label: "Daily operations brief", hint: "KPIs · alerts · risks" },
  { id: "performance", label: "Site performance", hint: "Occupancy · dwell · flow" },
  { id: "enforcement", label: "Enforcement summary", hint: "Cases · violations" },
  { id: "revenue", label: "Revenue estimate", hint: "Occupancy-derived" },
];

const TEMPLATE_TITLE = {
  daily: "Daily operations brief",
  performance: "Site performance",
  enforcement: "Enforcement summary",
  revenue: "Revenue estimate",
};

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

const CASE_STATUS_TONE = {
  open: "warn",
  dispatched: "info",
  investigating: "info",
  resolved: "ok",
  closed: "ok",
};

const VIOLATION_KINDS = ["overstay", "unauthorized", "double_park"];
const VIOLATION_LABEL = {
  overstay: "Overstay",
  unauthorized: "Unauthorized",
  double_park: "Double-park",
};

/* ================= model builders (pure) ================= */

function snapFor(site, ts, mode, realOccupancy) {
  // Real site gets the live backend override only for the CURRENT live snapshot.
  const override = site.real && mode === "live" ? realOccupancy : null;
  return siteSnapshot(site.id, ts, override);
}

function buildDailyModel({ sites, ts, mode, realOccupancy, realSummary }) {
  const rows = sites.map((site) => ({
    site,
    snap: snapFor(site, ts, mode, realOccupancy),
    revenue: siteRevenueToday(site.id, ts),
  }));
  const totals = rows.reduce(
    (a, r) => ({
      spaces: a.spaces + r.snap.total,
      occupied: a.occupied + r.snap.occupied,
      available: a.available + r.snap.available,
      violations: a.violations + r.snap.violations,
      revenue: a.revenue + r.revenue,
    }),
    { spaces: 0, occupied: 0, available: 0, violations: 0, revenue: 0 },
  );
  totals.occupancyPct = totals.spaces ? (totals.occupied / totals.spaces) * 100 : 0;

  const siteIds = sites.map((s) => s.id);
  const alerts = activeAlerts(ts, siteIds, mode === "live" ? realSummary : null);
  const issues = predictedIssues(ts, siteIds);

  const busiest = rows.length
    ? [...rows].sort((a, b) => b.snap.occupancy - a.snap.occupancy)[0]
    : null;
  const busiestSeries = busiest
    ? siteSeries(busiest.site.id, ts - 24 * HOUR, ts, 15 * MIN).map((p) => ({
        ts: p.ts,
        v: p.occupancy,
      }))
    : [];

  return { rows, totals, alerts, issues, busiest, busiestSeries };
}

function buildPerformanceModel({ sites, ts, range, period, mode, realOccupancy }) {
  const step = period === "7d" ? HOUR : 15 * MIN;
  const flowFrom = Math.max(range.from, range.to - 24 * HOUR); // cap flow scans at 24h
  const rows = sites.map((site) => {
    const raw =
      period === "7d"
        ? siteRateSeries(site.id, range.from, range.to, step)
        : siteSeries(site.id, range.from, range.to, step);
    const series = raw.map((p) => ({ ts: p.ts, v: p.occupancy }));
    let peak = null;
    for (const p of series) if (!peak || p.v > peak.v) peak = p;
    const snap = snapFor(site, ts, mode, realOccupancy);
    const flow = siteFlow(site.id, flowFrom, range.to);
    const zoneBars = site.zones.map((z) => {
      const za = snap.zones[z.id];
      const v = za && za.total ? (za.occupied / za.total) * 100 : 0;
      return {
        label: z.name,
        v,
        tone: v >= 90 ? "var(--danger)" : undefined,
      };
    });
    return { site, series, peak, snap, flow, zoneBars };
  });
  return { rows, flowCapped: flowFrom > range.from };
}

function buildEnforcementModel({ sites, ts, range, cases }) {
  const evFrom = Math.max(range.from, range.to - 48 * HOUR); // cap event scans at 48h
  const perSite = sites.map((site) => {
    const events = siteEvents(site.id, evFrom, range.to, { includeFlow: false, limit: 4000 });
    const counts = { overstay: 0, unauthorized: 0, double_park: 0 };
    for (const e of events) if (counts[e.kind] != null) counts[e.kind] += 1;
    return { site, counts, total: counts.overstay + counts.unauthorized + counts.double_park };
  });
  const violationTotals = perSite.reduce(
    (a, r) => ({
      overstay: a.overstay + r.counts.overstay,
      unauthorized: a.unauthorized + r.counts.unauthorized,
      double_park: a.double_park + r.counts.double_park,
      total: a.total + r.total,
    }),
    { overstay: 0, unauthorized: 0, double_park: 0, total: 0 },
  );

  const siteIdSet = new Set(sites.map((s) => s.id));
  const scopedCases = cases.filter((c) => !c.siteId || siteIdSet.has(c.siteId));
  const byStatus = {};
  for (const c of scopedCases) {
    const st = c.status || "open";
    byStatus[st] = (byStatus[st] || 0) + 1;
  }
  return {
    perSite,
    violationTotals,
    cases: scopedCases,
    recentCases: scopedCases.slice(0, 10),
    byStatus,
    capped: evFrom > range.from,
  };
}

function buildRevenueModel({ sites, ts, mode, realOccupancy }) {
  const rows = sites.map((site) => ({
    site,
    snap: snapFor(site, ts, mode, realOccupancy),
    revenue: siteRevenueToday(site.id, ts),
  }));
  const total = rows.reduce((a, r) => a + r.revenue, 0);
  const maxRev = Math.max(1, ...rows.map((r) => r.revenue));
  return { rows, total, maxRev };
}

/* ================= plain-text export ================= */

function buildReportText(template, model, meta) {
  const L = [];
  L.push(`SIGHTLINE — ${TEMPLATE_TITLE[template].toUpperCase()}`);
  L.push(`Generated ${meta.generated} · Scope: ${meta.scopeLabel} · Period: ${meta.periodLabel}`);
  L.push("");

  if (template === "daily") {
    const { totals, rows, alerts, issues, busiest } = model;
    L.push("PORTFOLIO");
    L.push(
      `  Spaces ${fmtNum(totals.spaces)} · Occupied ${fmtNum(totals.occupied)} (${fmtPct(totals.occupancyPct)}) · ` +
        `Available ${fmtNum(totals.available)} · Violations ${fmtNum(totals.violations)} · ` +
        `Active alerts ${fmtNum(alerts.length)} · Revenue today ${fmtMoney(totals.revenue)}`,
    );
    L.push("");
    L.push("SITES");
    for (const r of rows) {
      L.push(
        `  - ${r.site.name}: ${fmtPct(r.snap.occupancy)} occupied · ${fmtNum(r.snap.available)} available · ` +
          `${fmtNum(r.snap.violations)} violations · ${fmtMoney(r.revenue)} today`,
      );
    }
    L.push("");
    L.push(`ACTIVE ALERTS (${alerts.length})`);
    if (!alerts.length) L.push("  none");
    for (const a of alerts.slice(0, 20)) {
      L.push(`  [${a.sev.toUpperCase()}] ${siteById[a.siteId]?.name || a.siteId} — ${a.detail}`);
    }
    L.push("");
    L.push(`PREDICTED ISSUES (${issues.length})`);
    if (!issues.length) L.push("  none");
    for (const i of issues) {
      L.push(`  [${i.sev.toUpperCase()}] ETA ${fmtClock(i.eta)} — ${i.detail}`);
    }
    if (busiest) {
      L.push("");
      L.push(`Busiest site: ${busiest.site.name} at ${fmtPct(busiest.snap.occupancy)} occupancy.`);
    }
  }

  if (template === "performance") {
    for (const r of model.rows) {
      L.push(`${r.site.name.toUpperCase()} (${KIND_LABEL[r.site.kind]})`);
      L.push(
        `  Now: ${fmtPct(r.snap.occupancy)} occupied · ${fmtNum(r.snap.available)} available · ` +
          `${fmtNum(r.snap.violations)} violations · avg dwell ${fmtDuration(r.snap.avgDwellMs)}`,
      );
      L.push(r.peak ? `  Peak: ${fmtClock(r.peak.ts)} at ${fmtPct(r.peak.v)}` : "  Peak: —");
      L.push(
        `  Flow${model.flowCapped ? " (last 24h)" : ""}: in ${fmtNum(r.flow.inflow)} / out ${fmtNum(r.flow.outflow)}`,
      );
      L.push(`  Zones: ${r.zoneBars.map((z) => `${z.label} ${fmtPct(z.v)}`).join(" | ")}`);
      L.push("");
    }
  }

  if (template === "enforcement") {
    const statuses = Object.keys(model.byStatus);
    L.push("CASES");
    L.push(
      `  Total ${fmtNum(model.cases.length)}` +
        (statuses.length
          ? ` · ${statuses.map((s) => `${s} ${fmtNum(model.byStatus[s])}`).join(" · ")}`
          : ""),
    );
    L.push("");
    L.push(`VIOLATIONS IN PERIOD${model.capped ? " (scan capped to last 48h)" : ""}`);
    for (const r of model.perSite) {
      L.push(
        `  - ${r.site.name}: overstay ${fmtNum(r.counts.overstay)} · unauthorized ${fmtNum(r.counts.unauthorized)} · ` +
          `double-park ${fmtNum(r.counts.double_park)} · total ${fmtNum(r.total)}`,
      );
    }
    L.push(
      `  Portfolio total: ${fmtNum(model.violationTotals.total)} (overstay ${fmtNum(model.violationTotals.overstay)}, ` +
        `unauthorized ${fmtNum(model.violationTotals.unauthorized)}, double-park ${fmtNum(model.violationTotals.double_park)})`,
    );
    L.push("");
    L.push("RECENT CASES");
    if (!model.recentCases.length) L.push("  none");
    for (const c of model.recentCases) {
      L.push(
        `  ${c.id} [${c.status || "open"}] ${siteById[c.siteId]?.name || c.siteId || "—"} — ` +
          `${c.kind || "case"}${c.plate ? ` · ${c.plate}` : ""} · opened ${fmtDateTime(c.createdAt)}`,
      );
    }
  }

  if (template === "revenue") {
    L.push("REVENUE TODAY (to report time)");
    for (const r of model.rows) {
      L.push(
        `  - ${r.site.name}: ${fmtMoney(r.revenue)} · rate $${r.site.rate.toFixed(2)}/hr · ` +
          `${fmtNum(r.site.spaces.length)} spaces · now ${fmtPct(r.snap.occupancy)} occupied`,
      );
    }
    L.push(`  Portfolio total: ${fmtMoney(model.total)}`);
    L.push("");
    L.push(
      "Methodology: occupancy-derived estimate — hourly occupancy rate x stall count x posted rate x 0.82 " +
        "payment-compliance factor, summed from local midnight to the report time. Not billing data.",
    );
  }

  L.push("");
  L.push("— Generated by the Sightline digital twin. Simulated sites are deterministic; Sample Lot 1 merges the live camera feed.");
  return L.join("\n");
}

/* ================= small presentational pieces ================= */

function TemplateButton({ active, label, hint, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-pressed={active}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "7px 10px",
        borderRadius: "var(--r-2)",
        background: active ? "var(--surface-3)" : hover ? "var(--surface-2)" : "transparent",
        transition: "background var(--t-fast)",
      }}
    >
      <div
        style={{
          fontSize: "var(--fs-1)",
          fontWeight: 600,
          color: active ? "var(--ink)" : "var(--ink-mid)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>{hint}</div>
    </button>
  );
}

function Section({ title, right, children }) {
  return (
    <section style={{ marginTop: 22 }}>
      <div
        className="row"
        style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6, marginBottom: 10 }}
      >
        <h3
          style={{
            fontSize: "var(--fs-0)",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-muted)",
          }}
        >
          {title}
        </h3>
        <div className="spacer" />
        {right}
      </div>
      {children}
    </section>
  );
}

function TableWrap({ children }) {
  return (
    <div className="scroll" style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "var(--r-2)" }}>
      {children}
    </div>
  );
}

/* ================= template bodies ================= */

function DailyBriefBody({ model, ts, congestionPct }) {
  const { totals, rows, alerts, issues, busiest, busiestSeries } = model;
  return (
    <>
      <Section title="Portfolio at report time">
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <Stat label="Sites" value={fmtNum(rows.length)} />
          <Stat label="Spaces" value={fmtNum(totals.spaces)} />
          <Stat
            label="Occupied"
            value={fmtPct(totals.occupancyPct)}
            sub={`${fmtNum(totals.occupied)}/${fmtNum(totals.spaces)}`}
          />
          <Stat label="Available" value={fmtNum(totals.available)} tone={totals.available ? "ok" : "danger"} />
          <Stat
            label="Violations"
            value={fmtNum(totals.violations)}
            tone={totals.violations ? "danger" : undefined}
          />
          <Stat label="Active alerts" value={fmtNum(alerts.length)} tone={alerts.length ? "warn" : undefined} />
          <Stat label="Revenue today" value={fmtMoney(totals.revenue)} sub="est." />
        </div>
      </Section>

      <Section title="Site summaries">
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Occupancy</th>
                <th>Available</th>
                <th>Violations</th>
                <th>Revenue today</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.site.id}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="truncate">{r.site.name}</span>
                      {r.site.real && <Pill tone="ok">live</Pill>}
                    </span>
                  </td>
                  <td className="num">{fmtPct(r.snap.occupancy)}</td>
                  <td className="num">{fmtNum(r.snap.available)}</td>
                  <td className="num" style={{ color: r.snap.violations ? "var(--danger)" : undefined }}>
                    {fmtNum(r.snap.violations)}
                  </td>
                  <td className="num">{fmtMoney(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section
        title="Active alerts"
        right={<Pill tone={alerts.length ? "warn" : "ok"}>{alerts.length}</Pill>}
      >
        {alerts.length === 0 ? (
          <EmptyState title="No active alerts" hint="Nothing needs attention at the report timestamp." />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Sev</th>
                  <th>Site</th>
                  <th>Detail</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 12).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Pill tone={SEV_TONE[a.sev]}>{a.sev}</Pill>
                    </td>
                    <td className="truncate" style={{ maxWidth: 150 }}>
                      {siteById[a.siteId]?.name || a.siteId}
                    </td>
                    <td className="truncate" style={{ maxWidth: 380 }}>{a.detail}</td>
                    <td className="num">{fmtClock(a.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {alerts.length > 12 && (
          <div style={{ marginTop: 6, fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
            +{alerts.length - 12} more not shown
          </div>
        )}
      </Section>

      <Section title="Predicted issues" right={<Pill>{issues.length}</Pill>}>
        {issues.length === 0 ? (
          <EmptyState title="No predicted issues" hint="Forecast horizon is clear for the next 8 hours." />
        ) : (
          <ul style={{ display: "grid", gap: 6 }}>
            {issues.map((i) => (
              <li key={i.id} className="row" style={{ gap: 8 }}>
                <Pill tone={SEV_TONE[i.sev]}>{i.sev}</Pill>
                <span style={{ fontSize: "var(--fs-1)", minWidth: 0 }} className="truncate">
                  {i.detail}
                </span>
                <div className="spacer" />
                <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
                  ETA {fmtClock(i.eta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {busiest && (
        <Section
          title={`Busiest site — ${busiest.site.name}`}
          right={
            <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
              last 24h · {fmtPct(busiest.snap.occupancy)} now
            </span>
          }
        >
          <TimeChart
            data={busiestSeries}
            w={780}
            h={200}
            now={ts}
            threshold={congestionPct}
            unit="%"
          />
        </Section>
      )}
    </>
  );
}

function PerformanceBody({ model, ts, period, congestionPct }) {
  return (
    <>
      {model.rows.map((r) => (
        <Section
          key={r.site.id}
          title={r.site.name}
          right={
            <span className="row" style={{ gap: 6 }}>
              <Pill>{KIND_LABEL[r.site.kind]}</Pill>
              <Pill tone={r.snap.occupancy >= 90 ? "danger" : r.snap.occupancy >= 70 ? "warn" : "ok"}>
                {fmtPct(r.snap.occupancy)}
              </Pill>
            </span>
          }
        >
          <TimeChart
            data={r.series}
            w={780}
            h={160}
            now={ts}
            threshold={congestionPct}
            unit="%"
          />
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 12 }}>
            <Stat
              label="Peak"
              value={r.peak ? fmtPct(r.peak.v) : "—"}
              sub={r.peak ? fmtClock(r.peak.ts) : undefined}
            />
            <Stat label="Avg dwell" value={fmtDuration(r.snap.avgDwellMs)} sub="now" />
            <Stat
              label="Inflow"
              value={fmtNum(r.flow.inflow)}
              sub={model.flowCapped ? "last 24h" : "period"}
            />
            <Stat
              label="Outflow"
              value={fmtNum(r.flow.outflow)}
              sub={model.flowCapped ? "last 24h" : "period"}
            />
            <Stat
              label="Violations"
              value={fmtNum(r.snap.violations)}
              tone={r.snap.violations ? "danger" : undefined}
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginBottom: 6 }}>
              Zone occupancy (now)
            </div>
            <Bars data={r.zoneBars} max={100} unit="%" />
          </div>
          {period === "7d" && (
            <div style={{ marginTop: 8, fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
              7-day curve uses the modeled demand rate; flow totals scan the last 24h only.
            </div>
          )}
        </Section>
      ))}
    </>
  );
}

function EnforcementBody({ model }) {
  const statuses = Object.keys(model.byStatus);
  return (
    <>
      <Section title="Case load">
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <Stat label="Total cases" value={fmtNum(model.cases.length)} />
          {statuses.map((st) => (
            <Stat
              key={st}
              label={st}
              value={fmtNum(model.byStatus[st])}
              tone={CASE_STATUS_TONE[st]}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Violations in period"
        right={model.capped ? <Pill tone="info">scan capped to 48h</Pill> : null}
      >
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                {VIOLATION_KINDS.map((k) => (
                  <th key={k}>{VIOLATION_LABEL[k]}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {model.perSite.map((r) => (
                <tr key={r.site.id}>
                  <td className="truncate" style={{ maxWidth: 180 }}>{r.site.name}</td>
                  {VIOLATION_KINDS.map((k) => (
                    <td key={k} className="num">
                      {fmtNum(r.counts[k])}
                    </td>
                  ))}
                  <td className="num" style={{ fontWeight: 600 }}>
                    {fmtNum(r.total)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 600, color: "var(--ink-mid)" }}>All sites</td>
                {VIOLATION_KINDS.map((k) => (
                  <td key={k} className="num" style={{ fontWeight: 600 }}>
                    {fmtNum(model.violationTotals[k])}
                  </td>
                ))}
                <td className="num" style={{ fontWeight: 600 }}>
                  {fmtNum(model.violationTotals.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Recent cases">
        {model.recentCases.length === 0 ? (
          <EmptyState
            title="No cases on file"
            hint="Cases created from alerts on the Enforcement page appear here."
          />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Status</th>
                  <th>Site</th>
                  <th>Detail</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {model.recentCases.map((c) => (
                  <tr key={c.id}>
                    <td className="num">{c.id}</td>
                    <td>
                      <Pill tone={CASE_STATUS_TONE[c.status || "open"]}>{c.status || "open"}</Pill>
                    </td>
                    <td className="truncate" style={{ maxWidth: 150 }}>
                      {siteById[c.siteId]?.name || c.siteId || "—"}
                    </td>
                    <td className="truncate" style={{ maxWidth: 260 }}>
                      {[c.kind, c.plate, c.spaceLabel].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="num">{fmtDateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </>
  );
}

function RevenueBody({ model }) {
  return (
    <>
      <Section title="Estimated revenue — today to report time">
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 14 }}>
          <Stat label="Portfolio total" value={fmtMoney(model.total)} size="lg" />
          <Stat label="Sites" value={fmtNum(model.rows.length)} />
        </div>
        <Bars
          data={model.rows.map((r) => ({ label: r.site.name, v: r.revenue }))}
          max={model.maxRev}
          unit=""
        />
        <div style={{ marginTop: 6, fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
          USD, local midnight to report time
        </div>
      </Section>

      <Section title="Rate table">
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Kind</th>
                <th>Spaces</th>
                <th>Rate</th>
                <th>Occupancy now</th>
                <th>Revenue today</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((r) => (
                <tr key={r.site.id}>
                  <td className="truncate" style={{ maxWidth: 180 }}>{r.site.name}</td>
                  <td>{KIND_LABEL[r.site.kind]}</td>
                  <td className="num">{fmtNum(r.site.spaces.length)}</td>
                  <td className="num">${r.site.rate.toFixed(2)}/hr</td>
                  <td className="num">{fmtPct(r.snap.occupancy)}</td>
                  <td className="num">{fmtMoney(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Methodology">
        <p style={{ fontSize: "var(--fs-1)", color: "var(--ink-mid)", maxWidth: 640 }}>
          Figures are an occupancy-derived estimate, not billing data: for each hour since local
          midnight, the modeled occupancy rate is multiplied by the site&apos;s stall count, its posted
          hourly rate, and a 0.82 payment-compliance factor, then summed to the report timestamp.
          Sample Lot 1 folds in the live camera feed for its current occupancy; all historical hours
          use the deterministic twin model.
        </p>
      </Section>
    </>
  );
}

/* ================= page ================= */

export default function ReportsPage() {
  const ts = useTwinTime();
  const mode = useStore((s) => s.mode);
  const scope = useStore((s) => s.scope);
  const realOccupancy = useStore((s) => s.realOccupancy);
  const realSummary = useStore((s) => s.realSummary);
  const cases = useStore((s) => s.cases);
  const congestionPct = useStore((s) => s.settings.congestionPct);
  const setCopilotOpen = useStore((s) => s.setCopilotOpen);
  const addToast = useStore((s) => s.addToast);
  const ask = useAskCopilot();

  const [template, setTemplate] = useState("daily");
  const [period, setPeriod] = useState("today");

  // Minute bucket — a primitive, so every useMemo below keyed on it only
  // recomputes when the twin minute changes, keeping re-renders cheap.
  const tsMin = Math.floor(ts / MIN) * MIN;

  const sites = useMemo(
    () => (scope === "portfolio" ? SITES : SITES.filter((s) => s.id === scope)),
    [scope],
  );

  const range = useMemo(() => {
    if (period === "7d") return { from: tsMin - 7 * 24 * HOUR, to: tsMin, label: "Last 7 days" };
    if (period === "24h") return { from: tsMin - 24 * HOUR, to: tsMin, label: "Last 24 hours" };
    const d = new Date(tsMin);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: tsMin, label: "Today" };
  }, [period, tsMin]);

  const model = useMemo(() => {
    const ctx = { sites, ts: tsMin, range, period, mode, realOccupancy, realSummary, cases };
    switch (template) {
      case "performance":
        return buildPerformanceModel(ctx);
      case "enforcement":
        return buildEnforcementModel(ctx);
      case "revenue":
        return buildRevenueModel(ctx);
      case "daily":
      default:
        return buildDailyModel(ctx);
    }
  }, [template, sites, tsMin, range, period, mode, realOccupancy, realSummary, cases]);

  const scopeLabel =
    scope === "portfolio"
      ? `Portfolio · ${SITES.length} sites`
      : siteById[scope]?.name || scope;

  const meta = {
    generated: fmtDateTime(tsMin),
    scopeLabel,
    periodLabel: range.label,
  };

  const copyAsText = () => {
    const text = buildReportText(template, model, meta);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => addToast("Report copied as plain text"),
        () => addToast("Clipboard unavailable in this browser", "warn"),
      );
    } else {
      addToast("Clipboard unavailable in this browser", "warn");
    }
  };

  const sendToCopilot = () => {
    setCopilotOpen(true);
    ask("Give me a report");
  };

  return (
    <div
      style={{
        padding: 16,
        display: "grid",
        gridTemplateColumns: "240px minmax(0, 1fr)",
        gap: 12,
        alignItems: "start",
      }}
    >
      {/* ---- left rail ---- */}
      <aside className="panel">
        <div className="panel-head">
          <span className="panel-title">Report templates</span>
        </div>
        <div style={{ padding: 8, display: "grid", gap: 2 }}>
          {TEMPLATES.map((t) => (
            <TemplateButton
              key={t.id}
              active={template === t.id}
              label={t.label}
              hint={t.hint}
              onClick={() => setTemplate(t.id)}
            />
          ))}
        </div>
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: 12,
            display: "grid",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: "var(--fs-0)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-muted)",
            }}
          >
            Period
          </div>
          <Segmented options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
          <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)", lineHeight: 1.5 }}>
            Scope: <span style={{ color: "var(--ink-muted)" }}>{scopeLabel}</span>.{" "}
            {scope === "portfolio"
              ? "All sites included — focus one via the topbar scope switcher."
              : "Focused site — set from the topbar scope switcher."}
          </div>
        </div>
      </aside>

      {/* ---- main column ---- */}
      <div style={{ display: "grid", gap: 12, maxWidth: 860, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: "var(--fs-4)", fontWeight: 600 }}>Reports</span>
          <Pill>{TEMPLATE_TITLE[template]}</Pill>
          {mode === "replay" && <Pill tone="accent">replay</Pill>}
          <div className="spacer" />
          <button className="btn" onClick={copyAsText}>
            Copy as text
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print / PDF
          </button>
          <button className="btn primary" onClick={sendToCopilot}>
            Send to Copilot
          </button>
        </div>

        <article className="panel" style={{ padding: 24, lineHeight: 1.6 }}>
          <header>
            <div className="row" style={{ gap: 6 }}>
              <Dot tone="accent" />
              <span
                className="mono"
                style={{
                  fontSize: "var(--fs-0)",
                  letterSpacing: "0.08em",
                  color: "var(--ink-muted)",
                }}
              >
                SIGHTLINE · OPERATIONS REPORT
              </span>
            </div>
            <h2 style={{ fontSize: "var(--fs-5)", marginTop: 6 }}>{TEMPLATE_TITLE[template]}</h2>
            <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)", marginTop: 2 }}>
              Generated <span className="num">{meta.generated}</span> · {meta.scopeLabel} ·{" "}
              {meta.periodLabel}
            </div>
          </header>

          {template === "daily" && (
            <DailyBriefBody model={model} ts={tsMin} congestionPct={congestionPct} />
          )}
          {template === "performance" && (
            <PerformanceBody model={model} ts={tsMin} period={period} congestionPct={congestionPct} />
          )}
          {template === "enforcement" && <EnforcementBody model={model} />}
          {template === "revenue" && <RevenueBody model={model} />}

          <footer
            style={{
              marginTop: 24,
              paddingTop: 10,
              borderTop: "1px solid var(--line)",
              fontSize: "var(--fs-0)",
              color: "var(--ink-faint)",
            }}
          >
            Generated from the Sightline digital twin at the report timestamp. Simulated sites are
            deterministic and reproducible; Sample Lot 1 merges the live camera feed when in live
            mode.
          </footer>
        </article>
      </div>
    </div>
  );
}
