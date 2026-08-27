// SitesPage — portfolio overview. Every managed asset at a glance:
// KPI strip (5s bucket) → dense sites table (30s bucket, click-through to
// the twin) → occupancy comparison + next-8h forecast peaks (minute bucket).

import { Fragment, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { KIND_LABEL } from "../sim/sites.js";
import {
  siteSnapshot,
  siteRateSeries,
  siteForecast,
  activeAlerts,
  siteRevenueToday,
  cameraHealth,
  HOUR,
  MIN,
} from "../sim/engine.js";
import { useStore, useTwinTime, scopedSites } from "../store/useStore.js";
import { Pill, Dot, Stat, EmptyState } from "../components/ui.jsx";
import { Sparkline, Bars } from "../components/charts.jsx";
import { fmtPct, fmtPct1, fmtClock, fmtDuration, fmtMoney, fmtNum } from "../lib/format.js";

const KPI_BUCKET = 5_000;
const TABLE_BUCKET = 30_000;

// Occupancy numeral color mirrors the congestion vocabulary.
const occInk = (pct) => (pct >= 95 ? "var(--danger)" : pct >= 90 ? "var(--warn)" : "var(--ink)");

function HairlineDivider() {
  return <div aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "var(--line)", flexShrink: 0 }} />;
}

export default function SitesPage() {
  const navigate = useNavigate();
  const ts = useTwinTime();
  const mode = useStore((s) => s.mode);
  const scope = useStore((s) => s.scope);
  const realOccupancy = useStore((s) => s.realOccupancy);
  const realSummary = useStore((s) => s.realSummary);
  const backendUp = useStore((s) => s.backendUp);
  const ackAlerts = useStore((s) => s.ackAlerts);
  const setScope = useStore((s) => s.setScope);

  const sites = useMemo(() => scopedSites({ scope }), [scope]);

  const kpiBucket = Math.floor(ts / KPI_BUCKET);
  const tableBucket = Math.floor(ts / TABLE_BUCKET);
  const minuteBucket = Math.floor(ts / MIN);

  /* ---- portfolio KPIs — 5s bucket ---- */
  const kpi = useMemo(() => {
    const t = kpiBucket * KPI_BUCKET;
    let total = 0;
    let occupied = 0;
    let violations = 0;
    let revenue = 0;
    for (const site of sites) {
      const override = site.real && mode === "live" ? realOccupancy : null;
      const snap = siteSnapshot(site.id, t, override);
      total += snap.total;
      occupied += snap.occupied;
      violations += snap.violations;
      revenue += siteRevenueToday(site.id, t);
    }
    const alerts = activeAlerts(
      t,
      sites.map((s) => s.id),
      mode === "live" ? realSummary : null,
    ).filter((a) => !ackAlerts.has(a.id));
    const critical = alerts.filter((a) => a.sev === "danger").length;
    return {
      total,
      occupied,
      available: total - occupied,
      occupancy: total ? (occupied / total) * 100 : 0,
      violations,
      revenue,
      alerts: alerts.length,
      critical,
    };
  }, [kpiBucket, sites, mode, realOccupancy, realSummary, ackAlerts]);

  /* ---- per-site table rows — 30s bucket ---- */
  const rows = useMemo(() => {
    const t = tableBucket * TABLE_BUCKET;
    return sites.map((site) => {
      const override = site.real && mode === "live" ? realOccupancy : null;
      const snap = siteSnapshot(site.id, t, override);
      let camsOnline = 0;
      for (const cam of site.cameras) {
        if (cam.real) {
          const online =
            mode === "live"
              ? backendUp && (!realSummary?.status || realSummary.status === "connected")
              : true; // no historical record for the real feed — assume up
          if (online) camsOnline += 1;
        } else if (cameraHealth(site.id, cam.id, t).online) {
          camsOnline += 1;
        }
      }
      return {
        site,
        occupancy: snap.occupancy,
        available: snap.available,
        total: snap.total,
        violations: snap.violations,
        camsOnline,
        camsTotal: site.cameras.length,
        revenue: siteRevenueToday(site.id, t),
      };
    });
  }, [tableBucket, sites, mode, realOccupancy, realSummary, backendUp]);

  /* ---- sparkline series — minute bucket (cheap closed-form scans) ---- */
  const sparks = useMemo(() => {
    const t = minuteBucket * MIN;
    const out = {};
    for (const site of sites) {
      out[site.id] = {
        h6: siteRateSeries(site.id, t - 6 * HOUR, t, 15 * MIN).map((p) => ({ ts: p.ts, v: p.occupancy })),
        h24: siteRateSeries(site.id, t - 24 * HOUR, t, 30 * MIN).map((p) => ({ ts: p.ts, v: p.occupancy })),
      };
    }
    return out;
  }, [minuteBucket, sites]);

  /* ---- next-8h forecast peaks — minute bucket ---- */
  const peaks = useMemo(() => {
    const t = minuteBucket * MIN;
    return sites
      .map((site) => {
        const fc = siteForecast(site.id, t, 8);
        let peak = fc[0];
        for (const p of fc) if (p.mid > peak.mid) peak = p;
        return { site, pct: peak.mid, at: peak.ts, inMs: peak.ts - t };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [minuteBucket, sites]);

  const busiest = rows.length ? Math.max(...rows.map((r) => r.occupancy)) : 0;

  const openSite = (siteId) => {
    setScope(siteId);
    navigate("/twin");
  };

  const kpiItems = [
    { label: "Total spaces", value: fmtNum(kpi.total), sub: `${sites.length} site${sites.length === 1 ? "" : "s"}` },
    { label: "Occupancy", value: fmtPct1(kpi.occupancy), sub: "weighted" },
    { label: "Available", value: fmtNum(kpi.available), tone: "ok" },
    {
      label: "Active alerts",
      value: fmtNum(kpi.alerts),
      sub: kpi.critical > 0 ? `${kpi.critical} critical` : undefined,
      tone: kpi.critical > 0 ? "danger" : kpi.alerts > 0 ? "warn" : undefined,
    },
    { label: "Violations", value: fmtNum(kpi.violations), tone: kpi.violations > 0 ? "danger" : undefined },
    { label: "Est. revenue today", value: fmtMoney(kpi.revenue), sub: "portfolio" },
  ];

  return (
    <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
      {/* ---- page header ---- */}
      <div className="row">
        <h1 style={{ fontSize: "var(--fs-4)" }}>Sites</h1>
        <span className="muted" style={{ fontSize: "var(--fs-1)" }}>
          portfolio overview
        </span>
        <div className="spacer" />
        {mode === "replay" && <Pill tone="warn">Replay</Pill>}
        <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
          as of {fmtClock(ts)}
        </span>
      </div>

      {/* ---- KPI strip — 5s bucket ---- */}
      <div className="panel">
        <div className="row scroll" style={{ gap: 0, padding: "12px 16px" }}>
          {kpiItems.map((it, i) => (
            <Fragment key={it.label}>
              {i > 0 && <HairlineDivider />}
              <div style={{ flex: "1 1 0", minWidth: 110, padding: i > 0 ? "0 0 0 16px" : 0, marginRight: 16 }}>
                <Stat label={it.label} value={it.value} sub={it.sub} tone={it.tone} />
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {/* ---- sites table — 30s bucket ---- */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">All sites</span>
          <div className="spacer" />
          <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
            click a site to open the live twin
          </span>
        </div>
        <div className="panel-body flush">
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Occupancy now</th>
                  <th style={{ textAlign: "right" }}>Available</th>
                  <th>Violations</th>
                  <th>Cameras</th>
                  <th style={{ textAlign: "right" }}>Revenue today</th>
                  <th>Trend 24h</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <EmptyState title="No sites in scope" hint="Switch the scope selector back to Portfolio." />
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr
                    key={r.site.id}
                    className="clickable"
                    tabIndex={0}
                    onClick={() => openSite(r.site.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openSite(r.site.id);
                      }
                    }}
                    aria-label={`Open ${r.site.name} in the twin`}
                  >
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: "var(--fs-2)" }}>{r.site.name}</span>
                        <Pill>{KIND_LABEL[r.site.kind]}</Pill>
                        {r.site.real && (
                          <Pill tone="accent">
                            <Dot tone="accent" pulse /> live
                          </Pill>
                        )}
                      </div>
                      <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginTop: 1 }}>
                        {r.site.address}
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <span
                          className="num"
                          style={{ width: 42, textAlign: "right", fontWeight: 600, color: occInk(r.occupancy) }}
                        >
                          {fmtPct(r.occupancy)}
                        </span>
                        <Sparkline data={sparks[r.site.id]?.h6 || []} w={110} h={22} tone="var(--ink-mid)" />
                      </div>
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      <span style={{ color: "var(--ok)" }}>{fmtNum(r.available)}</span>
                      <span style={{ color: "var(--ink-faint)" }}>/{fmtNum(r.total)}</span>
                    </td>
                    <td>
                      {r.violations > 0 ? (
                        <Pill tone="danger">{r.violations}</Pill>
                      ) : (
                        <span className="num" style={{ color: "var(--ink-faint)" }}>0</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <Dot
                          tone={
                            r.camsOnline === r.camsTotal ? "ok" : r.camsOnline === 0 ? "danger" : "warn"
                          }
                        />
                        <span className="num">
                          {r.camsOnline}/{r.camsTotal}
                        </span>
                      </div>
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {fmtMoney(r.revenue)}
                    </td>
                    <td>
                      <Sparkline data={sparks[r.site.id]?.h24 || []} w={120} h={22} tone="var(--ink-faint)" fill />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---- comparison + forecast peaks ---- */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Occupancy by site</span>
            <div className="spacer" />
            <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>now</span>
          </div>
          <div className="panel-body">
            {rows.length === 0 ? (
              <EmptyState title="No sites in scope" />
            ) : (
              <Bars
                data={[...rows]
                  .sort((a, b) => b.occupancy - a.occupancy)
                  .map((r) => ({
                    label: r.site.name,
                    v: r.occupancy,
                    tone: r.occupancy === busiest ? "var(--accent)" : "var(--ink-faint)",
                  }))}
                max={100}
                unit="%"
              />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Next 8h peaks</span>
            <div className="spacer" />
            <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>forecast mid</span>
          </div>
          <div className="panel-body flush">
            {peaks.length === 0 ? (
              <EmptyState title="No sites in scope" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th style={{ textAlign: "right" }}>Peak</th>
                    <th>At</th>
                  </tr>
                </thead>
                <tbody>
                  {peaks.map((p) => (
                    <tr key={p.site.id}>
                      <td>
                        <span style={{ color: "var(--ink-mid)" }}>{p.site.name}</span>
                      </td>
                      <td className="num" style={{ textAlign: "right", fontWeight: 600, color: occInk(p.pct) }}>
                        {fmtPct(p.pct)}
                      </td>
                      <td>
                        <span className="num">{fmtClock(p.at)}</span>{" "}
                        <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
                          in {fmtDuration(p.inMs)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
