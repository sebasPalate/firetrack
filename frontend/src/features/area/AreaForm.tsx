"use client";

import { useState } from "react";

import type { Bbox } from "@/features/area/aoi";

type Props = {
  initial: Bbox;
  /** The source data's box, shown as the allowed range; null while the region list loads. */
  limits: Bbox | null;
  /** Returns why the box was refused, or null when it was applied. */
  onApply: (box: Bbox) => string | null;
  onCancel: () => void;
};

const FIELDS = [
  { label: "West", hint: "longitude" },
  { label: "South", hint: "latitude" },
  { label: "East", hint: "longitude" },
  { label: "North", hint: "latitude" },
] as const;

/** A custom area typed as a longitude/latitude box; the map's "Draw area" is the other way in. */
export function AreaForm({ initial, limits, onApply, onCancel }: Props) {
  const [values, setValues] = useState<string[]>(() => initial.map((value) => String(Number(value.toFixed(4)))));
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <form
      aria-label="Custom area"
      className="mt-4 rounded-2xl border border-sky-500/30 bg-slate-900/70 p-3 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        const box = values.map((value) => (value.trim() === "" ? Number.NaN : Number(value))) as Bbox;
        setProblem(onApply(box));
      }}
    >
      <p className="mb-2 text-slate-300">
        Custom area of interest: type a longitude/latitude box in decimal degrees, or use{" "}
        <strong className="text-slate-100">Draw area</strong> on the map.
        {limits ? (
          <span className="text-slate-500">
            {" "}
            Inside the Spain data: longitude {limits[0]} to {limits[2]}, latitude {limits[1]} to {limits[3]}.
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {FIELDS.map((field, index) => (
          <label key={field.label} className="flex flex-col gap-1">
            <span className="text-slate-500">
              {field.label} <span className="text-slate-600">({field.hint})</span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              required
              value={values[index]}
              onChange={(event) =>
                setValues((current) => current.map((value, at) => (at === index ? event.target.value : value)))
              }
              className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
            />
          </label>
        ))}
        <button
          type="submit"
          className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 font-medium text-sky-300 hover:bg-sky-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          Apply area
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-600 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          Cancel
        </button>
      </div>
      {problem ? (
        <p role="alert" className="mt-2 text-rose-300">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
