export type Region = {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  why: string;
  /** Repository path of the official boundary the detections are clipped to. */
  geometry?: string;
};

/** One payload per region, straight from `GET /calendar`. */
export type CalendarPayload = {
  region: Region;
  years: number[];
  months: number[];
  /** [monthIndex][yearIndex], in Aqua MODIS detections. */
  harmonized: (number | null)[][];
  /** [monthIndex][yearIndex], every satellite summed: the series that jumps. */
  raw_count: (number | null)[][];
  /** The sensor only observed part of the month: never read it as an anomaly. */
  partial: boolean[][];
  /** The running year: served, but not used to fit the factors. */
  provisional: boolean[][];
  /** Which sensor carried the month, and the factor applied to it. */
  source: (string | null)[][];
  factor: (number | null)[][];
  /** Days the carrying sensor observed the planet that month. */
  observed_days: (number | null)[][];
  median_by_month: Record<string, number>;
  anomaly_pct: (number | null)[][];
  units: string;
};

export type MethodPayload = {
  region: string;
  reference: string;
  primary: string;
  tail: string;
  bridge: string;
  units: string;
  method: string;
  calibration: {
    pooled: number | null;
    monthly: Record<string, { factor: number; raw_ratio: number | null; viiRs: number; aqua: number }>;
    tail: { sensor: string; factor: number | null; note: string };
    bridge: { sensor: string; factor: number | null; terra?: number; aqua?: number };
    overlap_first: string;
    calibration_last_year: number | null;
    /** Set when the monthly factors were shrunk towards a larger region's. */
    prior?: { region: string; pooled: number } | null;
  };
  validation: {
    overlap_years: number[];
    per_year: Record<string, { index: number; aqua: number; raw: number; error_pct?: number }>;
    median_abs_error_pct: number | null;
    worst_abs_error_pct: number | null;
    raw_step_2011_to_2013_pct: number | null;
    aqua_step_2011_to_2013_pct: number | null;
    index_step_2011_to_2013_pct: number | null;
    /** Out of sample: factors fitted up to `train[1]`, Aqua hidden, `test` rebuilt from VIIRS. */
    holdout?: Holdout | null;
  };
  /** Detections in the cache box and inside the official boundary. */
  boundary?: { in_bbox: number; in_boundary: number; geometry: string | null } | null;
  coverage: { first_month: string | null; last_month: string | null };
  artifacts: { calendar: string; hotspots: string };
  rows: number;
  limitations: string[];
};

export type Holdout = {
  train: [string, string];
  test: [string, string];
  months: number;
  per_year: Record<string, { index: number; aqua: number; raw_viirs: number; error_pct?: number }>;
  error_pct: number | null;
  raw_error_pct: number | null;
  median_abs_year_error_pct: number | null;
  spearman_monthly: number | null;
};

export type Cell = {
  year: number;
  month: number;
  index: number | null;
  raw: number | null;
  median: number | null;
  anomaly: number | null;
  partial: boolean;
  provisional: boolean;
};
