# Sightline — Marketing Site

Static multi-page marketing site for Sightline. No build step, no framework —
plain HTML/CSS/JS with GSAP + ScrollTrigger (vendored in `assets/vendor/`).

## Run it

```bash
cd marketing
python -m http.server 8090
# open http://localhost:8090
```

A local server is required (the hero fetches `assets/data/slots.json`);
opening `index.html` via `file://` will skip the detection animation.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Home — live-detection hero, manifesto, how-it-works (pinned), features preview, stats, demo CTA, newsletter |
| `features.html` | Six deep-dive feature sections with spec tables |
| `about.html` | Story, goal manifesto, principles, values |
| `demo.html` | Request-a-demo form |
| `contact.html` | Contact channels + message form |
| `privacy.html` / `terms.html` | Legal |

## Notes

- **Real product data**: the hero replays a genuine detection pass — the 100
  PKLot slot polygons from `assets/data/slots.json` drawn over the real camera
  frame, synced to a scan-line sweep. Counters land on the true 68 / 32 split.
- **Query params** (dev tooling): `?noanim=1` disables all animation (also
  honoured for `prefers-reduced-motion`); `&qa=1` additionally collapses
  viewport-height sections for full-page screenshots.
- **Forms** are front-end only (validation + success states). Wire the
  newsletter/demo/contact forms to a backend or service before launch, and
  replace the placeholder email in `contact.html`.
- Fonts load from Google Fonts (Space Grotesk / Inter / JetBrains Mono);
  everything else is local.
