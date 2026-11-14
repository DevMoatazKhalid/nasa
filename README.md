# MESIS — Martian Exploration & Survival Intelligence System

A data-driven Mars exploration, resource-intelligence, mission-planning and navigation platform.
Click any point on Mars and get every available measurement for it, with its source and data status.
Rank destinations for seven mission types, plan terrain-aware routes, and export mission reports, in
English or Arabic (RTL).

**No synthetic data is used.** Every value is labelled *Measured · Published · Derived · Modeled ·
Inferred · Unavailable*. Missing data is shown as missing and is never filled in from neighbouring
locations. All data are archival (1997–2026), not live.

## Run it

**Quickest (no build):** the zip already contains the built site in `web/dist`.
```bash
python3 server/server.py --port 8000            # needs Python 3.9+ and numpy; open http://127.0.0.1:8000/
```
**Rebuild the front end:**

```bash
# 1. build the site (needs Node 18+)
cd web && npm install && npm run build          # -> web/dist (37 MB incl. data package)
# 2. serve site + API (needs Python 3.9+ and numpy)
python3 ../server/server.py --port 8000          # open http://127.0.0.1:8000/
```
Any static web server also works for the UI alone (`python3 -m http.server -d web/dist`).

### Rebuild the data package from source files
```bash
pipeline/run_all.sh <downloads_dir> <crater_csv> <swim_dir> <names_dir>
```
Dependencies: Python 3, numpy, Pillow, matplotlib (no GDAL needed). The source files and where to get
them are listed in `docs/DATA_SOURCES.md`.

### Tests
```bash
python3 -m unittest tests/test_pipeline.py tests/test_server.py      # 20 tests: readers, terrain math, package integrity, API
cd web/dist && python3 -m http.server 8765 &                          # then, with Playwright installed:
node tests/e2e.mjs http://localhost:8765/ tests/shots                 # 16 UI checks (EN/AR, RTL, mobile, every module)
node tests/scenarios.mjs http://localhost:8765/                       # 16 scientific scenario checks
```
Results from the delivery build are in `docs/TESTING.md`.

## Structure
```
pipeline/   reproducible preprocessing (MOLA, TES/ASU VICAR, GRS, SWIM, SIM 3292, gazetteer, rovers, craters)
            build_package.py writes the central data registry (manifest.json) + gzip grids
server/     stdlib HTTP server: static site + /api/registry, /api/point, /api/craters
web/src/engine   analysis engine, no UI code: data access, location query, radiation model,
                 mission scoring, A* routing, reports
web/src/ui       React components (map canvas, panels, pages, AI assistant)
web/public/data  the built data package (grids *.bin.gz, manifest.json, names, rovers, images, audit)
tests/      unit, API, browser end-to-end and scientific scenario tests
docs/       data sources, limitations, testing results
```

## Architecture decisions (and why they differ from the suggested stack)
* **Static data package + client-side engine instead of FastAPI + PostGIS.** The platform is
  delivered as a hosted page that cannot reach external services at runtime. All grids are
  preprocessed into compact, gzip-compressed, georeferenced binaries (≤ 8 ppd) with full metadata, and
  the engine (point queries, scoring, A*) runs in the browser in ~10–300 ms. The Python server provides
  the same data over a JSON API for scripted use. PostGIS would be the right next step for vector-heavy
  extensions (CRISM footprints, HiRISE footprints); the registry format maps directly onto tables.
* **Custom canvas map instead of Leaflet/Cesium.** Leaflet tiles assume Earth-style web-mercator
  tiles. Here the map is a simple-cylindrical, planetocentric, east-positive (0–360°E) Mars grid
  that exactly matches the data grids. Two-dimensional only: a 3D globe would add decoration, not analysis.
* **Scientific logic is separate from UI**: `web/src/engine/*` has no React imports and is
  type-checked under `--strict`.

## Modules
Overview · Mars Explorer (layer manager with legends, opacity, sources) · Location Intelligence ·
Mission Planner (7 mission types, documented weights) · Smart Navigation (safest / shortest /
science / resource routes, waypoints, mobility assumptions, profiles) · Survival Intelligence ·
Data & Sources (registry, unavailable datasets, audit of your files) · Mission Reports
(HTML/JSON/Markdown). An AI mission assistant answers only through tools that call this engine.

## Key limitations (full list: docs/LIMITATIONS.md)
Terrain cells are 7.4 km and mission cells 1°, so the routes are strategic corridors, not rover-grade
navigation. Ice evidence is indirect except mapped polar ice units. The radiation layer is a GCR model
anchored to Curiosity/RAD. There are no gridded temperature or atmospheric-dust products. TES mineral
abundances are near their detection limits.
