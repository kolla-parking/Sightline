// Copilot thread + input. The side panel wraps CopilotThread; the full
// Copilot page reuses the same thread renderer.
//
// Block rendering follows the schema documented at the top of sim/copilot.js:
// table cells and stat values may be entity refs ({text, plate} |
// {text, siteId} | {text, siteId, spaceId}) rendered as quiet accent-text
// buttons that jump to the vehicle drawer / twin. Store actions from the
// twin package (selectPlate, selectSpace) are optional-chained so either
// package builds standalone.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, twinTime, useTwinTime } from "../store/useStore.js";
import { askCopilot, copilotDigest, COPILOT_SUGGESTIONS } from "../sim/copilot.js";
import { TimeChart } from "./charts.jsx";
import { fmtClock } from "../lib/format.js";

/* ---------- ask: brief working state, then the staged answer ---------- */

let msgSeq = 0;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useAskCopilot() {
  return (query) => {
    const q = String(query ?? "").trim();
    if (!q) return;
    const push = useStore.getState().pushCopilot;
    const id = `cm-${(msgSeq++).toString(36)}-${Date.now().toString(36)}`;
    push({ role: "user", text: q, ts: Date.now() });
    push({ role: "copilot", id, pending: true, query: q, ts: Date.now() });
    const resolve = () => {
      const s = useStore.getState();
      const ctx = {
        ts: twinTime(s),
        // CONTRACT rule 3: the live-camera override applies only to the
        // CURRENT snapshot — historical/replay queries never take it.
        realOccupancy: s.mode === "live" ? s.realOccupancy : null,
        realSummary: s.realSummary,
        scope: s.scope,
      };
      let answer;
      try {
        answer = askCopilot(q, ctx);
      } catch (err) {
        answer = { intent: "error", error: true, text: `That one failed (${err.message}).`, blocks: [] };
      }
      useStore.setState((st) => ({
        copilotMessages: st.copilotMessages.map((m) =>
          m.id === id ? { ...m, ...answer, pending: false, ts: Date.now(), revealAt: Date.now(), query: q } : m,
        ),
      }));
    };
    // UI-only timing: a brief, honest "working" beat — no fake streaming.
    setTimeout(resolve, reducedMotion() ? 0 : 320);
  };
}

/* ---------- entity refs ---------- */

function RefButton({ cell }) {
  const navigate = useNavigate();
  const mono = Boolean(cell.plate || cell.spaceId);
  const go = () => {
    const st = useStore.getState();
    if (cell.plate) {
      st.selectPlate?.(cell.plate); // opens the Vehicle drawer from any page
      return;
    }
    if (cell.siteId) {
      st.setScope?.(cell.siteId);
      if (cell.spaceId) st.selectSpace?.(cell.spaceId);
      navigate("/console/twin");
    }
  };
  return (
    <button
      type="button"
      className={mono ? "num" : ""}
      onClick={go}
      title={cell.plate ? `Open vehicle ${cell.plate}` : cell.spaceId ? "Show this space on the twin" : "Focus this site on the twin"}
      style={{
        background: "none",
        border: 0,
        padding: 0,
        margin: 0,
        fontSize: "inherit",
        // Site refs render in the UI face per the copilot schema — explicit,
        // because stat values sit inside a `.num` (data face) wrapper.
        fontFamily: mono ? undefined : "var(--font-ui)",
        lineHeight: "inherit",
        color: "var(--accent-text)",
        cursor: "pointer",
        textDecoration: "underline",
        textDecorationStyle: "dotted",
        textDecorationColor: "var(--accent-line)",
        textUnderlineOffset: 3,
        borderRadius: 2,
      }}
    >
      {cell.text}
    </button>
  );
}

const isRef = (v) => v != null && typeof v === "object" && v.text !== undefined;

function CellValue({ value }) {
  if (isRef(value)) return <RefButton cell={value} />;
  return value;
}

/* ---------- blocks ---------- */

// Columns whose cells set in the data face: numbers, IDs, timestamps, and
// status/severity/kind tags (BRAND: uppercase lives only in mono labels).
const MONO_COL = /plate|space|dwell|arrived|eta|now|today|yesterday|delta|conf|occup|value|violation|available|revenue|peak|since|until|sev|status|kind|zone/i;

function Block({ block }) {
  if (block.type === "stats") {
    return (
      <div className="row" style={{ gap: 20, flexWrap: "wrap", padding: "6px 0" }}>
        {block.items.map((it) => (
          <div key={it.label}>
            <div className="num" style={{ fontSize: "var(--fs-4)", fontWeight: 600 }}>
              <CellValue value={it.value} />
            </div>
            <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>{it.label}</div>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "table") {
    return (
      <div className="scroll" style={{ maxHeight: 260, border: "1px solid var(--line)", borderRadius: "var(--r-2)" }}>
        <table className="table">
          <thead>
            <tr>{block.columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((r, i) => (
              <tr key={i}>
                {block.columns.map((c) => (
                  <td key={c} className={!isRef(r[c]) && MONO_COL.test(c) ? "num" : ""}>
                    <CellValue value={r[c]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === "series") {
    return (
      <div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginBottom: 4 }}>{block.label}</div>
        <TimeChart data={block.series.map((p) => ({ ts: p.ts, v: p.v }))} h={120} w={380} />
      </div>
    );
  }
  if (block.type === "forecast") {
    return (
      <div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginBottom: 4 }}>{block.label}</div>
        {/* The forecast starts at the answer's twin time (ctx.ts) — anchor the
            "now" marker there, never at wall clock (CONTRACT rule 1). */}
        <TimeChart forecast={block.series} h={120} w={380} now={block.series[0]?.ts} />
      </div>
    );
  }
  if (block.type === "action") {
    return (
      <div
        className="row"
        style={{
          gap: 8,
          alignItems: "flex-start",
          padding: "7px 10px",
          background: "var(--accent-dim)",
          border: "1px solid var(--accent-line)",
          borderRadius: "var(--r-2)",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: "var(--fs-0)",
            fontWeight: 500,
            letterSpacing: "0.07em",
            color: "var(--accent-text)",
            flexShrink: 0,
            paddingTop: 1,
          }}
        >
          ACTION
        </span>
        <span style={{ fontSize: "var(--fs-1)", lineHeight: 1.5, color: "var(--ink)" }}>{block.text}</span>
      </div>
    );
  }
  return null;
}

/* ---------- staged answer reveal (opacity/translate only) ---------- */

function StagedAnswer({ m }) {
  const blocks = m.blocks || [];
  const total = 1 + blocks.length; // text, then each block
  // Animate only answers that just arrived; history renders instantly.
  const animate = useRef(Boolean(m.revealAt && Date.now() - m.revealAt < 1200 && !reducedMotion())).current;
  const [step, setStep] = useState(animate ? 1 : total);

  useEffect(() => {
    if (!animate || step >= total) return;
    const t = setTimeout(() => setStep((v) => v + 1), 120);
    return () => clearTimeout(t);
  }, [animate, step, total]);

  const stage = (i) =>
    animate
      ? {
          opacity: i < step ? 1 : 0,
          transform: i < step ? "none" : "translateY(4px)",
          transition: "opacity 160ms var(--ease-out), transform 160ms var(--ease-out)",
        }
      : undefined;

  return (
    <>
      <div style={{ fontSize: "var(--fs-2)", whiteSpace: "pre-wrap", lineHeight: 1.55, ...stage(0) }}>{m.text}</div>
      {blocks.map((b, j) => (
        <div key={j} style={stage(j + 1)}>
          <Block block={b} />
        </div>
      ))}
    </>
  );
}

/* ---------- proactive digest ("Right now", empty-thread state) ---------- */

export function CopilotDigest() {
  const ts = useTwinTime();
  const mode = useStore((s) => s.mode);
  const scope = useStore((s) => s.scope);
  const realOccupancy = useStore((s) => s.realOccupancy);
  const realSummary = useStore((s) => s.realSummary);
  const ask = useAskCopilot();
  const bucket = Math.floor(ts / 5000);

  const insights = useMemo(() => {
    try {
      // CONTRACT rule 3: live-camera override only in live mode — replay
      // digests read the historical twin, never today's camera state.
      return copilotDigest({
        ts: bucket * 5000,
        realOccupancy: mode === "live" ? realOccupancy : null,
        realSummary,
        scope,
      });
    } catch {
      return [];
    }
  }, [bucket, mode, scope, realOccupancy, realSummary]);

  if (!insights.length) {
    return (
      <div style={{ fontSize: "var(--fs-1)", color: "var(--ink-faint)", textAlign: "left" }}>
        All quiet right now — no alerts or predicted issues in scope.
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 520,
        border: "1px solid var(--line)",
        borderRadius: "var(--r-3)",
        background: "var(--surface)",
        overflow: "hidden",
        textAlign: "left",
      }}
    >
      <div
        className="mono"
        style={{
          padding: "8px 12px 6px",
          fontSize: "var(--fs-0)",
          fontWeight: 500,
          letterSpacing: "0.07em",
          color: "var(--ink-faint)",
        }}
      >
        RIGHT NOW · {fmtClock(ts)}
      </div>
      {insights.map((ins) => (
        <button
          key={ins.id}
          type="button"
          className="btn ghost"
          onClick={() => ask(ins.query)}
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "flex-start",
            alignItems: "baseline",
            gap: 10,
            height: "auto",
            padding: "7px 12px",
            borderRadius: 0,
            borderTop: "1px solid var(--line)",
            fontWeight: 400,
            textAlign: "left",
          }}
        >
          <span className="num" style={{ fontWeight: 600, color: "var(--ink)", flexShrink: 0, minWidth: 34 }}>
            {ins.value}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-1)", color: "var(--ink-mid)", lineHeight: 1.45, whiteSpace: "normal" }}>
            {ins.text}
          </span>
          {ins.meta && (
            <span className="num" style={{ flexShrink: 0, fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>
              {ins.meta}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------- thread ---------- */

function PendingAnswer() {
  return (
    <div style={{ display: "grid", gap: 6, maxWidth: 300 }} aria-label="Copilot is working">
      <div className="skeleton" style={{ height: 10, width: "82%" }} />
      <div className="skeleton" style={{ height: 10, width: "58%" }} />
    </div>
  );
}

export function CopilotThread({ compact = false }) {
  const messages = useStore((s) => s.copilotMessages);
  const ask = useAskCopilot();
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {messages.length === 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "var(--ink-muted)", fontSize: "var(--fs-1)", lineHeight: 1.6 }}>
            Ask about anything the twin can see — occupancy, overstays, forecasts, plates, alerts, revenue.
          </div>
          <CopilotDigest />
        </div>
      )}
      {messages.map((m, i) =>
        m.role === "user" ? (
          <div key={m.id || i} style={{ alignSelf: "flex-end", maxWidth: "85%" }}>
            <div
              style={{
                background: "var(--fill)",
                border: "1px solid var(--border)",
                color: "var(--ink)",
                borderRadius: "10px 10px 3px 10px",
                padding: "7px 11px",
                fontSize: "var(--fs-1)",
              }}
            >
              {m.text}
            </div>
          </div>
        ) : (
          <div key={m.id || i} style={{ maxWidth: compact ? "100%" : "92%", display: "grid", gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className={`dot ${m.error ? "danger" : "accent"}${m.pending ? " pulse" : ""}`} />
              <span className="mono" style={{ fontSize: "var(--fs-0)", fontWeight: 500, letterSpacing: "0.06em", color: "var(--ink-muted)" }}>
                {m.pending ? "COPILOT · WORKING" : m.error ? "COPILOT · FAILED" : `COPILOT · ${fmtClock(m.ts)}`}
              </span>
            </div>
            {m.pending ? (
              <PendingAnswer />
            ) : m.error ? (
              <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
                <div style={{ fontSize: "var(--fs-2)", lineHeight: 1.55, color: "var(--ink-mid)" }}>{m.text}</div>
                {m.query && (
                  <button className="btn ghost sm" onClick={() => ask(m.query)}>
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <StagedAnswer m={m} />
            )}
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

/* ---------- input ---------- */

export function CopilotInput({ autoFocus = false }) {
  const [value, setValue] = useState("");
  const ask = useAskCopilot();
  const submit = () => {
    if (!value.trim()) return;
    ask(value);
    setValue("");
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="row">
        <input
          className="input"
          style={{ flex: 1, height: 32 }}
          placeholder="Ask the twin anything…"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          aria-label="Copilot query"
        />
        <button className="btn primary" style={{ height: 32 }} onClick={submit}>
          Ask
        </button>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {COPILOT_SUGGESTIONS.slice(0, 4).map((s) => (
          <button
            key={s}
            className="btn ghost sm"
            style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}
            onClick={() => {
              setValue(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- side panel ---------- */

export function CopilotSidePanel() {
  const open = useStore((s) => s.copilotOpen);
  const setOpen = useStore((s) => s.setCopilotOpen);
  if (!open) return null;
  return (
    <aside
      style={{
        width: 400,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
      aria-label="Copilot panel"
    >
      <header
        className="row"
        style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}
      >
        <span className="dot accent pulse" />
        <span style={{ fontSize: "var(--fs-1)", fontWeight: 600 }}>Copilot</span>
        <span className="pill" style={{ marginLeft: 4 }}>on-twin</span>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={() => setOpen(false)} aria-label="Close copilot">✕</button>
      </header>
      <div className="scroll" style={{ flex: 1, padding: 14 }}>
        <CopilotThread compact />
      </div>
      <div style={{ padding: 14, borderTop: "1px solid var(--border)", background: "var(--bg-2)" }}>
        <CopilotInput />
      </div>
    </aside>
  );
}
