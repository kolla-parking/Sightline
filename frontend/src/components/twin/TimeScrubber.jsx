// Time scrubber — drag anywhere in the last 48h and the whole twin replays
// that moment. Playback speeds let you watch the lot breathe.

import { useMemo, useRef } from "react";
import { useStore, twinTime } from "../../store/useStore.js";
import { siteRateSeries, siteSeries, HOUR, MIN } from "../../sim/engine.js";
import { SITES } from "../../sim/sites.js";
import { fmtClock, fmtDateTime } from "../../lib/format.js";
import { Kbd } from "../ui.jsx";

const WINDOW = 48 * HOUR;

export function TimeScrubber({ scope }) {
  const now = useStore((s) => s.now);
  const mode = useStore((s) => s.mode);
  const playSpeed = useStore((s) => s.playSpeed);
  const setCursor = useStore((s) => s.setCursor);
  const setPlaySpeed = useStore((s) => s.setPlaySpeed);
  const jumpLive = useStore((s) => s.jumpLive);
  const t = useStore(twinTime);
  const barRef = useRef(null);
  const draggingRef = useRef(false);

  const from = now - WINDOW;

  // background occupancy profile for context (minute-bucketed, cheap)
  const series = useMemo(() => {
    const bucket = Math.floor(now / (10 * MIN));
    void bucket;
    if (scope === "portfolio") {
      const per = SITES.map((s) => siteRateSeries(s.id, from, now, 30 * MIN));
      return per[0].map((_, i) => ({
        ts: per[0][i].ts,
        v: per.reduce((sum, arr) => sum + arr[i].occupancy, 0) / per.length,
      }));
    }
    return siteSeries(scope, from, now, 30 * MIN).map((p) => ({ ts: p.ts, v: p.occupancy }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, Math.floor(now / (10 * MIN))]);

  const tsFromEvent = (e) => {
    const rect = barRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return from + frac * WINDOW;
  };

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setCursor(tsFromEvent(e));
  };
  const onPointerMove = (e) => {
    if (draggingRef.current) setCursor(tsFromEvent(e));
  };
  const onPointerUp = () => (draggingRef.current = false);

  const cursorFrac = Math.min(1, Math.max(0, (t - from) / WINDOW));

  const W = 1000;
  const H = 40;
  const path = series.length
    ? series
        .map((p, i) => `${i ? "L" : "M"}${(((p.ts - from) / WINDOW) * W).toFixed(1)},${(H - 3 - (p.v / 100) * (H - 8)).toFixed(1)}`)
        .join("")
    : "";

  return (
    <div
      style={{
        borderTop: "1px solid var(--line)",
        background: "var(--bg-sunken)",
        padding: "8px 14px 10px",
        display: "grid",
        gap: 6,
        flexShrink: 0,
      }}
    >
      <div className="row" style={{ gap: 8 }}>
        <span className="mono" style={{ fontSize: "var(--fs-0)", fontWeight: 500, letterSpacing: "0.08em", color: "var(--ink-muted)" }}>TIMELINE · 48H</span>
        <span className="pill" style={{ fontSize: 10 }}>
          <Kbd>[</Kbd>
          <Kbd>]</Kbd> ±15m
        </span>
        <div className="spacer" />
        {mode === "replay" && (
          <>
            <span className="num" style={{ fontSize: "var(--fs-1)", color: "var(--warn)" }}>{fmtDateTime(t)}</span>
            {[1, 10, 60, 300].map((x) => (
              <button
                key={x}
                className={`btn sm ${playSpeed === x ? "" : "ghost"}`}
                style={playSpeed === x ? { borderColor: "var(--accent-line)", color: "var(--accent-text)" } : {}}
                onClick={() => setPlaySpeed(playSpeed === x ? 0 : x)}
                title={`Replay at ${x}× real time`}
              >
                {x}×
              </button>
            ))}
          </>
        )}
        <button
          className={`btn sm ${mode === "live" ? "" : "primary"}`}
          onClick={jumpLive}
          style={mode === "live" ? { color: "var(--ok)", borderColor: "var(--line)" } : {}}
        >
          <span className={`dot ${mode === "live" ? "ok pulse" : ""}`} style={mode === "live" ? {} : { background: "var(--accent-ink)" }} />
          {mode === "live" ? "LIVE" : "Jump to live"}
        </button>
      </div>

      <div
        ref={barRef}
        style={{ position: "relative", height: H, cursor: "ew-resize", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        aria-label="Time scrubber"
        aria-valuemin={from}
        aria-valuemax={now}
        aria-valuenow={t}
      >
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", borderRadius: 4, background: "var(--surface)" }}>
          {[0, 6, 12, 18, 24, 30, 36, 42, 48].map((h) => (
            <line key={h} x1={(h / 48) * W} x2={(h / 48) * W} y1={0} y2={H} stroke="var(--line)" strokeWidth={h % 24 === 0 ? 1.5 : 0.6} />
          ))}
          {path && (
            <>
              <path d={`${path}L${W},${H}L0,${H}Z`} fill="var(--accent-text)" opacity={0.08} />
              <path d={path} fill="none" stroke="var(--accent-text)" strokeWidth={1.2} opacity={0.7} />
            </>
          )}
          {/* replayed region */}
          {mode === "replay" && <rect x={cursorFrac * W} y={0} width={W - cursorFrac * W} height={H} fill="var(--bg)" opacity={0.55} />}
          <line x1={cursorFrac * W} x2={cursorFrac * W} y1={0} y2={H} stroke={mode === "live" ? "var(--ok)" : "var(--warn)"} strokeWidth={2} />
        </svg>
        {/* time labels */}
        <div className="row" style={{ position: "absolute", inset: "auto 0 -2px 0", justifyContent: "space-between", pointerEvents: "none" }}>
          {[48, 36, 24, 12, 0].map((h) => (
            <span key={h} className="num" style={{ fontSize: 9, color: "var(--ink-faint)", transform: "translateY(100%)" }}>
              {h === 0 ? "now" : fmtClock(now - h * HOUR)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
