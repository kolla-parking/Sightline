// Copilot thread + input. The side panel wraps CopilotThread; the full
// Copilot page reuses the same thread renderer.

import { useEffect, useRef, useState } from "react";
import { useStore, twinTime } from "../store/useStore.js";
import { askCopilot, COPILOT_SUGGESTIONS } from "../sim/copilot.js";
import { TimeChart, Sparkline } from "./charts.jsx";
import { fmtClock } from "../lib/format.js";

export function useAskCopilot() {
  const pushCopilot = useStore((s) => s.pushCopilot);
  return (query) => {
    const s = useStore.getState();
    const ctx = {
      ts: twinTime(s),
      realOccupancy: s.realOccupancy,
      realSummary: s.realSummary,
    };
    pushCopilot({ role: "user", text: query, ts: Date.now() });
    const answer = askCopilot(query, ctx);
    pushCopilot({ role: "copilot", ts: Date.now(), ...answer });
  };
}

function Block({ block }) {
  if (block.type === "stats") {
    return (
      <div className="row" style={{ gap: 20, flexWrap: "wrap", padding: "6px 0" }}>
        {block.items.map((it) => (
          <div key={it.label}>
            <div className="num" style={{ fontSize: "var(--fs-4)", fontWeight: 600 }}>{it.value}</div>
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
                  <td key={c} className={/plate|dwell|arrived|eta|now|today/.test(c) ? "num" : ""}>
                    {r[c]}
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
        <TimeChart forecast={block.series} h={120} w={380} now={Date.now()} />
      </div>
    );
  }
  return null;
}

export function CopilotThread({ compact = false }) {
  const messages = useStore((s) => s.copilotMessages);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {messages.length === 0 && (
        <div style={{ color: "var(--ink-muted)", fontSize: "var(--fs-1)", lineHeight: 1.6 }}>
          Ask about anything the twin can see — occupancy, overstays, forecasts, plates, alerts, revenue.
        </div>
      )}
      {messages.map((m, i) =>
        m.role === "user" ? (
          <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%" }}>
            <div
              style={{
                background: "var(--accent-dim)",
                border: "1px solid var(--accent-line)",
                color: "var(--ink)",
                borderRadius: "10px 10px 2px 10px",
                padding: "7px 11px",
                fontSize: "var(--fs-1)",
              }}
            >
              {m.text}
            </div>
          </div>
        ) : (
          <div key={i} style={{ maxWidth: compact ? "100%" : "92%", display: "grid", gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="dot accent" />
              <span style={{ fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--ink-muted)" }}>
                COPILOT · {fmtClock(m.ts)}
              </span>
            </div>
            <div style={{ fontSize: "var(--fs-2)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{m.text}</div>
            {m.blocks?.map((b, j) => <Block key={j} block={b} />)}
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

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

export function CopilotSidePanel() {
  const open = useStore((s) => s.copilotOpen);
  const setOpen = useStore((s) => s.setCopilotOpen);
  if (!open) return null;
  return (
    <aside
      style={{
        width: 400,
        flexShrink: 0,
        borderLeft: "1px solid var(--line)",
        background: "var(--bg-sunken)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
      aria-label="Copilot panel"
    >
      <header className="row" style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
        <span className="dot accent" />
        <span style={{ fontSize: "var(--fs-1)", fontWeight: 600 }}>Copilot</span>
        <span className="pill" style={{ marginLeft: 4 }}>on-twin</span>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={() => setOpen(false)} aria-label="Close copilot">✕</button>
      </header>
      <div className="scroll" style={{ flex: 1, padding: 14 }}>
        <CopilotThread compact />
      </div>
      <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>
        <CopilotInput />
      </div>
    </aside>
  );
}
