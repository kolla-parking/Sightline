// Enforcement — light case management over store.cases.
//
// Cases are wall-clock objects (created by operators from Events & Alerts),
// so ages use store.now; the only sim query (bootstrapping cases from live
// violations) uses the twin timestamp per the contract.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, useTwinTime } from "../store/useStore.js";
import { siteById } from "../sim/sites.js";
import { activeAlerts, eventMeta } from "../sim/engine.js";
import { Pill, Dot, Stat, EmptyState, Segmented, Drawer, SEV_TONE } from "../components/ui.jsx";
import { fmtAgo, fmtDateTime, fmtDuration } from "../lib/format.js";

/* ---------- status vocabulary (exact) ---------- */

const STATUS_TONE = {
  open: "warn",
  reviewing: "info",
  ticketed: "accent",
  dismissed: "",
  closed: "ok",
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "reviewing", label: "Reviewing" },
  { value: "ticketed", label: "Ticketed" },
  { value: "closed", label: "Closed" },
];

// Forward transitions from each status; "closed" is reachable from any.
const NEXT_STATUS = {
  open: [{ status: "reviewing", label: "Start review" }],
  reviewing: [
    { status: "ticketed", label: "Issue ticket" },
    { status: "dismissed", label: "Dismiss" },
  ],
  ticketed: [],
  dismissed: [],
  closed: [],
};

function isSameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function siteName(id) {
  return siteById[id]?.name || id || "—";
}

/* ---------- small pieces ---------- */

function StatusPill({ status }) {
  return <Pill tone={STATUS_TONE[status] || ""}>{status}</Pill>;
}

function DetailRow({ label, children, mono = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, alignItems: "baseline" }}>
      <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>{label}</div>
      <div className={mono ? "num" : ""} style={{ fontSize: "var(--fs-1)", minWidth: 0, overflowWrap: "anywhere" }}>
        {children}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: "var(--fs-0)",
        fontWeight: 500,
        color: "var(--ink-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </div>
  );
}

/* ---------- case drawer ---------- */

function CaseDrawer({ caseId, onClose }) {
  const c = useStore((s) => s.cases.find((x) => x.id === caseId));
  const now = useStore((s) => s.now);
  const updateCase = useStore((s) => s.updateCase);
  const addCaseNote = useStore((s) => s.addCaseNote);
  const addToast = useStore((s) => s.addToast);
  const setScope = useStore((s) => s.setScope);
  const navigate = useNavigate();
  const [note, setNote] = useState("");

  if (!c) return null;

  const kind = c.kind ? eventMeta(c.kind) : null;
  const transitions = NEXT_STATUS[c.status] || [];

  const move = (status) => {
    updateCase(c.id, { status });
    addToast(`${c.id} → ${status}`, status === "dismissed" ? "info" : "ok");
  };

  const submitNote = () => {
    const text = note.trim();
    if (!text) return;
    addCaseNote(c.id, text);
    setNote("");
  };

  const locate = () => {
    onClose();
    setScope(c.siteId);
    navigate("/console/twin");
  };

  return (
    <Drawer
      title={<span className="num">{c.id}</span>}
      meta={`${siteName(c.siteId)}${c.spaceLabel ? ` · ${c.spaceLabel}` : ""}`}
      onClose={onClose}
      footer={
        <div className="row">
          <button className="btn primary" onClick={locate} disabled={!c.siteId}>
            Locate on twin
          </button>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: "var(--sp-4)" }}>
        {/* ---- status + transitions ---- */}
        <div style={{ display: "grid", gap: 10 }}>
          <div className="row">
            <SectionLabel>Status</SectionLabel>
            <div className="spacer" />
            <StatusPill status={c.status} />
          </div>
          {c.status === "closed" ? (
            <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)" }}>
              Case closed — no further actions.
            </div>
          ) : (
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {transitions.map((t) => (
                <button key={t.status} className="btn sm" onClick={() => move(t.status)}>
                  {t.label}
                </button>
              ))}
              <button className="btn danger sm" onClick={() => move("closed")}>
                Close case
              </button>
            </div>
          )}
        </div>

        {/* ---- full detail ---- */}
        <div style={{ display: "grid", gap: 8 }}>
          <SectionLabel>Detail</SectionLabel>
          <DetailRow label="Opened" mono>
            {fmtDateTime(c.createdAt)} <span className="muted">· {fmtAgo(c.createdAt, now)}</span>
          </DetailRow>
          <DetailRow label="Plate" mono>{c.plate || "—"}</DetailRow>
          <DetailRow label="Site">{siteName(c.siteId)}</DetailRow>
          <DetailRow label="Zone">{c.zone || "—"}</DetailRow>
          <DetailRow label="Space" mono>{c.spaceLabel || c.spaceId || "—"}</DetailRow>
          <DetailRow label="Kind">
            {kind ? <Pill>{kind.label}</Pill> : "—"}
          </DetailRow>
          <DetailRow label="Severity">
            {c.sev ? (
              <span className="row" style={{ gap: 6 }}>
                <Dot tone={SEV_TONE[c.sev]} />
                <span>{c.sev}</span>
              </span>
            ) : (
              "—"
            )}
          </DetailRow>
          {c.since != null && (
            <DetailRow label="Violation since" mono>{fmtDateTime(c.since)}</DetailRow>
          )}
          {c.alertId && <DetailRow label="Source alert" mono>{c.alertId}</DetailRow>}
          {c.detail && (
            <DetailRow label="Summary">
              <span style={{ color: "var(--ink-mid)" }}>{c.detail}</span>
            </DetailRow>
          )}
        </div>

        {/* ---- notes thread ---- */}
        <div style={{ display: "grid", gap: 10 }}>
          <SectionLabel>Notes ({c.notes?.length || 0})</SectionLabel>
          {c.notes?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {c.notes.map((n, i) => (
                <div
                  key={i}
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-3)",
                    padding: "8px 10px",
                    display: "grid",
                    gap: 3,
                  }}
                >
                  <div className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
                    {fmtDateTime(n.ts)}
                  </div>
                  <div style={{ fontSize: "var(--fs-1)", whiteSpace: "pre-wrap" }}>{n.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-muted)" }}>No notes yet.</div>
          )}
          <div className="row">
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Add a note…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitNote()}
              aria-label="Add case note"
            />
            <button className="btn" onClick={submitNote} disabled={!note.trim()}>
              Add
            </button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/* ---------- page ---------- */

export default function EnforcementPage() {
  const cases = useStore((s) => s.cases);
  const now = useStore((s) => s.now);
  const createCase = useStore((s) => s.createCase);
  const updateCase = useStore((s) => s.updateCase);
  const addToast = useStore((s) => s.addToast);
  const ts = useTwinTime();

  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const headCheckRef = useRef(null);

  /* ---- KPIs ---- */
  const kpis = useMemo(() => {
    const open = cases.filter((c) => c.status === "open");
    const reviewing = cases.filter((c) => c.status === "reviewing").length;
    const ticketedToday = cases.filter(
      (c) => c.status === "ticketed" && isSameDay(c.createdAt, now),
    ).length;
    const closed = cases.filter((c) => c.status === "closed").length;
    const medOpenAge = median(open.map((c) => now - c.createdAt));
    return { open: open.length, reviewing, ticketedToday, closed, medOpenAge };
  }, [cases, now]);

  /* ---- filter + search ---- */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter((c) => {
      if (filter !== "all" && c.status !== filter) return false;
      if (!q) return true;
      return (
        c.id.toLowerCase().includes(q) ||
        (c.plate || "").toLowerCase().includes(q) ||
        siteName(c.siteId).toLowerCase().includes(q) ||
        (c.siteId || "").toLowerCase().includes(q)
      );
    });
  }, [cases, filter, query]);

  /* ---- selection ---- */
  useEffect(() => {
    // prune selection when cases disappear
    setSelected((prev) => {
      const ids = new Set(cases.map((c) => c.id));
      let changed = false;
      const next = new Set();
      prev.forEach((id) => {
        if (ids.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [cases]);

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const someVisibleSelected = visible.some((c) => selected.has(c.id));

  useEffect(() => {
    if (headCheckRef.current) {
      headCheckRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((c) => next.delete(c.id));
      else visible.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulk = (status) => {
    const ids = [...selected];
    ids.forEach((id) => updateCase(id, { status }));
    addToast(`${ids.length} case${ids.length === 1 ? "" : "s"} → ${status}`, "ok");
    setSelected(new Set());
  };

  /* ---- bootstrap cases from live violations ---- */
  const openForViolations = () => {
    const alerts = activeAlerts(ts)
      .filter((a) => a.kind === "overstay" || a.kind === "unauthorized")
      .slice(0, 6);
    if (!alerts.length) {
      addToast("No active overstay or unauthorized violations right now", "info");
      return;
    }
    for (const a of alerts) {
      createCase({
        siteId: a.siteId,
        spaceId: a.spaceId,
        spaceLabel: a.spaceLabel,
        zone: a.zone,
        plate: a.plate,
        kind: a.kind,
        sev: a.sev,
        detail: a.detail,
        alertId: a.id,
        since: a.since,
      });
    }
    addToast(`Opened ${alerts.length} case${alerts.length === 1 ? "" : "s"} from active violations`, "ok");
  };

  return (
    <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
      {/* ---- header ---- */}
      <div className="row">
        <div>
          <h1 className="page-title">Enforcement</h1>
          <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
            Violation cases — review, ticket, dismiss, close
          </div>
        </div>
      </div>

      {/* ---- KPI strip ---- */}
      <div className="panel">
        <div
          className="panel-body"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16 }}
        >
          <Stat label="Open cases" value={kpis.open} tone={kpis.open ? "warn" : undefined} />
          <Stat label="In review" value={kpis.reviewing} tone={kpis.reviewing ? "info" : undefined} />
          <Stat label="Ticketed today" value={kpis.ticketedToday} tone={kpis.ticketedToday ? "accent" : undefined} />
          <Stat label="Closed" value={kpis.closed} tone={kpis.closed ? "ok" : undefined} />
          <Stat label="Median open age" value={kpis.medOpenAge != null ? fmtDuration(kpis.medOpenAge) : "—"} />
        </div>
      </div>

      {cases.length === 0 ? (
        /* ---- empty state: no cases at all ---- */
        <div className="panel">
          <EmptyState
            title="No enforcement cases"
            hint="Cases are opened from Events & Alerts — use the “Case” action on any overstay or unauthorized-use alert to start one here."
          >
            <button className="btn primary" style={{ marginTop: 6 }} onClick={openForViolations}>
              Open cases for current violations
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          {/* ---- toolbar ---- */}
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Segmented options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
            <input
              className="input"
              style={{ width: 210 }}
              placeholder="Search plate, site, case id…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search cases"
            />
            <div className="spacer" />
            {selected.size > 0 && (
              <div className="row" style={{ gap: 6 }}>
                <span className="num" style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
                  {selected.size} selected
                </span>
                <button className="btn sm" onClick={() => bulk("reviewing")}>Set reviewing</button>
                <button className="btn sm" onClick={() => bulk("ticketed")}>Ticket</button>
                <button className="btn sm" onClick={() => bulk("dismissed")}>Dismiss</button>
                <button className="btn danger sm" onClick={() => bulk("closed")}>Close</button>
                <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            )}
          </div>

          {/* ---- case table ---- */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Cases</span>
              <Pill>
                <span className="num">{visible.length}</span>
              </Pill>
              <div className="spacer" />
              <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-faint)" }}>
                {cases.length} total
              </span>
            </div>
            <div className="panel-body flush scroll" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input
                        ref={headCheckRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        style={{ accentColor: "var(--accent)", cursor: "pointer", display: "block" }}
                        aria-label="Select all visible cases"
                      />
                    </th>
                    <th>Case</th>
                    <th>Opened</th>
                    <th>Plate</th>
                    <th>Site</th>
                    <th>Space</th>
                    <th>Kind</th>
                    <th>Sev</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ padding: 0 }}>
                        <EmptyState
                          title="No matching cases"
                          hint={
                            query
                              ? `Nothing matches “${query}” with the ${filter === "all" ? "current" : filter} filter.`
                              : `No ${filter} cases right now.`
                          }
                        />
                      </td>
                    </tr>
                  )}
                  {visible.map((c) => {
                    const isSel = selected.has(c.id);
                    const kind = c.kind ? eventMeta(c.kind) : null;
                    return (
                      <tr
                        key={c.id}
                        className={`clickable${isSel ? " selected" : ""}`}
                        onClick={() => setOpenId(c.id)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleOne(c.id)}
                            style={{ accentColor: "var(--accent)", cursor: "pointer", display: "block" }}
                            aria-label={`Select ${c.id}`}
                          />
                        </td>
                        <td className="num">{c.id}</td>
                        <td className="num" style={{ color: "var(--ink-mid)" }}>
                          {fmtAgo(c.createdAt, now)}
                        </td>
                        <td className="num">{c.plate || "—"}</td>
                        <td className="truncate" style={{ maxWidth: 160 }}>{siteName(c.siteId)}</td>
                        <td className="num">{c.spaceLabel || c.spaceId || "—"}</td>
                        <td>{kind ? <Pill>{kind.label}</Pill> : <span className="muted">—</span>}</td>
                        <td>
                          <Dot tone={c.sev ? SEV_TONE[c.sev] : undefined} />
                        </td>
                        <td>
                          <StatusPill status={c.status} />
                        </td>
                        <td className="num" style={{ textAlign: "right", color: c.notes?.length ? "var(--ink)" : "var(--ink-faint)" }}>
                          {c.notes?.length || 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ---- drawer ---- */}
      {openId != null && <CaseDrawer caseId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
