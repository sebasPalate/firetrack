"use client";

import { Glyph, type Point } from "@/components/mapShared";

/**
 * The five brightest pixels of the month. Hovering one highlights it on the map;
 * clicking zooms there, so a claim about a single detection can be checked.
 */
export function StrongestDetections({
  points,
  onFocus,
  onZoom,
}: {
  points: Point[];
  onFocus: (id: number | null) => void;
  onZoom: (point: Point) => void;
}) {
  if (points.length === 0) {
    return <p className="text-xs text-slate-500">None to list.</p>;
  }
  return (
    <ol className="space-y-1">
      {points.slice(0, 5).map((point) => (
        <li key={point.id}>
          <button
            type="button"
            onMouseEnter={() => onFocus(point.id)}
            onMouseLeave={() => onFocus(null)}
            onFocus={() => onFocus(point.id)}
            onBlur={() => onFocus(null)}
            onClick={() => onZoom(point)}
            title="Zoom the map to this detection"
            className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs text-slate-300 hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <span className="flex items-center gap-2">
              <Glyph family={point.family} />
              <span className="tabular-nums">{point.row.date.slice(5)}</span>
              <span className="text-slate-500">{point.row.satellite || point.row.sensor}</span>
            </span>
            <span className="tabular-nums text-slate-100">
              {point.row.frp === null ? "—" : `${point.row.frp.toFixed(1)} MW`}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
