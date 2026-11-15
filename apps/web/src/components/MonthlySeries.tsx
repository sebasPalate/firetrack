"use client";

import { sequential } from "@/lib/colors";
import { formatIndex } from "@/lib/format";
import type { CalendarPayload } from "@/lib/types";

/** S5: the monthly series over the selected range, one point per month. */
export function MonthlySeries({ payload, years }: { payload: CalendarPayload; years: number[] }) {
  const points: { x: number; value: number; year: number; month: number }[] = [];
  years.forEach((year) => {
    const column = payload.years.indexOf(year);
    if (column < 0) return;
    for (let month = 0; month < 12; month += 1) {
      const value = payload.harmonized[month][column];
      if (value === null) continue;
      points.push({ x: year * 12 + month, value, year, month });
    }
  });

  if (points.length < 2) {
    return null;
  }

  const minX = points[0].x;
  const maxX = points[points.length - 1].x;
  const maxY = Math.max(...points.map((point) => point.value), 1);
  const width = 1000;
  const height = 180;
  const toX = (x: number) => ((x - minX) / Math.max(maxX - minX, 1)) * width;
  const toY = (value: number) => height - (value / maxY) * (height - 16) - 4;

  const line = points.map((point) => `${toX(point.x).toFixed(2)},${toY(point.value).toFixed(2)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0]);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Monthly series</h2>
        <span className="text-xs text-slate-400">
          peak {formatIndex(peak.value)} in {peak.year}
        </span>
      </header>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label="Monthly harmonized activity index over the selected range"
      >
        <defs>
          <linearGradient id="series-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sequential(0.75)} stopOpacity="0.55" />
            <stop offset="100%" stopColor={sequential(0.75)} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#series-fill)" />
        <polyline
          points={line}
          fill="none"
          stroke={sequential(0.55)}
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
        <span>{years[0]}</span>
        <span>{years[Math.floor(years.length / 2)]}</span>
        <span>{years[years.length - 1]}</span>
      </div>
    </section>
  );
}
