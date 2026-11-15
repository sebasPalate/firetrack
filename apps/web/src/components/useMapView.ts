"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Zoom and pan for an inline SVG map, with no map library.
 *
 * The view is a centre and a zoom factor in map coordinates, so a single
 * `viewBox` carries the whole transform and the marks stay vector. The hook also
 * owns the two things that need a DOM measurement: the box size (a
 * `ResizeObserver`) and the pointer-to-map conversion (the SVG CTM).
 */

export type View = { cx: number; cy: number; k: number };

/** Beyond this the marks are individual pixels and the SVG turns into noise. */
const MAX_ZOOM = 14;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Keep the view inside the map: the centre may only travel as far as the zoomed window allows. */
function clampView(view: View, width: number, height: number): View {
  const halfWidth = width / view.k / 2;
  const halfHeight = height / view.k / 2;
  return {
    k: view.k,
    cx: clamp(view.cx, halfWidth, width - halfWidth),
    cy: clamp(view.cy, halfHeight, height - halfHeight),
  };
}

function zoomView(
  view: View,
  nextK: number,
  width: number,
  height: number,
  anchor?: { x: number; y: number },
): View {
  const k = clamp(nextK, 1, MAX_ZOOM);
  const ax = anchor?.x ?? view.cx;
  const ay = anchor?.y ?? view.cy;
  const ratio = view.k / k;
  return clampView({ k, cx: ax - (ax - view.cx) * ratio, cy: ay - (ay - view.cy) * ratio }, width, height);
}

export function useMapView(width: number, height: number) {
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const [view, setView] = useState<View>(() => ({ cx: width / 2, cy: height / 2, k: 1 }));
  const [size, setSize] = useState({ w: 800, h: 460 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => setSize({ w: element.clientWidth || 800, h: element.clientHeight || 460 });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Pointer position in map coordinates; the CTM already accounts for letterboxing and zoom. */
  const toMap = useCallback((clientX: number, clientY: number) => {
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (!element || !matrix) return null;
    const point = element.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const mapped = point.matrixTransform(matrix.inverse());
    return { x: mapped.x, y: mapped.y };
  }, []);

  // Plain scrolling must keep scrolling the page, so the wheel only zooms with Ctrl or ⌘.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const anchor = toMap(event.clientX, event.clientY);
      const factor = event.deltaY < 0 ? 1.25 : 0.8;
      setView((current) => zoomView(current, current.k * factor, width, height, anchor ?? undefined));
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [toMap, width, height]);

  /** One map unit is `scale` screen pixels, so a mark drawn in map units has to divide by it. */
  const scale = view.k * Math.min(size.w / width, size.h / height);
  const unit = 1 / scale;
  const viewW = width / view.k;
  const viewH = height / view.k;
  const viewBox = `${view.cx - viewW / 2} ${view.cy - viewH / 2} ${viewW} ${viewH}`;

  const zoomBy = (factor: number) => setView((current) => zoomView(current, current.k * factor, width, height));
  const reset = () => setView({ cx: width / 2, cy: height / 2, k: 1 });

  const zoomToPoint = (x: number, y: number, minK: number) =>
    setView((current) => clampView({ k: Math.max(current.k, minK), cx: x, cy: y }, width, height));

  const startDrag = (clientX: number, clientY: number) => {
    drag.current = { x: clientX, y: clientY, cx: view.cx, cy: view.cy };
    setDragging(true);
  };

  /** Returns false when there is no drag in flight, so the caller can fall through to a hover test. */
  const pan = (clientX: number, clientY: number): boolean => {
    const start = drag.current;
    if (!start) return false;
    const dx = (clientX - start.x) / scale;
    const dy = (clientY - start.y) / scale;
    setView((current) => clampView({ k: current.k, cx: start.cx - dx, cy: start.cy - dy }, width, height));
    return true;
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return {
    frame,
    svg,
    view,
    size,
    dragging,
    scale,
    unit,
    viewBox,
    toMap,
    zoomBy,
    reset,
    zoomToPoint,
    startDrag,
    pan,
    endDrag,
  };
}
