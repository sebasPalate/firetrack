/** Number formatting shared by every panel, so the units never drift. */
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatIndex(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value >= 1000 ? integer.format(value) : oneDecimal.format(value);
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return integer.format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${oneDecimal.format(value)} %`;
}

export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatIndex(value)}`;
}
