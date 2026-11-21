# Firetrack web client

Next.js 16 + Tailwind 4, presentation only. Every number is precomputed by the pipeline, except a custom
area of interest, whose calendar is cut in the browser from the published Spain detections with the
pipeline's own rules (`src/lib/aoi.ts`). This app never reads FIRMS, DuckDB or Parquet.

```powershell
npm install
npm run dev     # http://localhost:3000
npm test        # node --test: custom-area calendar, month range, summary and calendar exports
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

The code is organised by what the product does. One rule holds it together, and `npm run lint` enforces
it: `shared/` knows nothing about the product, and `features/` never reach up into the page.

```
src/
  app/          Next.js entry: layout and page
  dashboard/    the page: composes the features, owns the link (urlState.ts)
  features/
    area/       custom area: form, box checks, calendar rules ported from the pipeline, data loader
    range/      the month range and its picker
    calendar/   calendar, at-a-glance, detail panel, yearly totals, seasonality, series, exports
    map/        hotspot map, per-day bars, zoom and pan, detections loader, projection
    method/     validation and provenance
    tour/       guided tour
    exports/    the detections CSV, cut by area and range
  shared/       artifact contract (types.ts), data access (api.ts), formatting, colours, file saving
```

| Path | Purpose |
|---|---|
| `src/shared/types.ts` | the artifact contract, mirrored from `pipeline/payloads.py` and `pipeline/harmonize.py` |
| `src/shared/api.ts` | static or API fetch, `ApiError`, data URLs |
| `src/features/area/aoi.ts` | custom area: box checks, CSV filter, the calendar rules ported from the pipeline |
| `src/features/range/range.ts` | the month range: membership, link format (`2022-06`, or a bare year), labels |
| `src/features/calendar/insights.ts` | the at-a-glance summary, the monthly table CSV and the calendar as a standalone SVG |
| `src/features/exports/downloadDetections.ts` | the detections CSV for a region or a custom box, in a month range |
| `src/shared/colors.ts` | viridis and coolwarm ramps, both colourblind-safe |
| `src/dashboard/Dashboard.tsx` | composes the panels; loading and error states, layout |
| `src/features/method/Validation.tsx` | overlap check, 2012 step and the blind test (Aqua hidden 2017 to 2020) |

`aoi.ts`, `range.ts` and `insights.ts` have no runtime imports, so `npm test` runs them as plain TypeScript.

No charting or map library on purpose: the calendar is a CSS grid, the series are inline SVG, and the
accessibility of every cell is under our control. The hotspot map layer is a documented "should have" that
this submission does not ship.
