# Version-10 dashboard — module contract

You are building ONE page module of the Sightline operator dashboard. The
foundation (design system, simulation engine, store, shell, primitives) is
DONE — read it, use it, do not modify it. Your page renders inside the app
shell (`components/Shell.jsx`) which already provides sidebar nav, topbar
with site scope switcher, command palette, copilot side panel.

## Read these files before writing code

- `PRODUCT.md` (repo root) — product + register
- `src/styles/tokens.css`, `src/styles/base.css` — ALL tokens + component
  classes (`.panel`, `.btn`, `.table`, `.pill`, `.input`, `.select-wrap`,
  `.empty`, `.drawer`, `.scroll`, `.row`, `.num` …). Use these classes +
  inline style with `var(--token)` values. No new CSS files.
- `src/sim/sites.js` — SITES, siteById, KIND_LABEL, spaceById. Site shape:
  `{id, name, kind, real, address, center:[lng,lat], zones:[{id,name}],
  cameras:[{id,name,real?}], rate, limits, spaces:[{id,label,zone,level,
  type,poly,center,sx,sy,sw,sh,backendId?}]}`
- `src/sim/engine.js` — the data source. Key exports:
  `siteSnapshot(siteId, ts, realOverride?)` → `{total, occupied, available,
  violations, occupancy(0-100), avgDwellMs, zones:{[zoneId]:{total,occupied,
  violations}}, states: Map(spaceId → {status, session, overstay?,
  unauthorized?})}`; `siteSeries(siteId, from, to, stepMs)` (scan truth,
  cached — keep ranges ≤48h, steps ≥5min); `siteRateSeries` (cheap, for
  portfolio charts); `siteForecast(siteId, from, hours)` → `[{ts,mid,lo,hi}]`;
  `siteFlow(siteId, from, to)` → `{inflow, outflow}`; `siteSessions(siteId,
  from, to, {limit})`; `siteEvents(siteId, from, to, {includeFlow, limit})`;
  `activeAlerts(ts, siteIds?, realCamStatus?)`; `predictedIssues(ts,
  siteIds?)`; `cameraHealth(siteId, camId, ts)`; `siteRevenueToday(siteId,
  ts)`; `findPlate(query, ts)`; `eventMeta(kind)`; constants `HOUR`, `MIN`.
- `src/store/useStore.js` — zustand. `useStore(sel)`, `twinTime(state)`,
  `useTwinTime()`, `scopedSites(state)`. Actions: `setScope`, `setCursor`,
  `jumpLive`, `setPlaySpeed`, `openDrawer/closeDrawer`, `ackAlert`,
  `addToast`, `createCase/updateCase/addCaseNote`, `setSetting`,
  `pushCopilot`. State: `mode` ("live"|"replay"), `cursor`, `now`, `scope`
  ("portfolio"|siteId), `realOccupancy` (Map backendId→bool | null),
  `realSummary`, `backendUp`, `cases`, `settings`, `ackAlerts`.
- `src/components/ui.jsx` — `Pill`, `Dot`, `Kbd`, `Stat`, `EmptyState`,
  `Segmented`, `Drawer`, `Toasts`, `SEV_TONE`.
- `src/components/charts.jsx` — `Sparkline`, `TimeChart` (data/forecast/
  now/threshold), `Bars`.
- `src/components/CopilotPanel.jsx` — `CopilotThread`, `CopilotInput`,
  `useAskCopilot`.
- `src/lib/format.js` — use these for every number/time.
- `src/lib/api.js` — `mjpegUrl(cameraId)` for the real camera stream.

## Rules

1. **Time**: every sim query uses `const ts = useTwinTime()` — the page must
   follow live time AND the replay cursor. Never call `Date.now()` for twin
   data (only for wall-clock UI like toast ids).
2. **Scope**: respect `scope` from the store. "portfolio" = all SITES;
   otherwise focus that site. Portfolio views use `siteRateSeries` for
   multi-site charts (cheap); single-site detail may use `siteSeries`.
3. **Real site**: `sample-lot` is backed by a live camera. When rendering
   its CURRENT snapshot in live mode pass the override:
   `siteSnapshot("sample-lot", ts, mode === "live" ? realOccupancy : null)`.
   Historical/replay queries never take the override.
4. **Memoize**: wrap sim calls in `useMemo` keyed on a COARSE time bucket
   (e.g. `Math.floor(ts / 30000)` for lists, `Math.floor(ts / 5000)` for
   KPIs) so re-renders stay cheap. Series/session scans over big ranges:
   bucket by minute.
5. **Visual**: dark control-room, dense (Linear/Datadog). Use tokens +
   existing classes only. `.num` on every numeral. NO new fonts, NO
   gradients on text, NO side-stripe borders, cards ≤ radius 10px, no
   decorative shadows. Tables for lists, `Stat` for KPIs, `Pill`/`Dot` for
   status. Every list needs hover, selected, and empty states; every async
   surface a sensible default.
6. Page root: `<div style={{ padding: 16, display: "grid", gap: 12 }}>` or
   similar; the shell gives you a scrollable main region; page must never
   scroll horizontally.
7. Only write YOUR page file(s). No new dependencies. No edits to
   foundation files. jsx only.
8. Interactions that would be cross-page: navigate with
   `useNavigate()` from react-router-dom (routes: /sites /twin /analytics
   /events /enforcement /reports /copilot /settings), set scope via
   `setScope(siteId)`, open copilot via `setCopilotOpen(true)` +
   `useAskCopilot()(query)`.
