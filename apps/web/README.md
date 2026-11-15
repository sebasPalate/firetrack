# Firetrack web client

Next.js 16 + Tailwind 4, presentation only. Every number comes from the FastAPI service, which serves
precomputed Parquet artifacts; this app never reads FIRMS, DuckDB or Parquet.

```powershell
npm install
npm run dev     # http://localhost:3000
npm run build
```

The API base defaults to `http://localhost:8000`. Point it elsewhere with:

```powershell
$env:NEXT_PUBLIC_API_BASE = "https://your-api.example.com"; npm run dev
```

## What is here

| Path | Purpose |
|---|---|
| `src/lib/types.ts` | the artifact contract, mirrored from `services/api/main.py` |
| `src/lib/api.ts` | fetch wrappers, `ApiError`, CSV URL builder |
| `src/lib/colors.ts` | viridis and coolwarm ramps, both colourblind-safe |
| `src/components/Dashboard.tsx` | region/range controls, loading and error states, layout |
| `src/components/CalendarHeatmap.tsx` | the calendar: a CSS grid, one cell per month |
| `src/components/*.tsx` | detail panel, yearly totals, seasonality, monthly series, validation, provenance |

No charting or map library on purpose: the calendar is a CSS grid, the series are inline SVG, and the
accessibility of every cell is under our control. The hotspot map layer is a documented "should have" that
this submission does not ship.
