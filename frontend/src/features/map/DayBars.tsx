"use client";

import { MONTHS } from "@/shared/format";

import { MODIS_COLOR, VIIRS_COLOR, type DayCounts } from "@/features/map/mapShared";

/**
 * One bar per day of the month, split by sensor. The point of the panel: a day
 * with only MODIS bars and a day with both are the same fire season seen by
 * different cameras, which is why a raw count cannot be read as "fires".
 */
export function DayBars({
  month,
  daysInMonth,
  counts,
  maxDay,
  showModis,
  showViirs,
  selected,
  onPick,
}: {
  /** Zero-based. */
  month: number;
  daysInMonth: number;
  counts: DayCounts;
  maxDay: number;
  showModis: boolean;
  showViirs: boolean;
  selected: number | null;
  onPick: (day: number | null) => void;
}) {
  return (
    <div className="flex h-16 items-end gap-px" role="group" aria-label="Detections per day">
      {Array.from({ length: daysInMonth }, (_, index) => {
        const dayNumber = index + 1;
        const modis = showModis ? counts.modis[index] : 0;
        const viirs = showViirs ? counts.viirs[index] : 0;
        const total = modis + viirs;
        const active = selected === dayNumber;
        return (
          <button
            key={dayNumber}
            type="button"
            aria-pressed={active}
            aria-label={`${MONTHS[month]} ${dayNumber}: ${counts.modis[index]} MODIS, ${counts.viirs[index]} VIIRS`}
            title={`${MONTHS[month]} ${dayNumber}: ${counts.modis[index]} MODIS · ${counts.viirs[index]} VIIRS`}
            onClick={() => onPick(active ? null : dayNumber)}
            className={`flex h-full flex-1 items-end rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
              active ? "bg-sky-400/25" : "hover:bg-slate-700/40"
            }`}
          >
            <span
              className="flex w-full flex-col justify-end overflow-hidden rounded-t-[2px]"
              style={{ height: total > 0 ? `${Math.max((total / maxDay) * 100, 6)}%` : "0%" }}
            >
              <span style={{ flex: `${viirs} 1 0%`, backgroundColor: VIIRS_COLOR }} />
              <span style={{ flex: `${modis} 1 0%`, backgroundColor: MODIS_COLOR }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
