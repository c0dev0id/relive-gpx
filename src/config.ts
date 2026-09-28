// Tile sources.
//
// - Base imagery: Esri World Imagery. Keyless and unmetered, so it never rate-
//   limits — which is why it is the default for the public deployment. It is a
//   little softer than Google/MapTiler in some regions.
//
//   Sharper alternative, for a LOCAL/personal build only: Google satellite.
//   Those mt*.google.com tiles are undocumented and against Google's ToS for
//   public/production use, so they are left commented out. To use them, swap
//   `satellite` for the Google block below.
//     const satellite = {
//       tiles: [
//         "https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
//         "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
//         "https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
//         "https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
//       ],
//       tileSize: 256,
//       maxZoom: 20,
//       attribution: "Imagery © Google",
//     };
// - Terrain DEM: AWS "terrarium" elevation tiles (open data), free, no key.

const satellite = {
  tiles: [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  ],
  tileSize: 256,
  maxZoom: 19,
  attribution: "Imagery © Esri",
};

export const config = {
  satelliteTiles: satellite.tiles,
  satelliteTileSize: satellite.tileSize,
  satelliteMaxZoom: satellite.maxZoom,
  satelliteAttribution: satellite.attribution,

  // Virtual-hosted S3 URL. The path-style form (s3.amazonaws.com/<bucket>/…)
  // no longer serves over HTTPS, so the DEM must use <bucket>.s3.amazonaws.com.
  terrainDem:
    "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
  terrainAttribution: "Elevation: AWS Terrain Tiles / Mapzen",
  terrainExaggeration: 1.4,

  // Trail speed coloring. The ridden trail is colored by speed (km/h): the
  // color at a given speed is interpolated between the surrounding stops, and
  // speeds below the first / above the last stop clamp to that stop's color.
  // Edit these to set the corridor you care about.
  speedColorStops: [
    { kmh: 60, color: "#ff3b30" }, // red — at/below: dropped out of the corridor
    { kmh: 75, color: "#ffd60a" }, // yellow — bottom of the corridor
    { kmh: 90, color: "#34c759" }, // green — sweet spot
    { kmh: 100, color: "#0a84ff" }, // blue — at/above: fast, no longer of interest
  ] as { kmh: number; color: string }[],
  // Color of the not-yet-ridden route ahead.
  routeAheadColor: "rgba(60,64,72,0.9)",
};
