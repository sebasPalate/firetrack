# Custom area of interest (inside Spain)

Objective: let the user define an area of interest by drawing a rectangle on the map or typing latitude/longitude, and get the harmonized calendar, map and CSV for it, computed client-side from the published Spain detections.
Branch: `feat/custom-aoi` (from `develop`) · Delivery: ask-on-risk · Test runner: `node --test` (Node 24 type stripping) for `apps/web/tests`, `npm run lint`, `npm run build`.

## Specs

- S1. Challenge requirement (quoted): "a map where users can draw the area of interest, or an option to enter latitude and longitude." Both inputs are offered: drag a rectangle on the map, and a west/south/east/north form.
- S2. Scope chosen by the user: "Dentro de España (Recommended)" — computed in the browser from the Spain detections already published, with Spain's monthly factors; the static demo keeps working on Pages without a backend. An area outside Spain has no data and is rejected with a clear message.
- S3. The custom calendar uses the same algorithm as the pipeline (`pipeline/harmonize.py` `build_calendar`, `pipeline/payloads.py` `calendar_payload`): per month the source satellite, `partial`, `provisional` and `observed_days` come from Spain's calendar (they are region-independent); the index divides the source satellite's count inside the box by Spain's factor for that sensor and month; `median_by_month` and `anomaly_pct` follow `payloads.py`. Proof: a box covering the whole Spain dataset reproduces `calendar/spain.json`.
- S4. Assumption (documented as a limitation in the UI): a custom area borrows Spain's calibration and validation as-is; it is not validated on its own.
- S5. The CSV export for a custom area contains only the detections inside the box for the selected year range.
- S6. The custom area is part of the shareable link (`?region=custom&aoi=w,s,e,n`).

## Tasks

- [x] T1 (S3, S5) inline — pure `src/lib/aoi.ts`: box validation, CSV row filter, per-month counts, calendar builder; tests in `apps/web/tests`.
- [ ] T2 (S1, S2, S4, S6) inline — UI: custom area in the Area select, lat/lon form, draw mode on the map, URL state, CSV export, limitation notice.

## Log

- L1 (2026-11-21, user): "Se a cumplido el objetivo del proeycto en este repositorio? debemos mejorar la UI en una nueva rama?" → after the gap analysis: "Vamos con la AOI", scope "Dentro de España (Recommended)".
- L2: Explorer mapped the algorithm. Published CSVs are already confidence-filtered, static-source-free and clipped to Spain, so a sub-area only needs a lat/lon filter. Aragón fits its own calibration (shrunk to Spain's shape); a custom box cannot, because sensor completeness is not published, hence S4. Route: inline (no parallel units, no context backstop).
- L3: T1 GREEN. `npm test` (node --test) 6/6; the whole-Spain box reproduces `calendar/spain.json` cell by cell (harmonized, raw_count, partial, provisional, source, factor, observed_days, median_by_month, anomaly_pct). Mutation check (NOAA-20 factor without the tail factor) fails both S3 tests, then green after restore. CI web job now runs `npm test`.
