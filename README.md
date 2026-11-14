# Firetrack

**One comparable fire record from NASA MODIS and VIIRS.** A burning activity calendar for any area of
interest, so a fire manager can answer one question honestly: *is this month unusual, or is the record
just telling me that a new satellite turned on?*

NASA Space Apps Challenge 2026 — [*Harmonization of MODIS and VIIRS Hot Spots*](https://www.spaceappschallenge.org/).

**Status:** pre-release. Ingest, normalization and API plumbing are implemented and tested; harmonized
artifacts and the web client are in progress.

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

Plot the raw counts and the series jumps in 2012, again in 2018 and again in 2023, each time a VIIRS
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
Resource Management System).

| Source | Coverage |
|---|---|
| `MODIS_SP` (C6.1) | 2000-11-01 → present (~5 month lag) |
| `VIIRS_SNPP_SP` (375 m) | 2012-01-20 → **2026-11-02 (mission ended)** |
| `VIIRS_NOAA20_SP` (375 m) | 2018-04-01 → present |
| `VIIRS_NOAA21_SP` (375 m) | 2023-03-01 → present |

S-NPP stopped delivering data on 2026-11-02, so the recent tail depends on NOAA-20 (and NOAA-21). Near
real-time sources (`_NRT`) cover the lag window; standard processing (`_SP`) is preferred wherever both
exist.

**Access:** the FIRMS Area API returns at most **5 days per request** and allows **5000 transactions per
10 minutes**. A 25-year record therefore cannot be queried live — it is ingested once, cached, and served
from precomputed artifacts. `scripts/budget.py` prints the real cost:

| Regions covered | Transactions | Wall clock waiting on the rate limit |
|---|---|---|
| 1 | 19,416 | ~0.6 h |
| 3 | 58,248 | ~1.9 h |
| 9 | 174,744 | ~5.8 h |

That budget is why the product ships a set of curated regions with a full record, plus a
limited-coverage mode for arbitrary areas, instead of pretending to cover the planet interactively.

## 4. Architecture

```
NASA FIRMS Area API
        │  (pipeline only, never at request time)
        ▼
   pipeline/          ingest → normalize → grid → harmonize
        │
        ▼
   data/processed/    Parquet artifacts (gitignored, rebuilt by scripts)
        │
        ▼
   services/api/      FastAPI + DuckDB, read-only
        │
        ▼
   apps/web/          Next.js + Tailwind + Plotly + MapLibre
```

Three deliberate boundaries:

- **The API never calls FIRMS.** A 5-day request cap cannot serve an interactive calendar.
- **The pipeline is not the backend.** Merging them puts pandas and the whole ETL inside the API image.
- **Next.js is presentation only.** No DuckDB in serverless functions; the data layer stays in FastAPI.

## 5. Repository layout

```
apps/web/              Next.js client (created with create-next-app)
services/api/          FastAPI service and the artifact contract
pipeline/              ingest client, normalizer, tests
  firms.py             Area API client: 5-day chunking, transaction budget, resumable cache
  normalize.py         sensor-agnostic schema, confidence and acquisition time
data/regions.json      area of interest list, shared by pipeline and API
data/raw/              cached API responses (gitignored)
data/processed/        Parquet artifacts (gitignored)
docs/                  problem definition in Spanish and English, diagrams
scripts/               timed probe and rate-limit budget calculator
```

## 6. Quickstart

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r pipeline\requirements.txt -r services\api\requirements.txt
Copy-Item env.example .env
```

Get a free FIRMS `MAP_KEY` at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> — it arrives by email
within seconds — and paste it into `.env`. The key is a credential; `.env` is gitignored.

Then measure the API before planning around it:

```powershell
python -m pipeline.ingest --dry-run --region chaco --source MODIS_SP
python scripts\check_firms.py --region chaco --source MODIS_SP --year 2020
```

| Command | Purpose |
|---|---|
| `python -m pipeline.tests.test_chunking` | request-window splitting (pure) |
| `python -m pipeline.tests.test_normalize` | confidence and time normalization (pure) |
| `python -m pipeline.ingest --region chaco --source MODIS_SP --from 2000-11-01` | fetch and cache |
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

- **Unit tests** pin the two silent failure modes: window chunking (a gap means missing days) and
  confidence normalization (MODIS `0–100` versus VIIRS `l/n/h`).
- **Step test:** raw counts must jump across 2012/2018/2023 while the harmonized index stays flat. If it
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
Fire imagery credit for the challenge: CONAE (National Commission of Space Activities of Argentina).
