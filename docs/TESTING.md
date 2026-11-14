# Test results (delivery build, 2026-11-14)

## Python unit + API tests (20/20 pass)
`python3 -m unittest tests/test_pipeline.py tests/test_server.py`

VICAR readers (REAL/FULL/HALF/BYTE), GRS table parsing with NA handling, nodata-aware block reduction, slope of a known 5° plane, gazetteer DBF reader, SIM 3292 age parsing, package integrity (every grid size matches its metadata), provenance completeness, no synthetic data, SWIM outside coverage = nodata, rover images positioned, API health/point/missing/longitude-wrap/bad-input/craters.

## Browser end-to-end (16/16 pass, headless Chromium)
```
PASS overview loads
PASS location panel shows Jezero — Location Intelligence Jezero 18.408°N, 77.687°E 13/20 datasets with values here 
PASS elevation shown with status
PASS rover proximity Perseverance
PASS geolocated images near Jezero — 6 images
PASS polar point reports TI unavailable (no invented value)
PASS layer legend visible after toggle
PASS missions produce candidates — {"water_ice":["Arcadia Planitia","Arcadia Planitia (48.5°N 197.5°E)","Arcadia Dorsa"],"habitat":["Arcadia Planitia","Acidalia Planitia","Hellas Planitia · Talas"],"mineral":["Nectaris Fossae · Capri Montes","Melas Fossae · Mazamba","Memnonia Fossae · Teknaf"]}
PASS recommendations change with mission objective
PASS four route alternatives computed —  Safest Shortest feasible Science priority Resource priority Distance 115 km 115 km 115 km 115 km Estimated time ~2 sols ~2 sols ~2 sols ~2 sols Climb 144 m 144
PASS elevation profile drawn
PASS report has routes, limitations and sources
PASS Arabic switches to RTL
PASS Arabic navigation labels
PASS mobile: no horizontal overflow — scrollWidth 390
PASS no page errors
```

## Scientific scenario checks (16/16 pass)
```
PASS Olympus summit > 20 km
PASS Hellas floor < -6.5 km
PASS Jezero ~ -2.6 km
PASS dose ordered hellas<gale<olympus
PASS Gale dose ~0.21
PASS Arcadia SWIM > Meridiani SWIM
PASS north polar cap strong ice evidence
PASS TI at 85N unavailable
PASS GRS masked at 75S
PASS ice missions favour higher latitudes than agriculture
PASS max distance respected
PASS flat-plain route within 3% of great circle
PASS Olympus Mons crossing: both routes found
PASS safest route avoids steeper terrain than shortest
PASS shortest is not longer than safest
PASS Gale centre inside 154 km crater
```

Notable outputs: water-ice ranking led by Arcadia Planitia (consistent with Morgan et al. 2021). Olympus Mons crossing: safest route detours to ~1,563 km with 3° max slope vs shortest ~1,374 km with 9.8°. Flat-plain route = 1.002 × great-circle distance.

Screenshots: tests/shots/*.png
