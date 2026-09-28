// MapLibre 3D map: satellite imagery draped over DEM terrain, the full route
// drawn as a static speed-colored line, the part ahead of the rider hidden by a
// cover line whose reveal moves via a line-gradient step, a DOM rider marker,
// and an optional slow-follow camera.

import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { Feature, LineString } from "geojson";
import { config } from "./config";
import { shortestAngle, type Track, type Sample } from "./gpx";
import { mpsToKmh } from "./format";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// Map a speed (km/h) to a color by interpolating the configured corridor stops.
// Below the first / above the last stop clamps to that stop's color.
function speedColor(kmh: number): string {
  const stops = config.speedColorStops;
  if (kmh <= stops[0].kmh) return stops[0].color;
  const last = stops[stops.length - 1];
  if (kmh >= last.kmh) return last.color;
  for (let i = 1; i < stops.length; i++) {
    if (kmh <= stops[i].kmh) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (kmh - a.kmh) / (b.kmh - a.kmh);
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
      const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
      const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return last.color;
}

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: config.satelliteTiles,
        tileSize: config.satelliteTileSize,
        maxzoom: config.satelliteMaxZoom,
        attribution: config.satelliteAttribution,
      },
      terrain: {
        type: "raster-dem",
        tiles: [config.terrainDem],
        tileSize: 256,
        maxzoom: 15,
        encoding: "terrarium",
        attribution: config.terrainAttribution,
      },
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
    sky: {
      // Deep blue overhead fading to a hazy, slightly warm horizon, with ground
      // fog blended into the terrain and the atmospheric halo turned on so the
      // sky reads as real when the camera is pitched up to the horizon.
      "sky-color": "#3f78c0",
      "horizon-color": "#c4d7ec",
      "fog-color": "#dce8f4",
      "sky-horizon-blend": 0.8,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.5,
      "atmosphere-blend": 0.6,
    },
    terrain: { source: "terrain", exaggeration: config.terrainExaggeration },
  };
}

// The rider marker: a halo + north-pointing chevron as an SVG DOM element.
// A DOM marker (not a symbol layer) is used because symbol placement is
// recomputed on a throttle, so a symbol moved every frame renders in visible
// steps; a marker updates its CSS transform on every map move, i.e. smoothly.
// With terrain enabled MapLibre projects the marker onto the terrain surface,
// so it stays aligned with the trail under pitch.
function makeRiderElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.style.width = el.style.height = "44px";
  el.innerHTML = `
    <svg width="44" height="44" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="15" fill="rgba(255,59,48,0.25)"/>
      <path d="M32 6.4 L49.9 53.8 L32 42.2 L14.1 53.8 Z"
            fill="#ff3b30" stroke="rgba(255,255,255,0.95)"
            stroke-width="3" stroke-linejoin="round"/>
    </svg>`;
  return el;
}

function lineFeature(coords: [number, number][]): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

// The route-cover gradient: transparent up to `progress` (a line-progress
// fraction, so the speed-colored line below shows through the ridden part),
// then the route-ahead color past it. Moving the reveal is a paint change on
// static geometry — no re-tiling, so it tracks the marker with no gap at any
// zoom. The step stop must stay strictly inside (0, 1).
function coverGradient(progress: number): maplibregl.ExpressionSpecification {
  const p = clamp(progress, 0.0001, 0.9999);
  return [
    "step",
    ["line-progress"],
    "rgba(0,0,0,0)",
    p,
    config.routeAheadColor,
  ] as maplibregl.ExpressionSpecification;
}

export class ReplayMap {
  readonly map: maplibregl.Map;
  private track: Track | null = null;
  // Per-vertex Mercator coordinates and cumulative line-progress (0..1), matching
  // the metric MapLibre uses for `line-progress`, so the reveal can't drift from
  // the rider even though the two are derived independently.
  private merc: { x: number; y: number }[] = [];
  private cumProgress: number[] = [];
  // Last progress fraction pushed to the trail gradient, so frames that don't
  // advance it past the gradient's visible resolution skip the paint update.
  private lastTrailProgress = -1;
  // The chase zoom is set once on the first follow frame after a load; after
  // that the user's zoom is left alone so they can pull the camera back (which
  // also stops it clipping into hills at high pitch).
  private framedFollow = false;
  private ready = false;
  private smoothedBearing = 0;
  private smoothLon = 0;
  private smoothLat = 0;
  private rider: maplibregl.Marker;
  follow = true;

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: buildStyle(),
      center: [0, 0],
      zoom: 1,
      pitch: 60,
      attributionControl: { compact: true },
      maxPitch: 85,
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    this.rider = new maplibregl.Marker({
      element: makeRiderElement(),
      rotationAlignment: "map",
      pitchAlignment: "map",
      subpixelPositioning: true,
    });

    this.map.on("load", () => {
      this.ready = true;
      if (this.track) this.installTrack(this.track);
    });
  }

  setTrack(track: Track) {
    this.track = track;
    if (this.ready) this.installTrack(track);
  }

  private installTrack(track: Track) {
    const coords = track.points.map((p) => [p.lon, p.lat] as [number, number]);
    this.computeProgress(coords);
    this.lastTrailProgress = 0;
    this.framedFollow = false;
    const geojson = lineFeature(coords);

    const speedGradient = this.speedGradient(track);

    if (this.map.getSource("route")) {
      (this.map.getSource("route") as maplibregl.GeoJSONSource).setData(geojson);
      this.map.setPaintProperty("route-speed", "line-gradient", speedGradient);
      this.map.setPaintProperty("route-cover", "line-gradient", coverGradient(0));
    } else {
      // `line-progress` (the speed gradient and the reveal) is only defined when
      // lineMetrics is on.
      this.map.addSource("route", { type: "geojson", data: geojson, lineMetrics: true });
      // Full route colored by speed, built once. The cover above hides the part
      // ahead of the rider; revealing more is a paint change on this static
      // geometry, so it tracks the marker with no re-tiling lag or gap.
      this.map.addLayer({
        id: "route-speed",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 5, "line-gradient": speedGradient },
      });
      this.map.addLayer({
        id: "route-cover",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 5, "line-gradient": coverGradient(0) },
      });
    }

    const p0 = track.points[0];
    this.rider.setLngLat([p0.lon, p0.lat]).setRotation(p0.heading).addTo(this.map);
    this.smoothedBearing = p0.heading;
    this.smoothLon = p0.lon;
    this.smoothLat = p0.lat;

    this.map.fitBounds(track.bounds, {
      padding: 80,
      pitch: 60,
      bearing: track.points[0].heading,
      duration: 0,
    });
  }

  // Called every animation frame with the interpolated rider state.
  update(sample: Sample) {
    if (!this.ready || !this.track) return;

    this.rider.setLngLat([sample.lon, sample.lat]).setRotation(sample.heading);

    const p = this.progressAt(sample.index, sample.lon, sample.lat);
    // Repaint the reveal only when its boundary would move at least ~1 screen
    // pixel. The threshold must be in pixels, not a fixed fraction of the line:
    // a fixed fraction has a physical size that scales with the track, so on a
    // long ride it would jump tens of meters between updates. progress is a
    // fraction of the whole line, so 1px of movement is metersPerPixel over the
    // total length.
    const metersPerPixel =
      (40075016.686 * Math.cos((sample.lat * Math.PI) / 180)) /
      (512 * 2 ** this.map.getZoom());
    const threshold = metersPerPixel / (this.track.totalDist || 1);
    if (Math.abs(p - this.lastTrailProgress) >= threshold) {
      this.lastTrailProgress = p;
      this.map.setPaintProperty("route-cover", "line-gradient", coverGradient(p));
    }

    if (this.follow) {
      // Low-pass both bearing and center so the chase camera drifts rather than
      // locking on: a gentle suggestion of a follow, not a rigid one.
      const diff = shortestAngle(this.smoothedBearing, sample.heading);
      this.smoothedBearing = (this.smoothedBearing + diff * 0.02 + 360) % 360;
      this.smoothLon += (sample.lon - this.smoothLon) * 0.12;
      this.smoothLat += (sample.lat - this.smoothLat) * 0.12;
      this.map.jumpTo({
        center: [this.smoothLon, this.smoothLat],
        bearing: this.smoothedBearing,
        pitch: 62,
        // Only set the zoom once, to establish the chase framing; leaving it out
        // afterwards preserves whatever zoom the user has dialed in.
        ...(this.framedFollow ? {} : { zoom: Math.max(this.map.getZoom(), 15) }),
        // Push the rider toward the lower third so we see the road ahead.
        padding: { top: 260, bottom: 0, left: 0, right: 0 },
      });
      this.framedFollow = true;
    }
  }

  // Precompute per-vertex Mercator coords and normalized cumulative distance.
  // line-progress is cumulative Euclidean distance in projected (Mercator) space
  // normalized to the total, so matching that metric keeps the reveal aligned.
  private computeProgress(coords: [number, number][]) {
    const merc = coords.map((c) => {
      const m = maplibregl.MercatorCoordinate.fromLngLat({ lng: c[0], lat: c[1] });
      return { x: m.x, y: m.y };
    });
    const cum = new Array<number>(coords.length);
    cum[0] = 0;
    for (let i = 1; i < merc.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(merc[i].x - merc[i - 1].x, merc[i].y - merc[i - 1].y);
    }
    const total = cum[cum.length - 1] || 1;
    this.merc = merc;
    this.cumProgress = cum.map((d) => d / total);
  }

  // line-progress of the rider: interpolate between the bracketing vertices by
  // the foot of the rider's position projected onto that Mercator segment.
  private progressAt(idx: number, lon: number, lat: number): number {
    const prog = this.cumProgress;
    if (idx >= prog.length - 1) return prog[prog.length - 1] ?? 1;
    const a = this.merc[idx];
    const b = this.merc[idx + 1];
    const h = maplibregl.MercatorCoordinate.fromLngLat({ lng: lon, lat: lat });
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? clamp(((h.x - a.x) * dx + (h.y - a.y) * dy) / len2, 0, 1) : 0;
    return prog[idx] + t * (prog[idx + 1] - prog[idx]);
  }

  // A static line-gradient coloring each vertex by its speed. Stops are keyed on
  // cumProgress (the same line-progress metric MapLibre samples) and must be
  // strictly ascending; coincident points are skipped. The line-gradient
  // rasterizes to a bounded texture, so more than ~1024 stops buys nothing —
  // downsample to keep the expression small.
  private speedGradient(track: Track): maplibregl.ExpressionSpecification {
    const prog = this.cumProgress;
    const pts = track.points;
    const CAP = 1024;
    const minStep = 1 / CAP;
    const stops: (number | string)[] = [];
    let lastU = -1;
    for (let i = 0; i < prog.length; i++) {
      const u = clamp(prog[i], 0, 1);
      const isLast = i === prog.length - 1;
      if (!isLast && u - lastU < minStep) continue;
      if (u <= lastU) continue;
      stops.push(u, speedColor(mpsToKmh(pts[i].speed)));
      lastU = u;
    }
    // interpolate needs at least two stops; degenerate tracks fall back to one color.
    if (stops.length < 4) {
      const c = (stops[1] as string) ?? speedColor(0);
      return ["interpolate", ["linear"], ["line-progress"], 0, c, 1, c] as maplibregl.ExpressionSpecification;
    }
    return ["interpolate", ["linear"], ["line-progress"], ...stops] as maplibregl.ExpressionSpecification;
  }

  frameToTrack() {
    if (this.track)
      this.map.fitBounds(this.track.bounds, { padding: 80, pitch: 60, duration: 800 });
  }

  destroy() {
    this.rider.remove();
    this.map.remove();
  }
}
