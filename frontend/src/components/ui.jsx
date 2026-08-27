// Shared UI primitives. Every page composes from these — one vocabulary.

import { useEffect } from "react";
import { useStore } from "../store/useStore.js";

export function Pill({ tone, children, className = "" }) {
  return <span className={`pill ${tone || ""} ${className}`}>{children}</span>;
}

export function Dot({ tone, pulse }) {
  return <span className={`dot ${tone || ""} ${pulse ? "pulse" : ""}`} />;
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

// Stat — the dense KPI unit: value + label (+ delta)
export function Stat({ label, value, sub, tone, size = "md" }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        className="num"
        style={{
          fontSize: size === "lg" ? "var(--fs-6)" : "var(--fs-5)",
          fontWeight: 600,
          color: tone ? `var(--${tone})` : "var(--ink)",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)", marginTop: 1 }}>
        {label}
        {sub && <span style={{ color: "var(--ink-faint)" }}> · {sub}</span>}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
      {children}
    </div>
  );
}

export function Segmented({ options, value, onChange, size = "md" }) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-2)",
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          style={{
            height: size === "sm" ? 20 : 24,
            padding: "0 10px",
            borderRadius: 4,
            fontSize: "var(--fs-0)",
            fontWeight: 600,
            color: value === o.value ? "var(--ink)" : "var(--ink-muted)",
            background: value === o.value ? "var(--surface-3)" : "transparent",
            transition: "background var(--t-fast), color var(--t-fast)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Drawer({ title, meta, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={typeof title === "string" ? title : "Details"}>
        <header className="row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--fs-3)", fontWeight: 600 }} className="truncate">{title}</div>
            {meta && <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-muted)" }}>{meta}</div>}
          </div>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="scroll" style={{ flex: 1, padding: 16 }}>{children}</div>
        {footer && <footer style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>{footer}</footer>}
      </aside>
    </>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <Dot tone={t.sev === "danger" ? "danger" : t.sev === "warn" ? "warn" : "ok"} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

export const SEV_TONE = { danger: "danger", warn: "warn", info: "info" };
