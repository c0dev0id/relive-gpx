// MapLibre 3D map: satellite imagery draped over DEM terrain, the full route
// as a dim line, a bright trail revealed via line-trim-offset, a rider marker,
// and an optional slow-follow chase camera.

import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { Feature, LineString, Point } from "geojson";
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

// A north-pointing arrow drawn on a canvas, used as the rider symbol icon.
// Rendered on the map (not as a DOM marker) so it sits on the same terrain
// surface as the trail — otherwise, under pitch, the two appear offset.
function makeArrowImage(size = 64): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const s = size;
  ctx.translate(s / 2, s / 2);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.4); // tip (points up = north)
  ctx.lineTo(s * 0.28, s * 0.34);
  ctx.lineTo(0, s * 0.16); // rear notch, chevron shape
  ctx.lineTo(-s * 0.28, s * 0.34);
  ctx.closePath();
  ctx.fillStyle = "#ff3b30";
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = s * 0.05;
  ctx.lineJoin = "round";
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, s, s);
}

// Solid trail color up to `progress` along the line, transparent afterwards.
// line-progress step stops must be strictly inside (0, 1).
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
  private ready = false;
  private smoothedBearing = 0;
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

    this.map.on("load", () => {
      this.ready = true;
      // pixelRatio 2 => 64px canvas renders at 32 CSS px base size.
      this.map.addImage("rider-arrow", makeArrowImage(), { pixelRatio: 2 });
      if (this.track) this.installTrack(this.track);
    });
  }

  private riderFeature(lon: number, lat: number, bearing: number): Feature<Point> {
    return {
      type: "Feature",
      properties: { bearing },
      geometry: { type: "Point", coordinates: [lon, lat] },
    };
  }

  setTrack(track: Track) {
    this.track = track;
    if (this.ready) this.installTrack(track);
  }

  private installTrack(track: Track) {
    const coords = track.points.map((p) => [p.lon, p.lat] as [number, number]);
    const geojson: Feature<LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    };

    if (this.map.getSource("route")) {
      (this.map.getSource("route") as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      this.map.addSource("route", {
        type: "geojson",
        data: geojson,
        lineMetrics: true,
      });
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
      // MapLibre has no line-trim-offset; reveal the trail with a line-gradient
      // step over line-progress (transparent past the current position).
      this.map.addLayer({
        id: "route-trail",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 5,
          "line-gradient": trailGradient(0),
        },
      });
    }

    const p0 = track.points[0];
    const riderData = this.riderFeature(p0.lon, p0.lat, p0.heading);
    if (this.map.getSource("rider")) {
      (this.map.getSource("rider") as maplibregl.GeoJSONSource).setData(riderData);
    } else {
      this.map.addSource("rider", { type: "geojson", data: riderData });
      this.map.addLayer({
        id: "rider-halo",
        type: "circle",
        source: "rider",
        paint: {
          "circle-radius": 9,
          "circle-color": "#ff3b30",
          "circle-opacity": 0.25,
        },
      });
      this.map.addLayer({
        id: "rider",
        type: "symbol",
        source: "rider",
        layout: {
          "icon-image": "rider-arrow",
          "icon-size": 1.15,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
    }
    this.smoothedBearing = p0.heading;

    this.map.fitBounds(track.bounds, {
      padding: 80,
      pitch: 60,
      bearing: track.points[0].heading,
      duration: 0,
    });
  }

  // Called every animation frame with the interpolated rider state.
  update(sample: Sample, progress: number) {
    if (!this.ready || !this.track) return;

    const rider = this.map.getSource("rider") as maplibregl.GeoJSONSource | undefined;
    rider?.setData(this.riderFeature(sample.lon, sample.lat, sample.heading));

    if (this.map.getLayer("route-trail")) {
      this.map.setPaintProperty(
        "route-trail",
        "line-gradient",
        trailGradient(progress),
      );
    }

    if (this.follow) {
      // Low-pass the bearing so the chase camera swings gently.
      const target = sample.heading;
      let diff = ((target - this.smoothedBearing + 540) % 360) - 180;
      this.smoothedBearing = (this.smoothedBearing + diff * 0.08 + 360) % 360;
      this.map.jumpTo({
        center: [sample.lon, sample.lat],
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
    this.map.remove();
  }
}
