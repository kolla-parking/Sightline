// Cmd+K command palette: navigation, site switching, actions, copilot handoff.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore.js";
import { SITES } from "../sim/sites.js";
import { Kbd } from "./ui.jsx";
import { useAskCopilot } from "./CopilotPanel.jsx";

const NAV = [
  { id: "sites", label: "Go to Sites", to: "/sites", key: "G O" },
  { id: "twin", label: "Go to Live Twin", to: "/twin", key: "G T" },
  { id: "analytics", label: "Go to Analytics & Forecasts", to: "/analytics", key: "G A" },
  { id: "events", label: "Go to Events & Alerts", to: "/events", key: "G E" },
  { id: "enforcement", label: "Go to Enforcement", to: "/enforcement", key: "G N" },
  { id: "reports", label: "Go to Reports", to: "/reports", key: "G R" },
  { id: "copilot", label: "Go to Copilot", to: "/copilot", key: "G C" },
  { id: "settings", label: "Go to Settings", to: "/settings", key: "G S" },
];

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const setScope = useStore((s) => s.setScope);
  const jumpLive = useStore((s) => s.jumpLive);
  const setCopilotOpen = useStore((s) => s.setCopilotOpen);
  const addToast = useStore((s) => s.addToast);
  const navigate = useNavigate();
  const ask = useAskCopilot();

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commands = useMemo(() => {
    const list = [
      ...NAV.map((n) => ({ ...n, group: "Navigate", run: () => navigate(n.to) })),
      ...SITES.map((s) => ({
        id: `site:${s.id}`,
        group: "Scope",
        label: `Focus site: ${s.name}`,
        run: () => {
          setScope(s.id);
          navigate("/twin");
        },
      })),
      {
        id: "scope:portfolio",
        group: "Scope",
        label: "Focus: Portfolio (all sites)",
        run: () => {
          setScope("portfolio");
          navigate("/sites");
        },
      },
      { id: "live", group: "Actions", label: "Jump to live", key: "L", run: () => jumpLive() },
      { id: "copilot-open", group: "Actions", label: "Toggle Copilot panel", key: "\\", run: () => setCopilotOpen(!useStore.getState().copilotOpen) },
      { id: "ack", group: "Actions", label: "Acknowledge all visible alerts", run: () => addToast("Alerts acknowledged", "info") },
    ];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.label.toLowerCase().includes(q));
  }, [query, navigate, setScope, jumpLive, setCopilotOpen, addToast]);

  const askable = query.trim().length > 8 && commands.length === 0;

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const run = (cmd) => {
    setOpen(false);
    cmd.run();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, commands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (askable) {
        setOpen(false);
        setCopilotOpen(true);
        ask(query);
      } else if (commands[index]) {
        run(commands[index]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  let lastGroup = null;

  return (
    <>
      <div className="drawer-backdrop" style={{ zIndex: "var(--z-modal-backdrop)" }} onClick={() => setOpen(false)} />
      <div role="dialog" aria-label="Command palette" className="palette">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command, a site, or a question for Copilot…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="scroll" style={{ maxHeight: 320, padding: 6 }}>
          {commands.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  className={`row palette-item${i === index ? " active" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(c)}
                >
                  <span>{c.label}</span>
                  <span className="spacer" />
                  {c.key && c.key.split(" ").map((k) => <Kbd key={k}>{k}</Kbd>)}
                </button>
              </div>
            );
          })}
          {askable && (
            <button
              className="row palette-item active"
              style={{ padding: 10 }}
              onClick={() => {
                setOpen(false);
                setCopilotOpen(true);
                ask(query);
              }}
            >
              <span className="dot accent" />
              <span>
                Ask Copilot: <em style={{ color: "var(--ink-mid)" }}>“{query}”</em>
              </span>
              <span className="spacer" />
              <Kbd>↵</Kbd>
            </button>
          )}
          {!commands.length && !askable && (
            <div style={{ padding: 16, color: "var(--ink-muted)", fontSize: "var(--fs-1)" }}>No matches.</div>
          )}
        </div>
      </div>
    </>
  );
}
