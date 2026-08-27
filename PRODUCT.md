# Sightline — Operator Dashboard (Version 10)

## What it is

Sightline is an AI parking-detection platform: RTSP camera feeds → YOLOv8 OBB vehicle detection → per-space occupancy. Version 10 rebuilds the operator dashboard from a single-camera demo into a multi-site **operations control room**: a live digital twin of every managed parking asset (surface lots, garages, on-street, airport, truck yards), with analytics, forecasting, alerting, enforcement, reporting, and an operations copilot.

## Register

`product` — design serves the task. The user is an operations manager in a dim monitoring room on large monitors, watching live occupancy across a portfolio for hours at a stretch. Dark mode is the default because the room is dark and the sessions are long. Benchmark: Linear's restraint + Datadog's density.

## Platform

web (Vite + React SPA, optimized for large monitors, responsive down to laptop)

## Users

- Parking operations managers (primary): live monitoring, alert triage, enforcement dispatch
- City / portfolio managers: cross-site comparison, forecasts, reports
- Technicians: camera health, calibration, debug feeds

## Data reality

One real camera feed exists (Sample Lot 1, 100 spaces, via the FastAPI backend's REST + WebSocket). All other sites, sessions, plates, forecasts, and alerts come from a deterministic in-browser simulation layer (`src/sim/`), built so a real backend can replace it interface-for-interface. The real feed is merged into the twin live; simulation is seeded and reproducible.

## Visual system

- One family: Inter (UI) + monospace stack for data (plates, timestamps, counts)
- Dark-first OKLCH tokens; restrained accent (brand red-orange, `--accent`) for primary actions, selection, live indicators only
- Occupancy vocabulary (fixed): available=green, occupied=muted red, violation=saturated red, special (EV/ADA/reserved)=blue, offline/unknown=gray
- 13px base, fixed rem scale, 8px spacing grid, radius ≤10px, hairline borders over shadows
- Density is a feature; empty decoration is not
