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
python -m firetrack.pipeline.harmonize spain
python -m firetrack.pipeline.harmonize aragon --prior-region spain
python -m firetrack.pipeline.export_web
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

Both modes are built by `backend/src/firetrack/contract/payloads.py`, so they show the same numbers.

## Deploy

- **GitHub Pages:** merge to `main`. The `Deploy web to GitHub Pages` workflow builds the static export
  with `NEXT_PUBLIC_BASE_PATH=/firetrack` and publishes it automatically. Enable Pages with **GitHub Actions**
  as the source in the repository settings.
- **Vercel:** create a project with **Root Directory** `frontend`, framework preset Next.js, and no environment
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
| `src/shared/types.ts` | the artifact contract, mirrored from `backend/src/firetrack/contract/payloads.py` and `backend/src/firetrack/pipeline/harmonize.py` |
| `src/shared/api.ts` | static or API fetch, `ApiError`, data URLs |
| `src/features/area/aoi.ts` | custom area: box checks, CSV filter, the calendar rules ported from the pipeline |
| `src/features/range/range.ts` | the month range: membership, link format (`2022-06`, or a bare year), labels |
| `src/features/calendar/insights.ts` | the at-a-glance summary, the monthly table CSV and the calendar as a standalone SVG |
| `src/features/exports/downloadDetections.ts` | the detections CSV for a region or a custom box, in a month range |
| `src/shared/ui/` | shadcn/ui components (Base UI primitives), added with `npx shadcn@latest add <name>`; `components.json` points the CLI here |
| `src/shared/colors.ts` | viridis and coolwarm ramps, both colourblind-safe |
| `src/dashboard/Dashboard.tsx` | the container: composes the panels; loading and error states, layout |
| `src/dashboard/hooks.ts` | region list, region or custom-area data, link sync, playback, detections download, status line |
| `src/dashboard/useCalendarExports.ts`, `useTour.tsx` | calendar table and image downloads; the guided tour's steps |
| `src/dashboard/ControlsBar.tsx`, `CalendarToolbar.tsx` | the controls box and the bar above the calendar, presentation only |
| `src/dashboard/calendarView.ts` | which month opens, the colour scale, the busiest month of a year |
| `src/features/method/Validation.tsx` | overlap check, 2012 step and the blind test (Aqua hidden 2017 to 2020) |

`aoi.ts`, `range.ts` and `insights.ts` have no runtime imports, so `npm test` runs them as plain TypeScript.

**UI components.** Accessible controls come from [shadcn/ui](https://ui.shadcn.com), copied into
`src/shared/ui/` so they are ours to change. Their colour tokens (`--background`, `--primary`, …) in
`src/app/globals.css` are the same slate and sky palette the hand-written panels use, so both look alike;
no base layer is added, so existing elements keep their own styles. The charts stay hand-written SVG and CSS
grid: shadcn's Recharts-based charts are not used. The `shadcn` package is a dev dependency (the CLI and its
Tailwind variants); nothing from it ships to the browser except the components we add.

No charting or map library on purpose: the calendar is a CSS grid, the series are inline SVG, and the
accessibility of every cell is under our control. The hotspot map layer is a documented "should have" that
this submission does not ship.
