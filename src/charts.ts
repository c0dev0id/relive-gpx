// uPlot chart builders. uPlot is imperative and extremely fast with dense
// series, which is exactly what 4 Hz recordings produce.

import uPlot from "uplot";
import type { Track } from "./gpx";
import { mpsToKmh } from "./format";

const AXIS = "#8a8f98";
const GRID = "rgba(255,255,255,0.06)";

function baseAxis(): uPlot.Axis {
  return {
    stroke: AXIS,
    grid: { stroke: GRID, width: 1 },
    ticks: { stroke: GRID, width: 1 },
    font: "11px system-ui, sans-serif",
  };
}

export interface Chart {
  el: HTMLElement;
  redraw(): void;
  resize(w: number, h: number): void;
  destroy(): void;
}

export function elevationChart(
  track: Track,
  w: number,
  h: number,
  getDistKm: () => number,
): Chart {
  const xs = track.points.map((p) => p.dist / 1000);
  const ys = track.points.map((p) => p.ele);
  const opts: uPlot.Options = {
    width: w,
    height: h,
    title: "Altitude (m) / distance (km)",
    cursor: { show: false },
    legend: { show: false },
    scales: { x: { time: false } },
    axes: [baseAxis(), baseAxis()],
    series: [
      {},
      {
        stroke: "#34c759",
        fill: "rgba(52,199,89,0.18)",
        width: 1.5,
        points: { show: false },
      },
    ],
    plugins: [],
  };
  const u = new uPlot(opts, [xs, ys as number[]], undefined);
  return chartHandle(u, getDistKm);
}

export function speedChart(
  track: Track,
  w: number,
  h: number,
  getTimeSec: () => number,
): Chart {
  // Play-time axis so the cursor aligns with the playback clock and breaks
  // don't stretch the chart into a long flat dead zone.
  const xs = track.points.map((p) => p.pt);
  const ys = track.points.map((p) => mpsToKmh(p.speed));
  const opts: uPlot.Options = {
    width: w,
    height: h,
    title: "Speed (km/h) / time (s)",
    cursor: { show: false },
    legend: { show: false },
    scales: { x: { time: false } },
    axes: [baseAxis(), baseAxis()],
    series: [
      {},
      {
        stroke: "#0a84ff",
        fill: "rgba(10,132,255,0.18)",
        width: 1.5,
        points: { show: false },
      },
    ],
    plugins: [],
  };
  const u = new uPlot(opts, [xs, ys], undefined);
  return chartHandle(u, getTimeSec);
}

export function speedHistogram(track: Track, w: number, h: number): Chart {
  const speeds = track.points.map((p) => mpsToKmh(p.speed));
  // Derive the axis from the 99th percentile, not the max: a single GPS glitch
  // can spike speedMax to thousands of km/h and squash all real data into the
  // first bin. Speeds above the axis clamp into the top bin below.
  const sorted = [...speeds].sort((a, b) => a - b);
  const p99 = sorted[Math.floor((sorted.length - 1) * 0.99)] ?? 0;
  const maxV = Math.max(10, Math.ceil(p99));
  const binCount = Math.min(24, Math.max(8, Math.round(maxV / 5)));
  const binSize = maxV / binCount;
  const bins = new Array(binCount).fill(0);
  for (const v of speeds) {
    const b = Math.min(binCount - 1, Math.floor(v / binSize));
    bins[b] += 1;
  }
  const centers = bins.map((_, i) => (i + 0.5) * binSize);
  const opts: uPlot.Options = {
    width: w,
    height: h,
    title: "Speed distribution (km/h)",
    cursor: { show: false },
    legend: { show: false },
    scales: { x: { time: false } },
    axes: [baseAxis(), baseAxis()],
    series: [
      {},
      {
        stroke: "#ff9f0a",
        fill: "rgba(255,159,10,0.5)",
        width: 1,
        paths: uPlot.paths.bars!({ size: [0.9, 100] }),
        points: { show: false },
      },
    ],
    plugins: [],
  };
  const u = new uPlot(opts, [centers, bins], undefined);
  return chartHandle(u);
}

// The playback cursor is a DOM line over the plot area, not a canvas draw, so
// moving it every frame is a single style write instead of a full re-stroke of
// the (dense) series. getX returns the cursor's x-axis value each frame.
function chartHandle(u: uPlot, getX?: () => number): Chart {
  let cursor: HTMLDivElement | undefined;
  if (getX) {
    cursor = document.createElement("div");
    Object.assign(cursor.style, {
      position: "absolute",
      top: "0",
      bottom: "0",
      width: "0",
      borderLeft: "1.5px solid #ffd60a",
      pointerEvents: "none",
      display: "none",
    });
    u.over.appendChild(cursor);
  }
  // Cached so moveCursor doesn't force a layout read every frame; the plot width
  // only changes on resize.
  let plotWidth = u.over.clientWidth;
  const moveCursor = () => {
    if (!cursor || !getX) return;
    const x = getX();
    if (x == null || !Number.isFinite(x)) {
      cursor.style.display = "none";
      return;
    }
    const left = u.valToPos(x, "x");
    if (left < 0 || left > plotWidth) {
      cursor.style.display = "none";
      return;
    }
    cursor.style.display = "";
    cursor.style.transform = `translateX(${left}px)`;
  };
  return {
    el: u.root,
    redraw: moveCursor,
    resize: (w, h) => {
      u.setSize({ width: w, height: h });
      plotWidth = u.over.clientWidth;
      moveCursor();
    },
    destroy: () => u.destroy(),
  };
}
