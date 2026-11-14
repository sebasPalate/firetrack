# Firetrack

One comparable fire record from NASA MODIS and VIIRS: a burning activity calendar for a selected area.

NASA Space Apps Challenge 2026 — *Harmonization of MODIS and VIIRS Hot Spots*.
Working definition of the problem and the work split: [`docs/problema.md`](docs/problema.md) (Spanish, canonical).

**Status:** skeleton. Contracts and plumbing are in place; no data artifacts yet.

## Layout

```
apps/web/          Next.js + Tailwind (presentation only, never touches FIRMS)
services/api/      FastAPI + DuckDB (reads precomputed Parquet)
pipeline/          Python ETL: ingest -> normalize -> grid -> harmonize
data/regions.json  AOI list, shared by pipeline and API
data/raw/          cached API responses (gitignored)
data/processed/    Parquet artifacts (gitignored, rebuilt from scripts)
docs/              problem definition, stack, method, QA
scripts/           probes and one-off tools
```

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r pipeline\requirements.txt -r services\api\requirements.txt
Copy-Item env.example .env
```

Then paste your FIRMS key into `.env`.

## Get a FIRMS `MAP_KEY` (takes about two minutes)

1. Open <https://firms.modaps.eosdis.nasa.gov/api/map_key/>
2. Enter an email you can read **right now** and submit the form.
3. The key arrives by email within seconds.
4. Paste it into `.env` as `FIRMS_MAP_KEY=...`

Things worth knowing:

- It is a free **API key**, not an account. It authenticates the Area API and the map services.
- Limit: **5000 transactions per 10 minutes**. A request covering N days costs roughly N transactions.
- If the email is already registered, the form will not resend it; manage the key through the download portal.
- **Never commit it.** `.env` is gitignored on purpose.

## First command: measure the API before planning around it

```powershell
python -m pipeline.ingest --dry-run --region chaco --source MODIS_SP
python scripts\check_firms.py --region chaco --source MODIS_SP --year 2020
```

`check_firms.py` prints elapsed time, rows, bytes and a projection to the full record. That projection is what decides how many regions fit in the schedule.

## Commands

| Command | What it does |
|---|---|
| `python -m pipeline.tests.test_chunking` | Pure tests: request-window splitting |
| `python -m pipeline.tests.test_normalize` | Pure tests: confidence and time normalization |
| `python -m pipeline.ingest --dry-run --region chaco --source MODIS_SP` | Show the fetch plan, no network |
| `python -m pipeline.ingest --region chaco --source MODIS_SP --from 2000-11-01` | Fetch and cache |
| `cd services\api; uvicorn main:app --reload` | API on <http://localhost:8000/docs> |
| `cd apps; npx create-next-app@latest web --ts --tailwind --eslint --app --src-dir --import-alias "@/*"` | Create the frontend once |

## API contract

| Endpoint | Returns |
|---|---|
| `GET /health` | artifact availability per region |
| `GET /regions` | configured AOIs |
| `GET /calendar?region=&start=&end=` | month x year matrix, raw counts, median per month, anomaly % |
| `GET /detections?region=&start=&end=&limit=` | CSV of the detections behind the view |
| `GET /method` | calibration table, validation stats, limitations |

Endpoints return `503` with an actionable message while the artifact is missing. That is intentional: an empty chart that looks like "no fires" is worse than an honest error.

## Sensor coverage (verified 2026-11-14)

| Source | From | To |
|---|---|---|
| `MODIS_SP` | 2000-11-01 | present (~5 month lag) |
| `VIIRS_SNPP_SP` | 2012-01-20 | **2026-11-02 (ended)** |
| `VIIRS_NOAA20_SP` | 2018-04-01 | present |
| `VIIRS_NOAA21_SP` | 2023-03-01 | present |

S-NPP no longer delivers data, so the recent tail needs NOAA-20 (and optionally NOAA-21). Use `_NRT` sources for the last months and prefer `_SP` where both exist.

## Ground rules

- The backend never calls FIRMS at request time. FIRMS is touched by the pipeline only.
- Numbers shown in the UI are a **harmonized activity index**, not an absolute count of fires. Label them that way, always.
- `pipeline/` is not `services/api/`. Merging them puts pandas and the whole ETL inside the API image.
- Empty results and missing artifacts must be distinguishable in the UI.

## First 90 minutes, by track

| Track | Owner | First task |
|---|---|---|
| A — data and software | developer | get the key, run `check_firms.py`, report the projection, then build the grid artifact for one region |
| B — physical validation | mechanical engineer | write `docs/method.md`: overpass geometry, pixel footprint vs scan angle, why Aqua is the reference, the validation events table |
| C — product and delivery | industrial engineer | freeze requirements S1–S10, define what "anomaly" means operationally, start `docs/qa-checklist.md` |
