# Sightline — Marketing Site

Static multi-page marketing site built on the **Instrument v2** design
system (see `/BRAND.md` — it is law). No build step, no framework, zero
JS dependencies: Bricolage Grotesque display, IBM Plex Sans body, IBM
Plex Mono data, dual themes (ember default / signal) switched via
`<html data-theme>` + `localStorage["sl-theme"]`.

## Run it

```bash
cd marketing
python -m http.server 8090
# open http://localhost:8090
```

A local server is required (the detection replay fetches
`assets/data/slots.json`).

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Home — typographic hero, live replay monitor, capability ledger, pipeline strip |
| `platform.html` | The product + technology deep dive (`#engine #pipeline #console #analytics #privacy`) |
| `solutions.html` | Verticals: `#operators`, `#campuses`, `#curb` |
| `pricing.html` | The real plans ($99/$299/$999) + FAQ |
| `compare.html` | Five ways to count a space — grounded vendor comparison |
| `live-demo.html` | "Proof" — the real detection replay |
| `insights.html` (+ `insight-*.html`) | "Writing" — editorial index + essays |
| `about.html` / `contact.html` / `demo.html` / `login.html` | Company, contact form, demo form, console sign-in pointer |
| `privacy.html` / `terms.html` | Legal |
| `product.html` / `technology.html` / `features.html` | Redirect stubs → `platform.html` (noindex) |
| `admin-portal/` | Internal admin portal (unlisted, `noindex`) — requires the backend API with `ADMIN_EMAIL`/`ADMIN_PASSWORD` set; see `.env.example` |

## Notes

- **Machinery**: `assets/js/main.js` — reveals (IntersectionObserver),
  nav/sheet, theme toggle, form POST wiring; `assets/js/replay.js` — the
  vanilla-rAF detection replay (reads occupancy colors from tokens).
- **Forms**: demo/contact POST JSON to the backend
  (`/public/demo-requests`, `/public/contact-requests`) with a honeypot
  (`name="website"`) and busy/soft-error states. API base defaults to
  `http://localhost:8000`; override with `window.SIGHTLINE_API` before
  `main.js`. The newsletter input is front-end only. Replace the
  placeholder email in `contact.html` before launch.
- **Dev flags**: `?noanim=1` renders final states with no motion
  (also honored for `prefers-reduced-motion`).
- **Launch checklist**: OG/Twitter images and `sitemap.xml` locs are
  root-relative — absolutize to the production domain at launch (each og
  block carries a comment); `robots.txt` disallows `/admin-portal/`.
