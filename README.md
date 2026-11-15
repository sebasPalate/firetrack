# Firetrack

**One comparable fire record from NASA MODIS and VIIRS.** A burning activity calendar for any area of
interest, so a fire manager can answer one question honestly: *is this month unusual, or is the record
just telling me that a new satellite turned on?*

NASA Space Apps Challenge 2026 — [*Harmonization of MODIS and VIIRS Hot Spots*](https://www.spaceappschallenge.org/).

**Status:** pre-release. Ingest (Portolan GeoParquet mirror of NASA FIRMS, no key) and API plumbing are
implemented and tested; harmonized artifacts and the web client are in progress.

![Raw hotspot counts jump when new satellites arrive; the harmonized record stays level](docs/img/salto_2012.svg)

---

## 1. Why this is not a plotting exercise

A satellite does not see fires. It sees **pixels that are hotter than their surroundings**, and each one
counts as a hotspot. One large fire can light up dozens of pixels; a small stubble burn may light up one,
or none.

Two sensors share the record:

| | MODIS (Terra, Aqua) | VIIRS (S-NPP, NOAA-20, NOAA-21) |
|---|---|---|
| Nominal pixel | ~1 km | ~375 m |
| Record starts | 2000 | 2012 |
| Detects small fires | poorly | much better |
| Overpass (local) | ~10:30 and ~13:30 | ~13:30 and ~01:30 |

About **seven VIIRS pixels fit inside one MODIS pixel** (1000/375 ≈ 2.67, squared ≈ 7.1). So the same
1 km² fire yields one MODIS hotspot and roughly seven VIIRS hotspots — before counting the small fires
VIIRS sees and MODIS misses entirely.

![The same fire, split differently by pixel size](docs/img/pixeles_modis_viirs.svg)

Plot the raw counts and the series jumps in 2012, again in 2018 and again in 2024, each time a VIIRS
satellite joins. Nothing changed on the ground. Only the camera did.

A single correction factor does not fix this, because the ratio is **seasonal**: during the dry season
both sensors see the large fires and VIIRS merely splits them into more pixels, but during agricultural
burning season VIIRS sees thousands of small fires that MODIS never detects.

![Per-month correction factors: one factor for the whole year is wrong almost every month](docs/img/factor_por_mes.svg)

## 2. The method

Think of it as an exchange rate between two currencies:

1. Take the period when both sensors operate (**2012 onward**).
2. For each calendar month, estimate *"when VIIRS sees X, Aqua MODIS sees Y"*. That is the month's rate.
3. Convert the whole series into **Aqua MODIS units**, so 2005 and 2024 become comparable.

**Why Aqua?** Its afternoon orbit (~13:30 local) is the only one that runs continuously from 2002 through
every VIIRS satellite. Calibrating against Aqua holds the diurnal cycle constant. Calibrating against
Terra (~10:30) would mix a change of sensor with a change of observation time.

Day and night are calibrated **separately**, and sparse cells are shrunk with an empirical-Bayes prior
instead of producing a rate from three observations.

**What the output is:** a **harmonized activity index**, not a count of fires. The UI always says so.
The native per-sensor counts stay available in the CSV export.

## 3. Data

All hotspot data comes from **[NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/)** (Fire Information for
Resource Management System), read through the
**[Portolan mirror](https://source.coop/portolan-mirrors/firms-catalog)**: every FIRMS detection as one
GeoParquet file per year, CC0, no key and no rate limit. This is the only ingest path.

| Sensor in the mirror | Platform | Coverage |
|---|---|---|
| `MODIS` (C6.1, 1 km) | Terra, Aqua | 2000-11-01 → present (Aqua from 2002-07) |
| `VIIRS_SNPP` (375 m) | Suomi-NPP | 2012-01-20 → **2026-11-02 (mission ended)** |
| `VIIRS_NOAA20` (375 m) | NOAA-20 | 2018-04-01 → present |
| `VIIRS_NOAA21` (375 m) | NOAA-21 | 2024-01-17 → present |

Science-quality rows (`quality = 'sp'`) replace near-real-time rows (`'nrt'`) about three to four months
later, so the recent months are provisional. S-NPP stopped on 2026-11-02, so the recent tail depends on
NOAA-20 and NOAA-21. Last days are measured from the data (`sensor_days`), never hard-coded.

**What the mirror does and does not do.** It carries the FIRMS columns verbatim (only `geometry` instead of
latitude/longitude, expanded satellite names and an integer `confidence_pct` for MODIS). **Nothing is
harmonized upstream**: counts still jump when a satellite joins, `confidence` is still 0-100 for MODIS and
l/n/h for VIIRS, and `type` is empty for every near-real-time row. That work stays in `pipeline/`.

**How it is read.** Rows are sorted along a Hilbert curve in ~100k-row groups, each with its own bounding
box, so DuckDB downloads only the row groups that touch the region. For central Spain in 2016 that is 2 of
248 row groups. We read `year=YYYY/detections.parquet` only; the same folders also hold aggregates and a
`live.parquet` that repeats the last week.

**Verified against NASA (2026-11-15).** Detections in central Spain (-5.5, 38.5, -1.0, 42.3) counted in the
mirror and in the official NASA FIRMS country files are identical:

| Year | Aqua | Terra | Suomi-NPP | NOAA-20 |
|---|---|---|---|---|
| 2016 | 262 = 262 | 282 = 282 | 1,891 = 1,891 | |
| 2022 | 488 = 488 | 526 = 526 | 2,892 = 2,892 | 3,682 = 3,682 |

**What we cache** (`data/cache/<region>/<year>.parquet`): every detection with `acq_datetime`, `acq_date`,
`sensor`, `satellite`, `daynight`, `quality`, `version`, `type`, `confidence`, `confidence_pct`, `lat`, `lon`,
`frp`, `scan`, `track`. All confidence levels are kept; the filter (`CONF_SQL`: MODIS ≥ 30, VIIRS not `l`) is
applied in the harmonization step so its effect can be reported. `data/sensor_days.parquet` holds the days on
which each satellite delivered any detection anywhere on Earth: the denominator for partial months.

## 4. Architecture

```
NASA FIRMS ──► Portolan GeoParquet mirror (CC0, one file per year)
        │       read in place with DuckDB, only the region's row groups
        │  (pipeline only, never at request time)
        ▼
   pipeline/          firms (ingest) → harmonize
        │
        ▼
   data/processed/    Parquet artifacts (gitignored, rebuilt by the pipeline)
        │
        ▼
   services/api/      FastAPI + DuckDB, read-only
        │
        ▼
   apps/web/          Next.js + Tailwind + Plotly + MapLibre
```

Three deliberate boundaries:

- **The API never reads FIRMS or the mirror.** It serves precomputed artifacts only.
- **The pipeline is not the backend.** Merging them puts pandas and the whole ETL inside the API image.
- **Next.js is presentation only.** No DuckDB in serverless functions; the data layer stays in FastAPI.

## 5. Repository layout

```
apps/web/              Next.js client (created with create-next-app)
services/api/          FastAPI service and the artifact contract
pipeline/              ingest, normalizer, tests
  firms.py             ingest: Portolan mirror, per region and year cache, sensor days
  regions.py           loads and validates data/regions.json, antimeridian split
  normalize.py         sensor-agnostic schema, confidence and acquisition time
data/regions.json      area of interest list, shared by pipeline and API
data/cache/            mirror reads, one Parquet per region and year (gitignored)
data/sensor_days.parquet  observing days per satellite (gitignored)
data/processed/        Parquet artifacts (gitignored)
docs/                  problem definition in Spanish and English, diagrams
```

## 6. Quickstart

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r pipeline\requirements.txt -r services\api\requirements.txt
```

No key and no `.env` are needed. The first run downloads the DuckDB `spatial` and `httpfs` extensions and
the global sensor-days table (three columns per year, once):

```powershell
python -m pipeline.firms iberia --dry-run
python -m pipeline.firms iberia --from-year 2016 --to-year 2016
python -m pipeline.firms iberia
```

The summary printed at the end already shows the problem: the detection count per year jumps in 2012, when
Suomi-NPP joins.

| Command | Purpose |
|---|---|
| `python -m pipeline.tests.test_firms` | bounding box, query and cache freshness (pure) |
| `python -m pipeline.tests.test_normalize` | confidence and time normalization (pure) |
| `python -m pipeline.firms` | ingest every region in `data/regions.json`, resumable |
| `cd services\api; uvicorn main:app --reload` | API on <http://localhost:8000/docs> |
| `cd apps; npx create-next-app@latest web --ts --tailwind --eslint --app --src-dir --import-alias "@/*"` | create the client once |

## 7. API

| Endpoint | Returns |
|---|---|
| `GET /health` | artifact availability per region |
| `GET /regions` | configured areas of interest |
| `GET /calendar?region=&start=&end=` | month × year matrix, raw counts, per-month median, anomaly % |
| `GET /detections?region=&start=&end=&limit=` | CSV of the detections behind the view |
| `GET /method` | calibration table, validation statistics, limitations |

Missing artifacts return `503` with an actionable message. An empty chart that looks like "no fires" is
worse than an honest error.

## 8. Quality gates

- **Unit tests** pin the silent failure modes: the area filter and the cache rule (a wrong box or a stale
  year means missing detections) and confidence handling (MODIS `0–100` versus VIIRS `l/n/h`).
- **Source check:** the mirror must match the official NASA FIRMS files on a test area (done for 2016 and
  2022, see §3).
- **Step test:** raw counts must jump across 2012/2018/2024 while the harmonized index stays flat. If it
  jumps, the calibration is wrong.
- **Denial test:** rebuild the record from VIIRS alone and check it against what Aqua actually observed.
- **Published limitations:** regions where the method under- or over-corrects are listed, not hidden.

## 9. Documentation

| Document | Language | Purpose |
|---|---|---|
| [`docs/problema.md`](docs/problema.md) | Spanish | canonical document: the problem in plain words, method, data, requirements, risks, schedule |
| [`docs/problem.md`](docs/problem.md) | English | full mirror of the canonical document, for the judges and the submission |

## 10. Attribution

Hotspot data: NASA FIRMS / LANCE, MODIS Collection 6.1 and VIIRS 375 m active fire products.
Read through the Portolan mirror of FIRMS on Source Cooperative (CC0):
<https://source.coop/portolan-mirrors/firms-catalog>.

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System
(FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Observing System Data and Information
System (EOSDIS).

The ingest approach (remote GeoParquet read in place with DuckDB, a per-year cache and a measured
sensor-days table) follows the one published by Kiln Watch (Team Off The Binary, NASA Space Apps 2026,
<https://github.com/Aalvee-Aarham/kiln-watch>). Our implementation is our own.
Fire imagery credit for the challenge: CONAE (National Commission of Space Activities of Argentina).
