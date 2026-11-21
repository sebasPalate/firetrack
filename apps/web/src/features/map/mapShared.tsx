"use client";

import type { ReactNode } from "react";

import type { Detection, Family } from "@/features/map/detections";
import { formatCount } from "@/shared/format";

export const MODIS_COLOR = "#fbbf24";
export const VIIRS_COLOR = "#38bdf8";

const CONFIDENCE: Record<string, string> = { l: "low", n: "nominal", h: "high" };

/** One detection placed on the map, with its index in the month's list as its identity. */
export type Point = { id: number; x: number; y: number; family: Family; day: number; row: Detection };

/** Per-day tallies: two arrays aligned to the day of the month, plus the month's totals. */
export type DayCounts = { modis: number[]; viirs: number[]; totalModis: number; totalViirs: number };

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Mark size on screen, in pixels: grows with fire radiative power, never vanishes, never swamps. */
export function radiusPx(frp: number | null): number {
  return clamp(2.2 + Math.sqrt(Math.max(frp ?? 1, 0)) * 0.85, 2.5, 9);
}

export function confidenceLabel(row: Detection): string {
  if (row.confidence === "") return "—";
  const named = CONFIDENCE[row.confidence.toLowerCase()];
  return named ?? `${row.confidence} %`;
}

export function MapButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 text-base leading-none text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function FamilyToggle({
  family,
  detail,
  count,
  on,
  onToggle,
}: {
  family: Family;
  detail: string;
  count: number;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
        on ? "border-slate-600 bg-slate-800/60 text-slate-100" : "border-slate-800 text-slate-500"
      }`}
    >
      <span className="flex items-center gap-2">
        <Glyph family={family} dim={!on} />
        <span>
          <strong className="font-semibold">{family}</strong> <span className="text-slate-400">{detail}</span>
        </span>
      </span>
      <span className="tabular-nums">{formatCount(count)}</span>
    </button>
  );
}

/** Shape carries the sensor as well as colour, so the legend survives colour-vision differences. */
export function Glyph({ family, dim = false }: { family: Family; dim?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={dim ? "opacity-40" : ""}>
      {family === "VIIRS" ? (
        <circle cx="6" cy="6" r="4.5" fill={VIIRS_COLOR} fillOpacity="0.5" stroke="#bae6fd" />
      ) : (
        <rect x="1.5" y="1.5" width="9" height="9" fill={MODIS_COLOR} fillOpacity="0.12" stroke={MODIS_COLOR} strokeWidth="1.5" />
      )}
    </svg>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium tabular-nums text-slate-100">{value}</span>
    </div>
  );
}
