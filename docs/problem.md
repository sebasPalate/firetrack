# Firetrack — Harmonization of MODIS and VIIRS Hot Spots

**Event:** NASA Space Apps Challenge 2026
**Team:** 3 people — software engineer (dev), mechanical engineer, industrial engineer
**Window:** Saturday 11:00 → Sunday 12:00 local time (25 h wall clock); code freeze Sunday 11:30, submission target Sunday 12:00, platform closes Sunday 23:59.
**Status:** problem definition draft, pre-implementation. Nothing is built yet.
**Scope of this document:** what the challenge really asks, what is technically hard, what we will build, who owns what.

> Derived from `docs/problema.md` (Spanish team working document, canonical). Regenerate this file from
> it before submission so both stay consistent.

---

## 1. The problem in one paragraph

Satellites have detected active fire hotspots for 25+ years, but the record is split across sensors
(MODIS: 2000→, VIIRS: 2012→) with different spatial resolution, sensitivity and overpass schedules.
Their raw detection counts are **not comparable**, so nobody can honestly answer "was this month
unusually fiery?" from the combined record. We must (a) produce one harmonized time series from
MODIS + VIIRS hotspots, and (b) deliver a web application that turns it into a burning activity
calendar for a user-selected area, so emergency responders can see seasonal patterns, compare a
current month against its historical median, and download the underlying detections.

## 2. What the challenge literally asks for

Two phases, both required:

1. **Harmonization** — "the sensor of origin no longer matters; patterns, trends and anomalies become the focus."
2. **Web application** — select a region + date range, visualize fire activity over time, download analytics.

Explicit requested outputs:

| # | Output | Source in challenge text |
|---|---|---|
| O1 | Burning activity calendar, early 2000s → present, harmonized | "A calendar of burning activity ... would give emergency managers a view of the fire history" |
| O2 | "Which periods of the year see more fires / which years had more burning activity" | same paragraph |
| O3 | Current month vs historical median comparison | "compare the burning activity of the current month against the historical median" |
| O4 | Region selection (draw AOI, or lat/lon input) | "Potential Considerations" |
| O5 | Accessible color ramps | "Consider using accessible color ramps" |
| O6 | CSV download of hotspots in the search | "A downloadable CSV File of hot spots detected during a search" |
| O7 | Anomalies against multi-year averages | "Historical comparisons, including anomalies against multi-year averages" |

Optional but high-value: FRP/intensity, sensor provenance display, preset regions, live near-real-time tail.

## 3. The technical crux (this is the whole challenge)

Raw hotspot counts are an artifact of instrumentation, not of fire:

| Property | MODIS (Terra, Aqua) | VIIRS (S-NPP, NOAA-20, NOAA-21) |
|---|---|---|
| Nominal pixel | 1 km | 375 m (I-band), aggregated to ~750 m |
| Satellites in record | 2 (both end-of-life) | 3 (S-NPP 2012→, NOAA-20 2018→, NOAA-21 2022→) |
| Overpasses/day | 2 per satellite (~10:30/22:30, ~13:30/01:30 local) | 2 per satellite, ~13:30/01:30 local |
| Record start | Nov 2000 | Jan 2012 |
| Confidence field | `confidence` 0–100 (numeric) | `confidence` l / n / h (categorical) |
| Effective detections | fewer, coarser pixels | roughly 3–10× more detections for the same fire complex `[VERIFY in data audit]` |

**Consequence:** a calendar that naively plots January 2005 next to January 2024 shows a jump that is
mostly "we added three VIIRS satellites". That is the exact failure mode the challenge is designed to
punish. Harmonization is not preprocessing here — it is the deliverable.

### Candidate harmonization strategies

| ID | Strategy | Pros | Cons |
|---|---|---|---|
| H1 | Aggregate to a coarse grid + normalize by observation opportunity | principled, cheap | needs overpass/valid-observation counts, which FIRMS doesn't hand you cleanly |
| H2 | **Overlap-period calibration**: use 2012→present where both sensors run, derive per-cell monthly scaling factor, apply it to VIIRS-era data | directly answers "make them comparable", demonstrable with a validation plot | needs enough overlap samples per cell; sparse cells need regional/global fallback |
| H3 | **Binary presence** per cell-month (fire / no fire) | nearly sensor-independent, very cheap | loses intensity information |
| H4 | FRP-weighted or confidence-thresholded counts | physically meaningful | still resolution-biased, needs assumptions |

**Proposed choice:** H2 as the primary series, H3 as an independent sanity check, both computed at
**0.25° and 1° grid, monthly resolution**, at least mode over the full record. Deliver it explicitly as
a *harmonized activity index*, not as "number of fires" — that framing is honest and defensible to
judges. Keep native counts available in the CSV export with a `sensor` column, so provenance is never lost.

Overlap window sanity check: if the calibrated index doesn't reproduce the MODIS-only trend during
2012–2015 (where both exist), the method is wrong and we say so.

## 4. Data

### 4.1 FIRMS Area API (verified 2026-11-14 on firms.modaps.eosdis.nasa.gov/api/area/)

```
GET /api/area/csv/[MAP_KEY]/[SOURCE]/[WEST,SOUTH,EAST,NORTH]/[DAY_RANGE]          # most recent
GET /api/area/csv/[MAP_KEY]/[SOURCE]/[WEST,SOUTH,EAST,NORTH]/[DAY_RANGE]/[DATE]   # DATE .. DATE+DAY_RANGE-1
```

- `SOURCE` ∈ `MODIS_SP`, `MODIS_NRT`, `VIIRS_SNPP_SP`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_SP`, `VIIRS_NOAA21_NRT`, `LANDSAT_NRT` (US/Canada only).
- **`DAY_RANGE` is 1..5 only.** Rate limit: 5000 transactions / 10 min; a request counts as multiple transactions for multi-day ranges.
- Coordinates must be a bbox or the literal `world`.

**Hard consequence:** 25 years × 5-day windows ≈ 1800 requests per sensor — technically inside the rate
limit but useless for a fresh AOI on demand. **The historical record must be precomputed offline and
shipped as a compact artifact.** Live FIRMS calls only serve the "current/recent tail".

### 4.2 Bulk historical data — open technical question

`[VERIFY]` Bulk annual archives (via the FIRMS download portal, which requires an account) are the
right path. Must confirm: file naming, per-sensor yearly coverage, total download size, and whether an
already-extracted sample can be committed to the repo instead. **This is the single biggest schedule risk.**

### 4.3 Fields that must be harmonized

Common: `latitude`, `longitude`, `acq_date`, `acq_time`, `satellite`, `instrument`, `frp`, `daynight`, `type`.
Divergent: `brightness`/`bright_ti4`, `bright_t31`/`bright_ti5`, `scan`, `track`, `confidence` (0–100 vs l/n/h), `version`.
Harmonized schema: single table with `sensor`, `platform`, `pixel_km`, `confidence_score` (0–1 normalized), `frp`, `datetime_utc`, `cell_id`.

### 4.4 Volume

Global yearly archives are large (order of millions of detections per sensor-year) `[MEASURE in audit]`.
Decision to make: precompute **global at coarse grid** (small output, full coverage) vs **fine grid over
5–10 preset regions** (better visuals, limited coverage). Recommendation: global at 0.25°/monthly for the
calendar, plus an on-demand extract path for CSV.

## 5. Scope

**Must have (demo cannot exist without it)**
1. Precomputed harmonized monthly grid dataset, 2000→2026, MODIS + VIIRS.
2. Web app with bbox/lat-lon AOI selection and date range.
3. Burning calendar heatmap (month × year) on harmonized values, accessible ramp, legend, hover values.
4. Month-of-year seasonality view and year-total view.
5. Current month (or selected month) vs historical median, with a clear "anomaly" call-out.
6. CSV download of the detections behind the current view.
7. Visible provenance: sensors used, harmonization method, caveat that values are an index.

**Should have**
8. Map layer of hotspots for the AOI/range.
9. Preset sensitive regions (Amazon, Cerrado, California, Mediterranean, Australia, Chaco).
10. Shareable URL encoding AOI + range.
11. FRP/intensity toggle.

**Won't have (v1)**
- Free-hand polygon drawing (bbox only; latitude/longitude is accepted by the challenge text).
- User accounts, database-backed history, live streaming beyond the recent tail.
- Per-pixel harmonization or physical radiative-transfer modeling.

## 6. Requirements (testable)

- **S1** User can define an AOI by bounding box (draw on map or type west/south/east/north). Invalid input shows a specific message and does not query.
- **S2** User can select a date range constrained to 2000-11-01 → present; the default is the full record.
- **S3** The burning calendar renders months (rows) × years (columns) from the harmonized series for the AOI, using a colorblind-safe sequential ramp, with a legend stating units ("harmonized activity index").
- **S4** For any selected month+year, the app shows the value, the multi-year median for that calendar month, and the anomaly as both absolute delta and percentage.
- **S5** The app renders the monthly time series over the selected range.
- **S6** The app renders month-of-year seasonality (mean or median per month across years) for the AOI.
- **S7** CSV download contains the harmonized fields plus raw native fields and `sensor`, for exactly the current AOI + range.
- **S8** A visible provenance panel states sources, harmonization method, overlap-calibration window, and known limitations.
- **S9** A typical AOI query returns from the precomputed store in under 2 s.
- **S10** Harmonization quality gate: during the overlap window, the calibrated index reproduces the MODIS-native series within a stated tolerance; a chart proving this exists in the repo and is linked from the app.

## 7. Demo script (what the judges see, 5 minutes)

1. Pick a region battered by fire (e.g. Brazilian Amazon, or Chaco given the CONAE photo credit) and the full record.
2. Calendar fills in: show the dry-season band, show 2024 vs 2005 **without** a sensor artifact jump — this is the "wow".
3. Hover a month: value, median, anomaly.
4. Toggle to seasonality and year totals.
5. Download the CSV live.
6. Show the calibration plot and state the limitation out loud. Judges reward honesty about method over a pretty but wrong chart.

## 8. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Historical archive access blocked or too slow (account, size) | kills harmonization | resolve in first 4 hours; fallback = one committed pre-extracted 10-year sample + document the gap |
| R2 | Harmonization judged not credible | weak submission | present an index, publish the overlap validation plot, disclose limits (S8, S10) |
| R3 | Scope creep into map drawing / auth / live data | no finished demo | bbox only, static presets, precomputed data |
| R4 | One developer on a data + web project | bottleneck | dev owns data pipeline first, UI skeleton second; non-devs own validation, requirements, QA, delivery |
| R5 | VIIRS confidence is categorical, MODIS numeric | silent filtering bug | normalize to one `confidence_score` in the pipeline, unit-test the mapping |
| R6 | Timezone/date drift in `acq_date` + `acq_time` | off-by-one months in the calendar | store UTC datetime, document the convention, test a known event |

## 9. Work split

Three tracks. Every track has deliverables per phase and a definition of done — no one waits on anyone else.

| Track | Owner | Owns | Definition of done |
|---|---|---|---|
| **A. Data & software** | Software engineer | Pipeline (ingest → normalize → grid → harmonize → store), backend/API, frontend calendar + charts, CSV export | S1–S9 pass on the demo AOI; repo reproduces the dataset from scripts |
| **B. Physical validation & sensor characterization** | Mechanical engineer | Sensor comparison: overpass geometry, pixel footprint vs scan angle, detection thresholds, FRP meaning; the calibration methodology; validation against known fire events (2019 Amazon, 2019–20 Australia, 2023 Canada); writes the method section | A calibrated method with a validation chart on real events, and a written statement of physical assumptions and their failure modes |
| **C. Product, metrics & delivery** | Industrial engineer | User/journey definition for emergency responders, metric definitions (what "anomaly" means operationally, thresholds, aggregation choice), QA plan and checklist, risk register, submission text, demo script, video, README for judges | Requirements signed off, QA checklist executed before each demo run, submission materials ready 90 min before deadline |

Why the non-devs get real work: this challenge is won or lost on **methodology credibility and
communication**, not on CRUD. Track B decides whether the numbers mean anything; Track C decides
whether anyone believes them.

Shared: daily 15-min sync, one decision log, one repo, one person commits (dev) unless agreed otherwise.

### Concrete ownership map

| Artifact | Owner |
|---|---|
| `data/` pipeline scripts | A |
| `docs/method.md` — harmonization math + validation | B |
| `docs/qa-checklist.md`, `docs/risk-register.md` | C |
| Web app | A |
| Demo script + video + submission form | C |
| Preset AOIs and their justification | B + C |

## 10. Timeline (30 h wall clock)

> **Superseded:** the canonical schedule is now 25 h with a Sunday 11:30 code freeze, see
> `docs/problema.md` §11. This table is kept for reference only.

| Block | Clock | Goal | Owner |
|---|---|---|---|
| **B0 Kickoff** | Sat 11:00–12:30 | D1–D5 decided, stack fixed, repo skeleton ready | All |
| **B1 Data audit** | Sat 12:30–15:00 | `MAP_KEY`, archive access confirmed or fallback chosen, one AOI loaded for 3 sensors, schema mapped | A (B in parallel: validation event table) |
| **B2 Pipeline v0** | Sat 15:00–21:00 | normalized dataset + 0.25° harmonized grid, full record, S10 calibration chart | A |
| **B2b Parallel** | Sat 15:00–21:00 | method write-up + validation events / requirements frozen + demo script | B / C |
| **Dinner + sync (G1)** | Sat 21:00–22:00 | gate review | All |
| **B3 App core** | Sat 22:00–Sun 02:00 | AOI + range → calendar + median working on real data | A |
| **Rest** | Sun 02:00–08:00 | sleep, mandatory | All |
| **B4 Validation + QA** | Sun 08:00–12:00 | S10 validated on real events, CSV, provenance panel, QA pass | B/C + A |
| **B5 Polish + deploy** | Sun 12:00–15:00 | seasonality, map, accessibility, stable public URL | A |
| **B6 Submission** | Sun 15:00–16:30 | video, README, form, rehearsal | C |
| **Buffer** | Sun 16:30–17:00 | margin, nothing new | All |

### Decision gates (cut scope, never stretch time)

- **G0 — Sat 12:30.** No stack or no D1–D5: fall back to the minimum — Python pipeline + single-page app, no framework.
- **G1 — Sat 21:00.** No harmonized grid: cut to MODIS + VIIRS S-NPP with global (not per-cell) calibration and continue. No historical data: drop to a 3–5 year window via the API with a committed cache and state the limitation in the provenance panel.
- **G2 — Sun 02:00.** If the calendar does not render real data, Sunday goes into that and the map, seasonality and presets are dropped.
- **G3 — Sun 12:00.** If CSV or provenance panel are missing, CSV wins: it is an explicit challenge requirement.
- **G4 — Sun 15:00.** Code freeze. No new features after this clock time.

## 11. Open decisions (close them in B0, 20 minutes)

- **D1** Stack: Python (DuckDB/pandas) pipeline + static frontend, or Python + FastAPI + React/Vite.
- **D2** Global coarse grid vs preset regions at fine grid.
- **D3** Sensor set: MODIS + VIIRS S-NPP only (simplest, defensible), or add NOAA-20/21.
- **D4** Whether to commit the precomputed dataset to the repo (size vs reproducibility).
- **D5** Where the demo is hosted (stable public URL).

## 12. Next actions

1. Get FIRMS `MAP_KEY`; test one AOI request for `MODIS_SP` and `VIIRS_SNPP_SP`.
2. Confirm bulk yearly archive access and size (R1).
3. Measure real detection volumes; pick the grid resolution with evidence.
4. Agree D1–D5 in one 20-minute call.
5. Freeze S1–S10 as the acceptance contract; anything new goes to "Should have".
