# Firetrack — Harmonization of MODIS and VIIRS Hot Spots

**Event:** NASA Space Apps Challenge 2026 — *Harmonization of MODIS and VIIRS Hot Spots*
**Status:** pipeline, artifacts, API and web app working; validated results for Spain and Aragón.
**Language:** submission document for the judges. The team working document is `docs/problema.md` (Spanish).

> Mirror of `docs/problema.md`, which is canonical. If the two diverge, the Spanish document wins.
> Regenerate this file from it whenever the canonical document changes.

---

# Part I — The problem

## 1. What we count: a hotspot is not a fire

A satellite does not see fires. It sees **pixels that are hotter than their surroundings**, and each of
those pixels counts as a hotspot.

- **1 fire ≠ 1 hotspot.** A large fire can occupy dozens of pixels. A small stubble burn is one pixel, or none.
- What we count are **hot pixels**, not fires.

The whole language of the product depends on this distinction. The app never says "340 fires"; it says
activity index. If a judge or a user reads "fires", the number is false.

## 2. The problem: two different cameras looking at the same fire

Imagine counting the people in a square with two cameras:

| | MODIS (old camera) | VIIRS (new camera) |
|---|---|---|
| Pixel size | ~1 km × 1 km | ~375 m × 375 m |
| Since | 2000 (Terra), 2002 (Aqua) | 2012 (S-NPP), 2018 (NOAA-20), 2024 (NOAA-21) |
| Detects small fires | poorly | much better |
| Overpass (local) | ~10:30 (Terra) and ~13:30 (Aqua) | ~13:30 and ~01:30 |

About **seven VIIRS pixels fit inside one MODIS pixel** (1000 / 375 ≈ 2.67; 2.67² ≈ 7.1). The same 1 km²
fire yields **one MODIS hotspot and roughly seven VIIRS hotspots**. On top of that, VIIRS detects small
burns that MODIS never sees.

![Pixel diagram: on the left, one 1 km MODIS pixel with the 375 m VIIRS grid overlaid. Centre and right, the same fire seen by each sensor: MODIS marks 4 hotspots and misses the small burn; VIIRS marks 10 and sees it.](img/pixeles_modis_viirs.svg)

The fire is exactly the same in both cases, yet VIIRS counts more than twice as many hotspots. And the
small burn on the right does not appear in MODIS at all.

**Consequence:** plot the historical series as-is and the count explodes in 2012 and again in 2024. It looks
like there is suddenly far more fire, when the only thing that changed is how many cameras are counting.

![Chart: raw hotspot counts (top) versus the harmonized index (bottom), yearly totals for Spain from 2001. The raw series jumps when Suomi-NPP joins in 2012 and inflates in 2024 with NOAA-21 already flying; the index follows the fires, not the camera.](img/salto_2012.svg)

> It is like swapping the traffic radar for a more sensitive one and concluding that people drive worse.

## 3. Why dividing by seven is not enough

The difference between sensors **changes with the season**:

- **Dry season (large fires):** both sensors see the fire and VIIRS merely splits it into more pixels. The
  difference is moderate.
- **Small agricultural burning season:** MODIS barely sees any of it and VIIRS sees all of it. The
  difference is enormous.

Made-up example: in August VIIRS counts 6× MODIS, and in February 15× MODIS. A single factor for the whole
year would be wrong almost every month.

![Bar chart: how many VIIRS hotspots there are per Aqua hotspot in each month of the year. Agricultural burning months have high factors and dry-season months low ones. A line showing the single factor demonstrates that it fails almost every month.](img/factor_por_mes.svg)

Purple bars are the months where a single factor would fall short, and green bars the months where it would
overshoot. **That is why we compute a different factor for each calendar month.**

## 4. The time of the snapshot matters too

Fire follows a daily cycle: it burns harder in the afternoon (heat and wind) and less before dawn.

| Satellite | Sensor | Overpass (local) |
|---|---|---|
| Terra | MODIS | ~10:30 |
| Aqua | MODIS | ~13:30 |
| S-NPP, NOAA-20, NOAA-21 | VIIRS | ~13:30 |

Comparing Terra with VIIRS would compare a mid-morning snapshot with an early-afternoon one.
**That is why we use Aqua as the reference:** it is the same kind of camera as MODIS, it crosses at the
same time as VIIRS, and it has run continuously from 2002 to today.

## 5. The number of satellites also changes over the years

| Year | What happens |
|---|---|
| 2000 | Terra only (MODIS) |
| 2002 | Aqua joins (MODIS) |
| 2012 | The first VIIRS joins (S-NPP) |
| 2018 | NOAA-20 joins (VIIRS) |
| 2024 | NOAA-21 joins (VIIRS), from 17 January in the FIRMS data |
| 2026 | S-NPP stops delivering data (2 November) |

The more satellites, the more overpasses and the more hotspots counted. That creates jumps in the series
that have nothing to do with fire: that is why the jump chart has **three steps**, not one.

---

# Part II — The challenge

## 6. What the challenge asks for

Two phases, both mandatory:

1. **Harmonize** MODIS and VIIRS hotspots, so the sensor of origin no longer matters and patterns, trends
   and anomalies become the focus.
2. **Build a web application** on top of that harmonized data. The user picks an area and a date range and gets:
   - A **burning activity calendar** (hotspots per month and year, from 2000 to today).
   - Which months and years had the most fire.
   - A comparison of the current month against the **historical median**.
   - Accessible color ramps.
   - A **CSV download** of the hotspots found.

### 6.1 Output contract

| # | Output | Where the challenge asks for it |
|---|---|---|
| O1 | Burning activity calendar, early 2000s → present, harmonized | "A calendar of burning activity ... a view of the fire history" |
| O2 | Which periods of the year see more fire / which years had more activity | same paragraph |
| O3 | Current month vs historical median | "compare the burning activity of the current month against the historical median" |
| O4 | Region selection (draw AOI, or lat/lon) | "Potential Considerations" |
| O5 | Accessible color ramps | "Consider using accessible color ramps" |
| O6 | CSV download of the hotspots in the search | "A downloadable CSV File of hot spots detected during a search" |
| O7 | Anomalies against multi-year averages | "Historical comparisons, including anomalies against multi-year averages" |

### 6.2 Optional suggestions in the challenge text

Users: early warning and emergency services, scientists, land managers and firefighters. An interactive map
for drawing the area or entering latitude and longitude. Few but clear indicators: anomalies against
multi-year averages and the number of detected fires.

### 6.3 Resources

The Resources tab has a single link: **[FIRMS – NASA Earthdata](https://www.earthdata.nasa.gov/data/tools/firms)**,
the source of the MODIS and VIIRS hotspots. In the Space Apps forum a participant estimates the global
historical record at roughly **45 GB of CSV** `[THIRD-PARTY ESTIMATE, unverified]`. That is why limiting
ourselves to regions makes sense instead of processing the whole planet.

Note: that link is a **catalog page**, not a data source. We read the hotspots from the Portolan mirror, a
public copy of FIRMS that needs no key (§9.3).

## 7. The solution: an exchange rate

It is like comparing 1995 prices in pesetas with 2020 prices in euros: first you convert them to the same
currency.

1. Take the period when **both sensors operate simultaneously** (2012 onward).
2. For each calendar month, compute *"when VIIRS sees X, Aqua sees Y"*. That is that month's exchange rate.
3. Convert the whole series into **Aqua MODIS units**, so 2005 and 2024 become comparable.

### 7.1 Why Aqua and not an average

Aqua is the only orbit that stays continuous from 2002 and spans the era of every VIIRS satellite, with the
same overpass time (~13:30). Calibrating against Aqua holds the diurnal cycle constant. Calibrating against
Terra (10:30) or against a MODIS average mixes a change of sensor with a change of observation time. Terra
only acts as a bridge for 2000–2002.

Implementation detail: ratio of totals per calendar month, **one factor per month, day and night
together**, with empirical-Bayes shrinkage for cells with few samples. Splitting day from night looks more
honest and measures worse: on the earlier Iberia box the half-day factors differ three- to seven-fold while
the day/night share drifts year to year, so correcting each half separately over-corrected by 45–280 %. With
one factor per month the shipped Spain region lands at a median |error| against Aqua of 10.1 % (worst year
32.5 %, 2018); the retired Iberia box measured 3.5 % (worst 12.6 %).

One VIIRS at a time: Suomi-NPP carries the series while it flies, and NOAA-20 only fills the tail after
S-NPP stopped (2026-11-02), with its own measured factor. Summing satellites is exactly the step this
project exists to remove.

### 7.2 Strategies considered

| ID | Strategy | Pros | Cons |
|---|---|---|---|
| H1 | Coarse grid + normalization by observation opportunity | principled | needs valid-overpass counts, which FIRMS does not deliver cleanly |
| H2 | **Overlap-window calibration** (ratio of totals per calendar month) | directly answers the problem, demonstrable | needs enough samples per cell |
| H3 | **Binary presence** per cell-month (fire / no fire) | nearly sensor-independent, cheap | loses intensity |
| H4 | Counts weighted by FRP or filtered by confidence | physically meaningful | still biased by resolution |

**Choice:** H2 as the primary series, H3 as an independent sanity check, both on a **0.25° and 1° grid**,
monthly resolution. Delivered as a *harmonized activity index*, never as a "number of fires". Native counts
stay in the CSV with a `sensor` column.

### 7.3 What it is for

With the series on the same scale, one can finally answer: *"did this August have more fire than normal in
Aragón?"* We compare this August against the median of every August since 2000. If it is 40 % above, that
is a real anomaly and not an effect of the satellite change. That is what firefighters, emergency services,
scientists and land managers need.

## 8. Requirements (testable)

- **S1** AOI by bbox (drawing on the map or typing west/south/east/north). Invalid input shows a specific message and does not query.
- **S2** Date range constrained to 2000-11-01 → present; the default is the full record.
- **S3** The burning calendar renders months (rows) × years (columns) from the harmonized series, using a colorblind-safe sequential ramp, with a legend stating the units ("harmonized activity index").
- **S4** For any selected month+year, the app shows the value, the multi-year median for that calendar month, and the anomaly as both absolute delta and percentage.
- **S5** The app renders the monthly time series over the selected range.
- **S6** The app renders month-of-year seasonality (mean or median per month across years) for the AOI.
- **S7** CSV download contains the harmonized fields plus raw native fields and `sensor`, for exactly the current AOI + range.
- **S8** A visible provenance panel states sources, harmonization method, overlap-calibration window, and known limitations.
- **S9** A typical AOI query returns from the precomputed store in under 2 s.
- **S10** Harmonization quality gate: during the overlap window, the calibrated index reproduces the MODIS-native series within a stated tolerance; a chart proving this exists in the repo and is linked from the app.

## 9. Data — verified plan (2026-11-15)

### 9.1 No key

We use neither a `MAP_KEY` nor the FIRMS Area API. The data is read from the Portolan mirror (§9.3), which is
public, with no rate limit and no 5-day window. The repository needs and stores no credential.

### 9.2 Real coverage per satellite (in the mirror)

| `sensor` | Platform | Coverage |
|---|---|---|
| `MODIS` (C6.1, 1 km) | Terra, Aqua | 2000-11-01 → present (Aqua from July 2002) |
| `VIIRS_SNPP` (375 m) | Suomi-NPP | 2012-01-20 → **2026-11-02 (ended)** |
| `VIIRS_NOAA20` (375 m) | NOAA-20 | 2018-04-01 → present |
| `VIIRS_NOAA21` (375 m) | NOAA-21 | 2024-01-17 → present |

Science-quality rows (`sp`) replace near-real-time rows (`nrt`) about three to four months later, so the
latest months are provisional. FIRMS publishes science-quality NOAA-21 from 2023-03-01, but the mirror
carries it from 2024-01-17.

**Critical finding:** S-NPP no longer delivers data. The index tail rests on NOAA-20, with its own measured
factor; NOAA-21 appears only in the raw counts and the CSV, and the latest months still mix NRT rows. The last
day of each satellite is measured from the data (`sensor_days`), never typed in.

### 9.3 Ingest: Portolan mirror (the only path, decision D7)

**Source:** the [Portolan mirror of FIRMS](https://source.coop/portolan-mirrors/firms-catalog), a public
(CC0) copy of every FIRMS detection, MODIS and VIIRS, as one GeoParquet file per year
(`year=YYYY/detections.parquet`). Rows are sorted along a Hilbert curve in groups of about 100,000, each with
its own bounding box, so DuckDB downloads only the groups that touch the region. For central Spain in 2016
that is 2 groups out of 248.

The key point: **the mirror harmonizes nothing**. It carries the FIRMS columns verbatim. Counts still jump
when a satellite joins, confidence is still 0-100 for MODIS and l/n/h for VIIRS, and `type` is empty for
every NRT row. All normalization is still our job, in `pipeline/`.

`pipeline/firms.py` keeps one file per region and year (`data/cache/<region>/<year>.parquet`) with every
confidence level, plus `data/sensor_days.parquet` with the days each satellite delivered data. It is
**idempotent and resumable**: finished years are never downloaded again and the current year is refreshed
every 6 h.

**Checked against NASA (2026-11-15).** We counted the detections in central Spain (-5.5, 38.5, -1.0, 42.3) in
the mirror and in the official NASA FIRMS country files. They are identical:

| Year | Aqua | Terra | Suomi-NPP | NOAA-20 |
|---|---|---|---|---|
| 2016 | 262 = 262 | 282 = 282 | 1,891 = 1,891 | |
| 2022 | 488 = 488 | 526 = 526 | 2,892 = 2,892 | 3,682 = 3,682 |

The design (read the remote GeoParquet with DuckDB, a per-year cache and measured observing days) is our own:
the pipeline depends on no prior project.

### 9.4 FIRMS historical archive (dropped)

It requires Earthdata Login or an emailed code, allows **one global year per request**, and delivery is
**asynchronous by email**. It is no longer needed: the mirror covers 2000 to today with no account.

### 9.5 Scope consequence

- **Primary:** two predefined regions (Spain and Aragón, §9.7) with the full 2000 → present calendar.
- **Secondary:** arbitrary AOI in "limited coverage" mode (short window, declared in the UI).
- **Rejected:** the full global 0.25° grid. A global monthly grid is ~1.04 M cells × 300 months: that is a
  backend, not something you send to a browser.

### 9.6 Fields that must be harmonized

Common: `latitude`, `longitude`, `acq_date`, `acq_time`, `satellite`, `instrument`, `frp`, `daynight`, `type`.
Divergent: `brightness`/`bright_ti4`, `bright_t31`/`bright_ti5`, `scan`, `track`, `confidence` (0–100 vs
l/n/h), `version`. Unified schema: `sensor`, `platform`, `pixel_km`, `confidence_score` (0–1 normalized),
`frp`, `datetime_utc`, `cell_id`.

### 9.7 Geographic scope

Decision D6 (2026-11-15): the demo uses **two regions**, each with its own role.

| Region | Role | Aqua MODIS scale |
|---|---|---|
| **Spain** (mainland and Balearic Islands) | lead: shows the method works. The VIIRS/Aqua ratio really changes by month (day 3.4 to 5.6) and the MODIS-denial test gives +6.1 % | about 1,000 to 4,000 vegetation detections a year |
| **Aragón** | local story for the Zaragoza event | only about 40 to 60 a year: too few for its own per-month factors, so its calibration will borrow strength from Spain |

`data/regions.json` stores a bounding box per region, which is what the ingest reads because it is what the
mirror can prune on, and the path to its official boundary in `data/aoi/` (Instituto Geografico Nacional via
geoBoundaries, CC BY 4.0, simplified to about 300 m). When the calendar is built, detections are clipped to that
boundary, so fires in Portugal, Andorra or France are not counted.

**Left out of the demo:** the Canary Islands (a different fire regime 1,000 km away, and in 2021 the La Palma
eruption adds about 31,000 detections that FIRMS types as vegetation), Ceuta and Melilla. The 9 candidate world
regions (Chaco, Amazon, Cerrado, California, Australia SE, Siberia, Sahel, Borneo and Iberia) are removed from
`regions.json`.

**Boundary check:** of the 442,559 detections NASA FIRMS assigns to Spain (without the Canary Islands) from 2000
to 2025, 99.4 % fall inside the IGN boundary; most of the rest sit on the Portuguese border. The Aragón boundary
gives the same detections as the OpenStreetMap one except 2 out of 18,026.

## 10. Scope

**Must have:** precomputed dataset (2000 → present, MODIS + VIIRS); AOI and range selection; month × year
calendar with an accessible ramp; seasonality and yearly totals; comparison against the historical median
and anomaly; CSV download; provenance panel.

**Should have:** map layer of hotspots; shareable URL; FRP toggle; third region; polygon drawing if time
allows.

**Won't have:** user accounts; streaming beyond the recent tail; per-pixel harmonization.

## 11. Demo script (5 minutes)

1. Open Spain with the full record, then Aragón.
2. The calendar fills in: dry-season band visible, 2024 vs 2005 **without** the artificial jump.
3. Hover a month: value, median, anomaly.
4. Switch to seasonality and yearly totals.
5. Download the CSV live.
6. Show the calibration chart and state the limitation out loud.

## 12. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | The mirror goes offline during the hackathon | no new data | the local per-region, per-year cache keeps working; artifacts are built before the demo |
| R2 | Harmonization is judged not credible | weak submission | index + validation chart + disclosed limits (S8, S10) |
| R3 | Scope creep into polygons / auth / live data | no demo | bbox only, presets, precomputed data |
| R4 | A single developer for data + web | bottleneck | pipeline first, UI second; validation and QA run in parallel |
| R5 | VIIRS confidence is categorical vs MODIS numeric | silent filtering bug | single `confidence_score`, with a unit test (implemented) |
| R6 | Date drift from `acq_date` + `acq_time` | off-by-one months in the calendar | `datetime_utc` in the unified schema (implemented) |
| R7 | The mirror is a third-party copy | data differs from NASA | checked against the official FIRMS files: exact match in 2016 and 2022 (§9.3) |
| R8 | The series says "index" but the UI hints "fires" | credibility | §1 and S3 fix the language; QA reviews the wording |

---

# Part III — Execution

## 13. Decisions

| ID | Decision | Reason |
|---|---|---|
| **D1** | Monorepo `apps/web` + `services/api` + `pipeline/` + `data/` | The pipeline is not the backend |
| **D2** | Predefined regions with the full record; arbitrary AOI in limited mode | A demo without waiting: demo regions are processed beforehand. The full Iberia ingest (27 region-years, 1.15 M detections) takes a measured **158 s**, so several regions fit in a single run; the real cost is calibrating a region, not downloading it |
| **D3** | `MODIS` + `VIIRS_SNPP` + `VIIRS_NOAA20` + `VIIRS_NOAA21`, `sp` and `nrt` rows | S-NPP ends on 2026-11-02 |
| **D4** | Commit the processed artifacts (`data/processed/`, ~12 MB), never the raw cache | A deploy serves the app without running a 158 s ingest. The raw cache (`data/cache/`, hundreds of MB) stays out of the repo and is rebuilt |
| **D5** | Next.js on Vercel; FastAPI on Railway/Render/Fly | Two simple, free deployments |
| **D6** | **Demo regions:** Spain (mainland and Balearic Islands) and Aragón. No Canary Islands. Clipped to the official IGN boundary | Spain gives enough signal and visible per-month factors; Aragón is the local story for the Zaragoza event (§9.7) |
| **D7** | Single ingest: the Portolan mirror in `pipeline/firms.py`. No `MAP_KEY`, no FIRMS API | No key and no 5-day cap, checked against the NASA files |

## 14. Stack

```
apps/web/          Next.js + TypeScript + Tailwind (calendar in CSS grid, series in hand-rolled SVG)
services/api/      FastAPI + DuckDB
pipeline/          Python: ingest → normalize → harmonize
data/              regions.json + aoi/ (boundaries) + committed processed artifacts (raw cache gitignored)
```

**No Plotly, no MapLibre.** The calendar is a CSS grid, the series are inline SVG, and the colour ramps are
implemented by hand (viridis and coolwarm, both colourblind-safe). Two fewer libraries to deploy, no bundle
risk in the demo, full control over accessibility. The hotspot map layer is a "should have" in the scope and
**is not shipped**; the CSV covers that need.

**FastAPI and not Django:** a read-only analytics service with 5 endpoints. No auth, no admin, no
migrations, no ORM. DuckDB over Parquet is a SQL query; FastAPI gives free `/docs`.

**Next.js yes, with one condition:** data logic does **not** live in `app/api/*` or in Server Components.
DuckDB in serverless is a trap. Next is presentation; FastAPI is data.

**API contract:** `/health`, `/regions`, `/calendar`, `/detections`, `/method`. Returns `503` with an
actionable message when an artifact is missing: an empty chart that looks like "no fires" is worse than an
honest error.

## 15. Glossary

| Term | What it means here |
|---|---|
| **Hotspot** | A pixel detected as thermally anomalous. Not a fire. |
| **FRP** | *Fire Radiative Power*: energy emitted by the pixel. More FRP ≈ more intense fire. |
| **Harmonization** | Converting counts from different sensors to a comparable scale. |
| **Harmonized index** | The result of harmonization. It compares; it does not count fires. |
| **Historical median** | The typical value of that same month across every year of the record. |
| **Anomaly** | How far a month deviates from its median, in percent. |
| **AOI** | *Area of Interest*: the area the user selects. |
| **SP / NRT** | *Standard Processing* (science quality, ~5 month lag) / *Near Real-Time*. |

## 16. Contribution log

- **`FIRST EXPLANATION`** (commit `e8d8253`, team): challenge summary, the observation that the difference
  between sensors **changes with the season** and that therefore a single factor is not enough (basis of
  §3 and §7), the FIRMS link, the 45 GB estimate and the proposal to bound the scope to one region. Its
  text is preserved in §2, §6 and §9.7.
- **`firetrack_problema_explicado`** (team): a jargon-free document and three diagrams. Contributes the
  framing that **a hotspot is a hot pixel, not a fire** (§1), the **7:1** ratio (§2), the satellite-by-year
  table (§5), the exchange-rate analogy (§7) and the glossary (§15). The diagrams live in `docs/img/`.
  Integrated here in full: it does not remain as a separate file.
- **Technical verification** (commit `67324a0`): `DAY_RANGE` 1–5, `MAP_KEY` and its limit, real coverage
  per sensor including the end of S-NPP, measured transaction budget, requirements, risks and
  stack.
- **Source change** (2026-11-15): the ingest now reads only from the Portolan mirror (`pipeline/firms.py`).
  The Area API, the `MAP_KEY` and their scripts are removed. The mirror was checked against
  the official NASA FIRMS files (§9.3).
- **Demo regions** (2026-11-15): D6 is closed. Spain (mainland and Balearic Islands) and Aragón, with official
  IGN boundaries in `data/aoi/`. The 9 candidate regions are removed from `regions.json` (§9.7).
