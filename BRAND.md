# Sightline Brand System — "Daylight" (v3)

Sightline is **per-space truth for parking assets** — an instrument, not an
app. Every surface should look like it was designed by people who run
infrastructure: earned specificity over aspiration, measurement over
metaphor. One real 100-space lot ("Lot A") is the entire brand; its honesty
is the differentiator. This document is law for every surface. It is built
on researched parking/mobility industry patterns (Metropolis, AirGarage,
Flash, Samsara, Verkada; Stripe for back-office; ISA-101 for the twin).

**Craft bar — world-class B2B restraint.** The reference class is Linear
(extreme restraint, product-as-hero, precise spacing/type), Stripe
(hierarchy, proof-driven calm confidence), Vercel (technical credibility,
sharp accents, clean dark surfaces), Raycast/Arc (personality without
chaos). Practically: restraint over decoration; clarity of message above
all; the type ramp and spacing rhythm carry hierarchy, not ornament;
motion only when purposeful; light mode is the polished primary
experience; dark mode is engineered (elevated surfaces, correct contrast —
never muddy, never inverted); the accent is precise and rare. If a
detail doesn't sharpen the message, delete it.

## Modes

**Light is the primary experience everywhere.** Dark is a second
first-class theme — rebuilt, never inverted. Switch = `<html
data-theme="dark">`; marketing + portal persist `localStorage["sl-theme"]`
(`light`|`dark`; unset honors `prefers-color-scheme`); console persists
`theme` in `sightline.settings.v1`. Components reference tokens only.

### Light (sage-cast neutrals — never pure #000/#fff as text/ground pair)

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#FBFCFB` | app/page ground |
| `--bg-2` | `#F4F7F5` | tinted sections, table headers |
| `--surface` | `#FFFFFF` | cards, panels, inputs |
| `--fill` | `#ECF0ED` | component rest fill |
| `--fill-hover` | `#E3E8E5` | hover |
| `--fill-press` | `#DAE1DC` | pressed/selected |
| `--border` | `#CFD7D2` | card/table hairline |
| `--border-2` | `#BDC7C1` | input/interactive border |
| `--border-3` | `#A5B1AA` | border hover |
| `--text-3` | `#5A655E` | secondary text (≥4.5:1 everywhere it sits) |
| `--text-2` | `#3D4A44` | strong secondary |
| `--text-1` | `#151B17` | primary ink (green-cast near-black) |

Elevation on light: hairline `--border` + **sage-tinted layered shadows**
(never `rgba(0,0,0,…)`): card `0 1px 2px hsl(152 22% 15% / .06), 0 2px 6px
hsl(152 22% 15% / .05)`; dropdown adds a 12px layer; modal adds a 32px
layer. One global top-light.

### Dark (rebuilt; adjacent surfaces differ ≥3–4 L* or merge)

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0F1412` | page base |
| `--bg-2` | `#141A17` | tinted sections |
| `--surface` | `#171D1A` | cards/panels |
| `--fill` | `#1D2420` | rest fill / rails |
| `--fill-hover` | `#232B27` | hover / menus / dialogs |
| `--fill-press` | `#2A332E` | pressed |
| `--border` | `#2A332E` | hairline |
| `--border-2` | `#3B463F` | interactive |
| `--border-3` | `#4C5850` | border hover |
| `--text-3` | `#9AA69F` | secondary |
| `--text-2` | `#C3CEC8` | strong secondary |
| `--text-1` | `#E4EAE6` | primary |

Dark elevation = surface lightness + slightly-lighter 1px border; shadows
only on modal. Pure black exclusively for camera-feed letterboxing.

## The accent — Signal Green, Samsara discipline

`#00E676` appears ONLY on: primary CTAs, live/active indicators, key stat
highlights, the mark's center cell. **Never text or icons on a light
ground (1.7:1), never a dominant background.**

| Use | Light | Dark |
|---|---|---|
| CTA fill | `#00E676` + `--accent-ink #08170F` label | same |
| CTA hover / press | `#00D06B` / `#00BA60` (darken) | `#2BEC8A` / `#00D06B` |
| Links, green text/icons | `--accent-text: #0B7A4B` (5.4:1 on white) | `#00E676` (10.9:1) |
| Live dot / sparkline | `#0B7A4B` stroke on light | `#00E676` |
| Focus ring | 2px `#0B7A4B` | 2px `#00E676` |

Status (semantic, one meaning each, never decorative): triad chips
Primer-style — light: ok `#DCFBE8/#0B6B3A/#A8EFC4`, warn
`#FEF0C7/#93370D/#FEDF89`, danger `#FEE4E2/#B42318/#FECDCA`, info
`#E0EAFF/#1D4ED8/#C7D7FE`; dark: 15%-tint bg over surface + bright fg
(`#4AEF9A`, `#FFC46B`, `#FF8A80`, `#8AB4FF`) + deep border. Text-level
status on light: danger `#D92D20`, warn `#B54708`, ok `#0B7A4B`, info
`#175CD3`.

## The mark

Unchanged construction: rounded-square 3×3 grid, center cell `--accent`
(#00E676), outer cells `currentColor` at 32% (renders in ink on light).
Favicon becomes light-ground:

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23FBFCFB'/%3E%3Cg fill='%23151B17' fill-opacity='.35'%3E%3Crect x='5' y='5' width='6' height='6' rx='1.8'/%3E%3Crect x='13' y='5' width='6' height='6' rx='1.8'/%3E%3Crect x='21' y='5' width='6' height='6' rx='1.8'/%3E%3Crect x='5' y='13' width='6' height='6' rx='1.8'/%3E%3Crect x='21' y='13' width='6' height='6' rx='1.8'/%3E%3Crect x='5' y='21' width='6' height='6' rx='1.8'/%3E%3Crect x='13' y='21' width='6' height='6' rx='1.8'/%3E%3Crect x='21' y='21' width='6' height='6' rx='1.8'/%3E%3C/g%3E%3Crect x='13' y='13' width='6' height='6' rx='1.8' fill='%2300E676'/%3E%3C/svg%3E" />
```

Inline mark SVG: same geometry as v2, center `fill="var(--accent)"`.

## Typography

- **Display: Schibsted Grotesk** — ≥28px only, weights 500/700. Category-
  correct grotesque with its own voice.
- **Body/UI: Public Sans** 400/600 — government-issue neutrality that
  signals "a company cities can procure from."
- **Data: IBM Plex Mono** 400/500 — **THE typographic brand rule: every
  live number, space ID, timestamp, count, and stat — marketing included —
  sets in Plex Mono with `tabular-nums`.**

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,500;0,700;1,500&family=Public+Sans:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Marketing ramp: hero `clamp(2.6rem, 6vw, 4.75rem)/1.05` (Schibsted 700),
title `clamp(1.9rem, 3.6vw, 3rem)`, section `clamp(1.4rem, 2.4vw, 2rem)`,
lede `1.1875rem/1.7`, body `1.0625rem/1.7`, mono `0.8125rem`, label
`0.75rem` (Public Sans 600 or mono 500; uppercase allowed only for mono
labels + table headers).

## Space, shape, structure

- 8pt scale `--s-1…8 = 8 16 24 32 48 64 96 144`; generous but controlled.
- Radius `--r-1 6px` (chips/inputs) `--r-2 10px` (buttons/cards) `--r-3
  16px` (media/hero frames). Rounded-commercial, not pill, not sharp.
- Light pages breathe: white surfaces on the sage ground, hairline-ruled
  ledgers where data appears, no card soup (a card must contain a real
  artifact or it's a section, not a card).

## Voice, honesty, and the lot

- **The lot is the brand**: "Lot A — 100 spaces, one camera" is a named,
  recurring character. Its real numbers only (100 spaces · 1 camera ·
  5 fps · 68/32 split · <1s to console). **Never invent** observations,
  accuracy percentages, uptime days, customers, or testimonials.
- Marketing formula: claim → artifact from the real lot, every section.
  Exactly ONE dark full-bleed "evidence moment" per page maximum (the live
  occupancy widget/monitor) — the contrast shift says "this is live."
- CTAs: "See the live lot" (primary proof), "Book a demo", "Talk to us."
  Never SaaS verbs ("Start free", "Sign up").
- Nav (5 items): Product · Technology · The Lot · Data policy · Contact.
  Depth lives in the footer (Solutions, Pricing, Compare, Writing, legal).
- **Data policy is a design element**: a real, plain-language page —
  Sightline detects occupancy, not plates (no ANPR in the system);
  processing on the operator's hardware; state, not video, is retained.

## Tool surfaces

- **Console** (light default, honor prefers-color-scheme, dark for
  overnight): job-named nav; KPI band of five (occupancy, revenue today,
  active alerts, open violations, camera health) with sparkline + delta in
  mono; **ISA-101 twin**: stall geometry in quiet neutrals — saturation =
  abnormality only (red violation/offline, amber attention, blue
  info/selected, green live/resolved); camera evidence keeps a dark
  surround even in light theme; no persistent toolbars floating on canvas.
- **Admin**: Stripe restraint — table-first, 48px rows (40px compact),
  hairline dividers, no zebra, the status chip is the only colored element
  per row, numerics right-aligned mono, filters as removable chips,
  operator vocabulary in nav and errors ("Payment failed — card declined.
  Retry or send an invoice link.").

## Traps (from the research — hard rules)

1. Never color every stall on the twin — healthy is quiet neutral.
2. Never invert to make dark mode — remap tokens, re-spec elevation.
3. Never borrow scale: no mega-menus of unbuilt things, no anonymized
   mockups, no implied portfolio, no fake customers.
4. Never use #00E676 as text/icon on light or as a background field.
5. Never pipe raw detections into alert lists — alerts carry a verb, a
   tier, and dedupe; the firehose is an activity log.
