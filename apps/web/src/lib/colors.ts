/**
 * Two ramps, both colorblind-safe:
 *
 * - sequential: viridis, perceptually uniform, survives every common form of
 *   color vision deficiency.
 * - diverging: coolwarm, which stays readable under deuteranopia because the
 *   two ends differ in lightness as well as in hue.
 *
 * Colour is never the only signal: every cell carries its value in a tooltip
 * and the detail panel repeats it as text.
 */
const VIRIDIS = [
  "#440154",
  "#482878",
  "#3e4989",
  "#31688e",
  "#26828e",
  "#1f9e89",
  "#35b779",
  "#6ece58",
  "#b5de2b",
  "#fde725",
];

const COOLWARM = ["#3b4cc0", "#7b9ff9", "#dddddd", "#f2a582", "#b40426"];

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mix(stops: string[], t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const position = clamped * (stops.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(stops.length - 1, lower + 1);
  const weight = position - lower;
  const [r1, g1, b1] = hexToRgb(stops[lower]);
  const [r2, g2, b2] = hexToRgb(stops[upper]);
  const channel = (a: number, b: number) => Math.round(a + (b - a) * weight);
  return `rgb(${channel(r1, r2)}, ${channel(g1, g2)}, ${channel(b1, b2)})`;
}

export function sequential(t: number): string {
  return mix(VIRIDIS, t);
}

export function diverging(t: number): string {
  return mix(COOLWARM, (Math.min(1, Math.max(-1, t)) + 1) / 2);
}

export function textOn(background: string): string {
  const match = background.match(/\d+/g);
  if (!match) return "#0b0f14";
  const [r, g, b] = match.map(Number);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#0b0f14" : "#f8fafc";
}
