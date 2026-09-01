// Shared UI primitives. Every page composes from these — one vocabulary.

import { useEffect } from "react";
import { useStore } from "../store/useStore.js";

// Brand mark (BRAND.md): rounded-square 3×3 grid — a lot seen from above —
// with the center cell carrying the accent (one space, seen). Outer cells
// inherit currentColor at 32% so it works on any surface, in both themes.
export function Mark({ size = 22 }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g fill="currentColor" opacity=".32">
        <rect x="3" y="3" width="7" height="7" rx="2.2" />
        <rect x="12.5" y="3" width="7" height="7" rx="2.2" />
        <rect x="22" y="3" width="7" height="7" rx="2.2" />
        <rect x="3" y="12.5" width="7" height="7" rx="2.2" />
        <rect x="22" y="12.5" width="7" height="7" rx="2.2" />
        <rect x="3" y="22" width="7" height="7" rx="2.2" />
        <rect x="12.5" y="22" width="7" height="7" rx="2.2" />
        <rect x="22" y="22" width="7" height="7" rx="2.2" />
      </g>
      <rect x="12.5" y="12.5" width="7" height="7" rx="2.2" fill="var(--accent)" />
    </svg>
  );
}

export function Pill({ tone, children, className = "" }) {
  return <span className={`pill ${tone || ""} ${className}`}>{children}</span>;
}

export function Dot({ tone, pulse }) {
  return <span className={`dot ${tone || ""} ${pulse ? "pulse" : ""}`} />;
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

// PlateButton — a plate rendered as a quiet accent-text mono link. Clicking
// opens the Vehicle drawer via selectPlate (optional-chained so surfaces
// build even if the store slice is absent). Quiet by design: text + a
// dashed underline affordance, never a filled control.
export function PlateButton({ plate, style }) {
  if (!plate) return null;
  return (
    <button
      type="button"
      className="num"
      title={`Vehicle history · ${plate}`}
      onClick={(e) => {
        e.stopPropagation();
        useStore.getState().selectPlate?.(plate);
      }}
      style={{
        padding: 0,
        fontSize: "inherit",
        color: "var(--accent-text)",
        borderBottom: "1px dashed var(--accent-line)",
        borderRadius: 0,
        lineHeight: 1.3,
        ...style,
      }}
    >
      {plate}
    </button>
  );
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
      if (e.key !== "Escape") return;
      // The command palette sits above every drawer and consumes Escape
      // alone. Two guards: paletteOpen for the general case, and the
      // .palette target check because the palette's own handler closes it
      // synchronously (zustand) before this bubble listener runs.
      if (useStore.getState().paletteOpen) return;
      if (e.target instanceof Element && e.target.closest(".palette")) return;
      onClose();
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
