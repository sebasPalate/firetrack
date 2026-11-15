import { boundaryUrl } from "./api";

/** Width of the map's own coordinate space. Height follows the region's aspect ratio. */
export const MAP_WIDTH = 1000;

export type Projection = {
  width: number;
  height: number;
  project: (lon: number, lat: number) => [number, number];
};

/**
 * Equirectangular with a cos(latitude) correction at the region's middle, so
 * Aragón is not stretched sideways. Good enough for a region this size, and it
 * needs no map library.
 */
export function makeProjection(bbox: [number, number, number, number]): Projection {
  const [west, south, east, north] = bbox;
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const scale = MAP_WIDTH / ((east - west) * k);
  return {
    width: MAP_WIDTH,
    height: (north - south) * scale,
    project: (lon, lat) => [(lon - west) * k * scale, (north - lat) * scale],
  };
}

type GeoNode = {
  type?: string;
  features?: GeoNode[];
  geometry?: GeoNode | null;
  geometries?: GeoNode[];
  coordinates?: unknown;
};

function ringPath(ring: number[][], project: Projection["project"]): string {
  let path = "";
  ring.forEach((position, index) => {
    const [x, y] = project(position[0], position[1]);
    path += `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `${path}Z`;
}

function visit(node: GeoNode | null | undefined, project: Projection["project"], out: string[]): void {
  if (!node) return;
  switch (node.type) {
    case "FeatureCollection":
      node.features?.forEach((feature) => visit(feature, project, out));
      break;
    case "Feature":
      visit(node.geometry, project, out);
      break;
    case "GeometryCollection":
      node.geometries?.forEach((geometry) => visit(geometry, project, out));
      break;
    case "Polygon":
      (node.coordinates as number[][][]).forEach((ring) => out.push(ringPath(ring, project)));
      break;
    case "MultiPolygon":
      (node.coordinates as number[][][][]).forEach((polygon) =>
        polygon.forEach((ring) => out.push(ringPath(ring, project))),
      );
      break;
    default:
      break;
  }
}

/** One SVG path for the whole boundary; draw it with `fill-rule: evenodd` so holes stay holes. */
export function geoJsonToPath(geojson: unknown, project: Projection["project"]): string {
  const out: string[] = [];
  visit(geojson as GeoNode, project, out);
  return out.join("");
}

const boundaries = new Map<string, Promise<unknown>>();

export function loadBoundary(region: string): Promise<unknown> {
  const cached = boundaries.get(region);
  if (cached) return cached;
  const request = fetch(boundaryUrl(region))
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json() as Promise<unknown>;
    })
    .catch((cause: unknown) => {
      boundaries.delete(region);
      throw cause;
    });
  boundaries.set(region, request);
  return request;
}
