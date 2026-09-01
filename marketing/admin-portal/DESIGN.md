# Sightline Admin Portal — design decisions (Daylight v3)

These are decisions, not defaults. Future edits (human or agent) inherit
them; change them deliberately or not at all. **Brand-level rules (tokens,
mark, type stack, theme switching, accent discipline) live in `/BRAND.md`
and win over anything here.**

## Shell
- Left rail (240px, `--bg-2` ground, hairline right edge): logo, five
  job-named views (Overview, Demo requests, Organizations, Audit log,
  Email outbox), then controls + identity pinned to the bottom. Below
  1000px the rail becomes a top bar with scrollable tabs.
- Active nav = raised `--surface` row with a 2.5px inset accent bar; the
  accent bar and the ADMIN wordtag are the only green in the chrome.
- Light is primary. Dark arrives ONLY through the `[data-theme="dark"]`
  token remap in `main.css` — portal.css contains no hand-picked dark hex.
- Theme follows `localStorage["sl-theme"]` (shared with marketing; unset
  honors `prefers-color-scheme`) via the pre-paint snippet in
  `index.html`. Density (`sl-density`: cozy/compact) rides the same
  snippet as `data-density` on `<html>`.

## Surfaces
- Page `--bg`, tables/panels/modals `--surface` with hairline `--border`
  + `--shadow-card`; hover rows `--fill`; expanded rows `--bg-2`. In dark
  these resolve to the rebuilt elevation steps automatically.
- One edge language per surface: hairline + card shadow on in-flow
  surfaces, `--shadow-drop`/`--shadow-modal` only on true overlays
  (toasts, modal). Modal scrim is fixed near-black at 45%, both themes.
- Radii from the brand scale: `--r-2` controls, `--r-3` frames. Status
  pills and filter chips are the only full-round (999px) shapes.

## Type
- Schibsted Grotesk for the page h1 only (28px floor). Public Sans for
  everything else. Plex Mono strictly for data: identifiers, timestamps,
  KPI numerals, table headers, filter chips, the env line. Never mono
  for prose.
- The ramp lives in `body.portal` variables — no ad-hoc rem values.
- Uppercase + tracking exists in exactly three places: table headers,
  detail-grid keys, and the ADMIN rail tag. Everything else mixed case.
- Numbers that update are `tabular-nums`. Money/count columns are
  right-aligned via `.num` and set in mono.

## Color and status
- Accent discipline per BRAND.md: `--accent` fills (primary buttons, the
  nav bar, the mark's center cell) always carry `--accent-ink`;
  green-as-text is always `--accent-text`. Signal green never appears as
  text on a light ground and never as a background field.
- Status pills are Primer triad chips (`--chip-*` tokens): tinted bg +
  deep fg + tinted border, dot in `currentColor`. The pill is the ONLY
  colored element in a table row — a failed payment is found by scanning
  one color down one column. Neutral pill = `--fill`/`--text-2`.
- Destructive UI (danger buttons, banners, danger zone, delta-down) uses
  `--danger`/`--chip-danger-*`. Danger fills are tinted, never solid.
- Focus ring is `--accent-text`, 2px, offset 2.

## Data display
- Tables: 48px rows by default, 40px under `data-density="compact"`
  (persisted). Hairline dividers, **no zebra**. Sticky mono headers on
  `--bg-2`. `.p-table-wrap` is the scroll container (internal scroll,
  max-height) so the page chrome never moves.
- KPI strip is one hairline-divided frame with an opinion: the two
  actionable numbers lead at `--fs-kpi-lg`; numerals are Plex Mono 500.
  Trends are quiet `.p-delta` suffix chips on the label (7-day window,
  named in the `title`) — never gradient text.
- "Needs attention" is a hairline-divided row list inside one panel —
  only real problems render, each with its one obvious action; the
  all-clear state is a single quiet line. Never a card grid.
- Lists paginate at 50: range text (`1–50 of 234`, tabular) left,
  Prev/Next ghost buttons right, hidden when everything fits. Changing
  any filter resets to page one.
- Empty states render inside the table (headers stay visible), copy says
  where data comes from, filtered-empty ≠ truly-empty.
- Timestamps: absolute local time, timezone declared once per view,
  exact ISO in the `title`.
- The org page's deployment summary reuses the KPI strip at `.is-mini`
  (sites, cameras, spaces, health); "—" means unknown; health is the
  server's word, shown as a pill.

## Motion
- Transitions only on state change; hovers are instant in tables, eased
  elsewhere; nothing moves on hover (no lift). Press = `scale(0.97)`.
- Exits are softer and faster than enters (150ms out vs 200–300ms in).
- Everything respects `prefers-reduced-motion`.

## Interaction
- Keyboard: `/` focuses the view's search, `Esc` closes the modal or
  collapses expanded rows, rows and id-chips are tabbable.
- Every mutating control has a disabled + label-swap busy state.
- Ids are click-to-copy.
- Errors follow the two-clause formula: what happened + what to do next.

## Security (non-negotiable)
- Every server-provided string interpolated into innerHTML goes through
  `esc()` (or the formatters that escape internally). Audit any new
  interpolation site before shipping.
