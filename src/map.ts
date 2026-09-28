// MapLibre 3D map: satellite imagery draped over DEM terrain, the full route
// as a dim line, a bright trail built from the traveled coordinates, a DOM
// rider marker, and an optional slow-follow chase camera.

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

// How many traveled points the active drag-line may hold before its geometry is
// folded into the committed trail. Larger = fewer (but bigger) committed
// re-parses and a longer per-frame active line; both are cheap at this size.
const COMMIT_STRIDE = 512;

function lineFeature(coords: [number, number][]): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

export class ReplayMap {
  readonly map: maplibregl.Map;
  private track: Track | null = null;
  private coords: [number, number][] = [];
  private commitIdx = 0;
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
    this.coords = coords;
    this.commitIdx = 0;
    const geojson = lineFeature(coords);
    const start = lineFeature([coords[0]]);

    if (this.map.getSource("route")) {
      (this.map.getSource("route") as maplibregl.GeoJSONSource).setData(geojson);
      (this.map.getSource("trail") as maplibregl.GeoJSONSource).setData(start);
      (this.map.getSource("trail-tip") as maplibregl.GeoJSONSource).setData(start);
    } else {
      this.map.addSource("route", { type: "geojson", data: geojson });
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
      // The trail is drawn from the same coordinates as the rider marker, so
      // the two can't drift apart. It is split to avoid re-parsing the whole
      // (growing) line every frame: "trail" holds the committed history and is
      // rebuilt only once per COMMIT_STRIDE points; "trail-tip" is the short
      // active drag-line from the last committed vertex to the rider, redrawn
      // every frame. Between commits the committed line is never touched.
      this.map.addSource("trail", { type: "geojson", data: start });
      this.map.addLayer({
        id: "trail",
        type: "line",
        source: "trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ff3b30", "line-width": 5 },
      });
      this.map.addSource("trail-tip", { type: "geojson", data: start });
      this.map.addLayer({
        id: "trail-tip",
        type: "line",
        source: "trail-tip",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ff3b30", "line-width": 5 },
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

    const idx = sample.index;
    const head: [number, number] = [sample.lon, sample.lat];

    // Fixate the committed line when the active segment has grown a full stride,
    // or when seeking backwards past the last commit. This is the only time the
    // growing line is re-parsed — a few hundred times over a whole ride, not
    // thousands of times per second.
    if (idx < this.commitIdx || idx - this.commitIdx >= COMMIT_STRIDE) {
      this.commitIdx = idx;
      const trail = this.map.getSource("trail") as maplibregl.GeoJSONSource | undefined;
      trail?.setData(lineFeature(this.coords.slice(0, idx + 1)));
    }
    // Active drag-line: the last committed vertex, along the traveled vertices,
    // to the rider's interpolated position. Shares the committed line's last
    // vertex, so the two join seamlessly. Bounded to ~COMMIT_STRIDE points.
    const tip = this.map.getSource("trail-tip") as maplibregl.GeoJSONSource | undefined;
    tip?.setData(lineFeature([...this.coords.slice(this.commitIdx, idx + 1), head]));

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

  frameToTrack() {
    if (this.track)
      this.map.fitBounds(this.track.bounds, { padding: 80, pitch: 60, duration: 800 });
  }

  destroy() {
    this.rider.remove();
    this.map.remove();
  }
}
