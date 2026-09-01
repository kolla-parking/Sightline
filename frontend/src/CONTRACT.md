# Version-10 dashboard — module contract

You are building ONE page module of the Sightline operator dashboard. The
foundation (design system, simulation engine, store, shell, primitives) is
DONE — read it, use it, do not modify it. Your page renders inside the app
shell (`components/Shell.jsx`) which already provides the left sidebar
(mark + wordmark + OPS tag, grouped job-named nav, Settings + link
telemetry in its footer), the topbar (⌘K search affordance, replay pill +
clock, site scope select, copilot toggle, session cluster), the ⌘K command
palette, and the copilot side panel.

## Read these files before writing code

- `PRODUCT.md` (repo root) — product + register
- `src/styles/tokens.css`, `src/styles/base.css` — ALL tokens + component
  classes (`.panel`, `.btn`, `.table`, `.pill`, `.input`, `.select-wrap`,
  `.empty`, `.drawer`, `.scroll`, `.row`, `.num`, `.page-title` …). Use these
  classes + inline style with `var(--token)` values. No new CSS files.
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

## Brand foundation — Daylight v3

Token VALUES derive from `/BRAND.md` (the brand system's single source of
truth — read it; this is only the console-side summary); token NAMES in
`tokens.css` are the console's stable API and never change. What every page
gets by construction:

- **Light-first, dark-engineered.** Light (sage-cast neutrals, white
  panels on a `#FBFCFB` ground, sage-tinted layered shadows) is the primary
  experience and the `:root` default. Dark is a rebuilt second theme —
  green-cast surfaces that step LIGHTER as they elevate, hairline + surface
  elevation, shadows only on the modal layer — never an inversion.
- **Theme mechanics.** `theme` in the settings slice is `"system"` |
  `"light"` | `"dark"`, persisted in `sightline.settings.v1`, edited in
  Settings → Appearance. `App.jsx` mirrors explicit choices onto
  `document.documentElement.dataset.theme` (attribute removed for
  `"system"`, which then follows `prefers-color-scheme` via CSS);
  `index.html` pre-paints the same attribute before CSS loads so neither
  theme flashes.
- **The accent is Signal Green `#00E676`, used with Samsara discipline:**
  primary CTA fills (with `--accent-ink` dark labels — NEVER white), live
  indicators, key stat highlights, the mark's center cell. It is NEVER
  text or an icon on a light ground (1.7:1) and never a background field —
  green text/links/strokes use `--accent-text` (`#0B7A4B` light, `#00E676`
  dark). Focus rings use `--focus`.
- **The chrome is a left sidebar + topbar.** The sidebar (`--bg-2`, hairline
  right edge) carries the mark + wordmark + `OPS` tag, then job-named nav
  groups — Operate (Live `/twin`, Alerts `/events` with the live count
  badge, Copilot `/copilot`), Portfolio (Sites, Enforcement), Analyze
  (Analytics, Reports) — with Settings and the backend/stream telemetry in
  the footer. The topbar holds the ⌘K search affordance, replay pill +
  clock, scope select, copilot toggle, and session. Routes and the keyboard
  map (`g`-keys, `⌘K`, `\`, `l`, `[` `]`) are unchanged. Under 900px the
  sidebar collapses to an icon rail.
- **Type trio.** `--font-display` = Schibsted Grotesk — ≥28px display
  moments ONLY (`.display`: login/splash wordmark, full-page hero
  headings). `--font-ui` = Public Sans 400/600 — body, controls, labels,
  `.page-title`. `--font-data` = IBM Plex Mono — EVERY live number, ID,
  timestamp, stat, tag, table header (`.num`/`.mono`, `tabular-nums`).
  Uppercase only in mono tags and table headers.
- **Shape.** BRAND.md's 6/10/16 radius scale under the console's stable
  token names: `--r-1 6px` (chips/kbd/inputs), `--r-2 10px` (buttons),
  `--r-3 10px` (panels/cards), `--r-4 16px` (large media). Rounded-
  commercial — not pill, not sharp.
- **Status ≠ decoration.** Toned `.pill`s are Primer-style triad chips
  (tint bg + deep fg + tint border) — the only colored element in a healthy
  row. `--ok/--warn/--danger/--info` carry one meaning each.
- **The twin is ISA-101.** Healthy states are QUIET: free stalls a quiet
  outline, occupied stalls a muted neutral fill (`--stall-*` vocabulary).
  Saturation = abnormality only: red violation/offline, amber needs-
  attention, blue selected/info. (Green stays reserved for live indicators
  outside the stall canvas — the twin paints no green stall state.) Never
  color every stall. Stall/zone labels are dark text on small light chips.
- **Camera evidence keeps a dark surround** (`.evidence`, pure-black
  letterbox) even in the light theme — the sanctioned dark element.
- **Alerts follow the alarm doctrine** (`lib/alarms.js`): verb-first copy,
  tier ranking, rollup of repeats. The raw event firehose stays in quiet
  activity-log styling and never borrows alert-chip treatment.
- **The mark.** Use `Mark` from `components/ui.jsx` (3×3 grid, center cell
  `var(--accent)`, outer cells currentColor at 32%) — never redraw it,
  recolor outer cells, or rotate it.
- **Known limitation.** MapLibre GL layer colors (`twin/MapView.jsx`) are
  canvas-side constants mirroring the `--stall-*` vocabulary, picked ONCE
  at map init from the active theme (light Positron / dark basemap). They
  do not retheme while mounted — do not wire dynamic theme reading into GL
  layers.

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
5. **Visual**: light-first instrument, calm and dense (Linear/Stripe
   restraint). Use tokens + existing classes only. `.num` on every numeral.
   NO new fonts (Schibsted Grotesk exists only via `--font-display`/
   `.display` at ≥28px display moments), NO gradients on text, NO
   side-stripe borders, no decorative shadows beyond the shadow tokens.
   Tables for lists, `Stat` for KPIs, `Pill`/`Dot` for status. Every list
   needs hover, selected, and empty states; every async surface a sensible
   default.
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

## Vehicle identity (twin package)

- Store: `selectedPlate: string|null`. `selectPlate(plate)` opens the
  Vehicle drawer; `selectPlate(null)` closes it. Consumers outside the twin
  package call `useStore.getState().selectPlate?.(plate)` (optional-chain
  guard so packages build independently).
- `<VehicleDrawer/>` is mounted ONCE in `components/Shell.jsx`, so plate
  links work from any page (twin, alerts, copilot). Esc closes the topmost
  drawer only (capture-phase listener). Content: the plate's 48h session
  history from `findPlate`, memoized on (plate, 5s bucket), scan deferred
  one frame behind a skeleton.
- `PlateButton` (`components/ui.jsx`): renders a plate as a quiet
  accent-text mono link that calls `selectPlate` (stops row-click
  propagation). Use it anywhere a plate appears.

## Twin state filters

- `components/twin/stallFilters.js`: `STALL_FILTERS` (All / Overstays /
  Low conf / EV·ADA / Open) + `matchesStallFilter(filter, space, st)`.
- The active filter DIMS non-matching stalls (fill/stroke opacity) in BOTH
  projections — geometry is never hidden. State is TwinPage-local, shown as
  a dismissible chip, and composes with level chips + the replay cursor.

## Additive engine exports (sim/engine.js)

- `LOW_CONFIDENCE` (0.7): below it a session renders "unverified" — dashed
  stall outline (line treatment, same hue) + warn pill.
- `TURNOVER_MS` (3 min): sessions starting/ending within it show a quiet
  turnover dot (pulse in the schematic, static circle layer in GL; both
  reduced-motion-safe).
- `sessionPhase(session, ts)` → `{active, sinceStartMs, untilEndMs,
  turning, unverified}` — pure function of the session + ts, deterministic.
