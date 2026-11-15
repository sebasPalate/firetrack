# Firetrack web client

Next.js 16 + Tailwind 4, presentation only. Every number is precomputed by the pipeline; this app never
reads FIRMS, DuckDB or Parquet.

```powershell
npm install
npm run dev     # http://localhost:3000
npm run build
```

## Where the data comes from

**Static (default).** The page reads plain files from `public/data/`, written by the pipeline:

```powershell
# from the repository root
python -m pipeline.harmonize spain
python -m pipeline.harmonize aragon --prior-region spain
python -m pipeline.export_web
```

| File | Same payload as |
|---|---|
| `public/data/regions.json` | `GET /regions` (only regions that were exported) |
| `public/data/calendar/<region>.json` | `GET /calendar?region=` |
| `public/data/method/<region>.json` | `GET /method?region=` |
| `public/data/detections/<region>/<year>.csv` | `GET /detections`, one file per year; the Download button stitches the selected range in the browser |

Commit `public/data/` with the code: that is what the deployed site shows.

**API.** To read FastAPI instead, set its base URL:

```powershell
$env:NEXT_PUBLIC_API_BASE = "http://localhost:8000"; npm run dev
```

Both modes are built by `pipeline/payloads.py`, so they show the same numbers.

## Deploy

- **GitHub Pages:** merge to `main`. The `Deploy web to GitHub Pages` workflow builds the static export
  with `NEXT_PUBLIC_BASE_PATH=/firetrack` and publishes it automatically. Enable Pages with **GitHub Actions**
  as the source in the repository settings.
- **Vercel:** create a project with **Root Directory** `apps/web`, framework preset Next.js, and no environment
  variables. Leave `NEXT_PUBLIC_API_BASE` unset so the site reads `public/data/`.

## What is here

| Path | Purpose |
|---|---|
| `src/lib/types.ts` | the artifact contract, mirrored from `pipeline/payloads.py` and `pipeline/harmonize.py` |
| `src/lib/api.ts` | static or API fetch, `ApiError`, CSV download in both modes |
| `src/lib/colors.ts` | viridis and coolwarm ramps, both colourblind-safe |
| `src/components/Dashboard.tsx` | region/range controls, loading and error states, layout |
| `src/components/CalendarHeatmap.tsx` | the calendar: a CSS grid, one cell per month |
| `src/components/Validation.tsx` | overlap check, 2012 step and the blind test (Aqua hidden 2017 to 2020) |
| `src/components/*.tsx` | detail panel, yearly totals, seasonality, monthly series, provenance |

No charting or map library on purpose: the calendar is a CSS grid, the series are inline SVG, and the
accessibility of every cell is under our control. The hotspot map layer is a documented "should have" that
this submission does not ship.
