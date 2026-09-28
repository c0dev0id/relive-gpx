// Tile sources.
//
// - Base imagery: MapTiler satellite when a key is present, otherwise the
//   keyless Esri World Imagery fallback so local dev works without a key.
//   The key is read from VITE_MAPTILER_KEY at build time (injected from a
//   GitHub Actions secret in CI). It is exposed to the client, so restrict it
//   to the deployment origin in the MapTiler account.
// - Terrain DEM: AWS "terrarium" elevation tiles (open data), free, no key.

const maptilerKey = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

// Keyless fallback. Esri serves 256px tiles up to z19.
const esriTiles =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const satellite = maptilerKey
  ? {
      tiles: [
        `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${maptilerKey}`,
      ],
      tileSize: 512,
      maxZoom: 20,
      attribution: "© MapTiler © OpenStreetMap contributors",
    }
  : {
      tiles: [esriTiles],
      tileSize: 256,
      maxZoom: 19,
      attribution: "Imagery © Esri",
    };

export const config = {
  satelliteTiles: satellite.tiles,
  satelliteTileSize: satellite.tileSize,
  satelliteMaxZoom: satellite.maxZoom,
  satelliteAttribution: satellite.attribution,

  terrainDem:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
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
