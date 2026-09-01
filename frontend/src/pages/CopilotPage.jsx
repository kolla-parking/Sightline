// CopilotPage — /copilot. The full-page copilot workspace: same deterministic
// on-twin engine as the side panel, given room to breathe. Main thread column
// (max 880, centered) + a 280px context rail. No sim scans of its own — the
// thread renderer + copilot engine do the work; this page frames them.

import { useStore, useTwinTime } from "../store/useStore.js";
import { siteById } from "../sim/sites.js";
import { COPILOT_SUGGESTIONS } from "../sim/copilot.js";
import { CopilotThread, CopilotInput, CopilotDigest, useAskCopilot } from "../components/CopilotPanel.jsx";
import { Pill, Dot } from "../components/ui.jsx";
import { fmtDateTime } from "../lib/format.js";

/* ---------- suggestion grouping (static — computed once at module load) ---------- */

const GROUP_DEFS = [
  { label: "Monitor", test: (q) => /changed|how full|occupancy|available|revenue|busiest/i.test(q) },
  { label: "Investigate", test: (q) => /overstay|flag|why|find|plate|history|confidence/i.test(q) },
  { label: "Decide", test: (q) => /fill|forecast|when|compare|report/i.test(q) },
];

const GROUPS = GROUP_DEFS.map((g) => ({ label: g.label, items: [] }));
for (const s of COPILOT_SUGGESTIONS) {
  const idx = GROUP_DEFS.findIndex((g) => g.test(s));
  GROUPS[idx === -1 ? 0 : idx].items.push(s);
}

const HERO_EXAMPLES = GROUPS.map((g) => g.items[0]).filter(Boolean).slice(0, 3);

const CAPABILITIES = [
  "Answers questions over live and historical twin state",
  "Explains flags with evidence: trigger, session, confidence, plate history",
  "Traces a plate's sessions across every site over the last 48h",
  "Compares sites, surfaces what changed, forecasts when lots will fill",
];

/* ---------- pieces ---------- */

function EmptyHero({ ask }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        textAlign: "center",
        padding: "48px 24px",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "var(--accent-dim)",
          border: "1px solid var(--accent-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-hidden="true"
      >
        <Dot tone="accent" pulse />
      </div>
      <div>
        <div className="display">Ask the twin anything</div>
        <div
          style={{
            marginTop: 6,
            maxWidth: 430,
            fontSize: "var(--fs-1)",
            color: "var(--ink-muted)",
            lineHeight: 1.6,
          }}
        >
          Occupancy, overstays, forecasts, plates, alerts, revenue — every answer is computed
          from the same twin state the map renders, live or in replay.
        </div>
      </div>
      <CopilotDigest />
      <div className="row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 2 }}>
        {HERO_EXAMPLES.map((q) => (
          <button key={q} className="btn" onClick={() => ask(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContextRow({ label, children }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", flexShrink: 0 }}>{label}</span>
      <span className="row" style={{ gap: 6, minWidth: 0, justifyContent: "flex-end" }}>{children}</span>
    </div>
  );
}

function SuggestionButton({ query, ask }) {
  return (
    <button
      className="btn ghost sm"
      onClick={() => ask(query)}
      style={{
        justifyContent: "flex-start",
        textAlign: "left",
        height: "auto",
        minHeight: 24,
        padding: "4px 8px",
        whiteSpace: "normal",
        lineHeight: 1.45,
        fontSize: "var(--fs-1)",
        fontWeight: 400,
      }}
    >
      {query}
    </button>
  );
}

/* ---------- page ---------- */

export default function CopilotPage() {
  const messages = useStore((s) => s.copilotMessages);
  const clearCopilot = useStore((s) => s.clearCopilot);
  const scope = useStore((s) => s.scope);
  const mode = useStore((s) => s.mode);
  const backendUp = useStore((s) => s.backendUp);
  const ts = useTwinTime();
  const ask = useAskCopilot();

  const scopeName = scope === "portfolio" ? "Portfolio · all sites" : siteById[scope]?.name ?? scope;

  return (
    <div style={{ height: "100%", display: "flex", minWidth: 0 }}>
      {/* ---------- main thread column ---------- */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 880,
            margin: "0 auto",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            padding: "20px 24px 16px",
          }}
        >
          <header className="row" style={{ gap: 10, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
            <h1 className="page-title">Copilot</h1>
            <Pill>deterministic · on-twin data</Pill>
            <div className="spacer" />
            <button
              className="btn ghost sm"
              onClick={clearCopilot}
              disabled={!messages.length}
              aria-label="Clear conversation"
            >
              Clear
            </button>
          </header>

          <div
            className="scroll"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "18px 2px" }}
          >
            {messages.length === 0 ? <EmptyHero ask={ask} /> : <CopilotThread />}
          </div>

          <div style={{ paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <CopilotInput autoFocus />
          </div>
        </div>
      </div>

      {/* ---------- right rail ---------- */}
      <aside
        className="scroll"
        aria-label="Copilot context"
        style={{
          width: 280,
          flexShrink: 0,
          borderLeft: "1px solid var(--line)",
          background: "var(--bg-sunken)",
          padding: 14,
          display: "grid",
          gap: 12,
          alignContent: "start",
        }}
      >
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Twin context</span>
          </div>
          <div className="panel-body" style={{ display: "grid", gap: 10 }}>
            <ContextRow label="Scope">
              <span className="truncate" style={{ fontSize: "var(--fs-1)", fontWeight: 500 }}>{scopeName}</span>
            </ContextRow>
            <ContextRow label="Mode">
              <Pill tone={mode === "live" ? "ok" : "warn"}>{mode === "live" ? "LIVE" : "REPLAY"}</Pill>
            </ContextRow>
            <ContextRow label="Twin time">
              <span className="num" style={{ fontSize: "var(--fs-1)" }}>{fmtDateTime(ts)}</span>
            </ContextRow>
            <ContextRow label="Backend">
              <Dot tone={backendUp ? "ok" : "danger"} pulse={backendUp} />
              <span style={{ fontSize: "var(--fs-1)", color: backendUp ? "var(--ink-mid)" : "var(--ink-muted)" }}>
                {backendUp ? "Live camera feed" : "Offline · sim only"}
              </span>
            </ContextRow>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Try asking</span>
          </div>
          <div className="panel-body" style={{ display: "grid", gap: 12 }}>
            {GROUPS.filter((g) => g.items.length).map((g) => (
              <div key={g.label} style={{ display: "grid", gap: 4 }}>
                <div
                  className="mono"
                  style={{
                    fontSize: "var(--fs-0)",
                    fontWeight: 500,
                    color: "var(--ink-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  {g.label}
                </div>
                {g.items.map((q) => (
                  <SuggestionButton key={q} query={q} ask={ask} />
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">What Copilot can do</span>
          </div>
          <div className="panel-body" style={{ display: "grid", gap: 10 }}>
            {CAPABILITIES.map((c) => (
              <div key={c} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                <span style={{ display: "inline-flex", paddingTop: 5, flexShrink: 0 }}>
                  <Dot tone="accent" />
                </span>
                <span style={{ fontSize: "var(--fs-1)", color: "var(--ink-mid)", lineHeight: 1.5 }}>{c}</span>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
