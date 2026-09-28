// MapLibre 3D map: satellite imagery draped over DEM terrain, the full route
// as a dim line, a bright trail revealed along that same static line via a
// line-gradient step, a DOM rider marker, and an optional slow-follow camera.

import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { Feature, LineString } from "geojson";
import { config } from "./config";
import type { Track, Sample } from "./gpx";

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: config.satelliteTiles,
        tileSize: 256,
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
      "sky-color": "#88bbee",
      "horizon-color": "#ddeeff",
      "fog-color": "#ffffff",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.2,
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

// Solid trail up to `progress` (a line-progress fraction, 0..1), transparent
// afterwards. Applied as a paint property on the static route line, so revealing
// more of the trail never re-tiles geometry — only the gradient ramp updates.
// The step stop must stay strictly inside (0, 1).
function trailGradient(progress: number): maplibregl.ExpressionSpecification {
  const p = Math.min(0.9999, Math.max(0.0001, progress));
  return [
    "step",
    ["line-progress"],
    "#ff3b30",
    p,
    "rgba(0,0,0,0)",
  ] as maplibregl.ExpressionSpecification;
}

export class ReplayMap {
  readonly map: maplibregl.Map;
  private track: Track | null = null;
  // Per-vertex Mercator coordinates and cumulative line-progress (0..1), matching
  // the metric MapLibre uses for `line-progress`, so the reveal can't drift from
  // the rider even though the two are derived independently.
  private merc: { x: number; y: number }[] = [];
  private progress: number[] = [];
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
    const geojson = lineFeature(coords);

    if (this.map.getSource("route")) {
      (this.map.getSource("route") as maplibregl.GeoJSONSource).setData(geojson);
      this.map.setPaintProperty("route-trail", "line-gradient", trailGradient(0));
    } else {
      // lineMetrics is required for the `line-progress` used by the trail reveal.
      this.map.addSource("route", { type: "geojson", data: geojson, lineMetrics: true });
      this.map.addLayer({
        id: "route-bg",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 3,
          "line-opacity": 0.35,
        },
      });
      // Same geometry as route-bg; the gradient reveals it up to the rider. Moving
      // the reveal is a paint change, not a geometry change, so it tracks the
      // marker synchronously at any zoom (no worker re-tiling lag, hence no gap).
      this.map.addLayer({
        id: "route-trail",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 5, "line-gradient": trailGradient(0) },
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

    if (this.map.getLayer("route-trail")) {
      const p = this.progressAt(sample.index, sample.lon, sample.lat);
      this.map.setPaintProperty("route-trail", "line-gradient", trailGradient(p));
    }

    if (this.follow) {
      // Low-pass both bearing and center so the chase camera drifts rather than
      // locking on: a gentle suggestion of a follow, not a rigid one.
      const diff = ((sample.heading - this.smoothedBearing + 540) % 360) - 180;
      this.smoothedBearing = (this.smoothedBearing + diff * 0.02 + 360) % 360;
      this.smoothLon += (sample.lon - this.smoothLon) * 0.12;
      this.smoothLat += (sample.lat - this.smoothLat) * 0.12;
      this.map.jumpTo({
        center: [this.smoothLon, this.smoothLat],
        bearing: this.smoothedBearing,
        pitch: 62,
        zoom: Math.max(this.map.getZoom(), 15),
        // Push the rider toward the lower third so we see the road ahead.
        padding: { top: 260, bottom: 0, left: 0, right: 0 },
      });
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
    this.progress = cum.map((d) => d / total);
  }

  // line-progress of the rider: interpolate between the bracketing vertices by
  // the foot of the rider's position projected onto that Mercator segment.
  private progressAt(idx: number, lon: number, lat: number): number {
    const prog = this.progress;
    if (idx >= prog.length - 1) return prog[prog.length - 1] ?? 1;
    const a = this.merc[idx];
    const b = this.merc[idx + 1];
    const h = maplibregl.MercatorCoordinate.fromLngLat({ lng: lon, lat: lat });
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((h.x - a.x) * dx + (h.y - a.y) * dy) / len2)) : 0;
    return prog[idx] + t * (prog[idx + 1] - prog[idx]);
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
