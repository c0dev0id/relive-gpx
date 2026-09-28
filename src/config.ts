// Tile sources.
//
// - Base imagery: Google satellite (XYZ). Higher quality than Esri in most
//   regions. NOTE: these mt*.google.com tiles are undocumented and against
//   Google's ToS for public/production use — fine for personal/showcase use.
//   For a public deployment, swap to the Esri fallback below or a keyed vendor.
// - Terrain DEM: AWS "terrarium" elevation tiles (open data), free, no key.

export const config = {
  satelliteTiles: [
    "https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    "https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    "https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
  ],
  satelliteAttribution: "Imagery © Google",
  satelliteMaxZoom: 20,

  // Keyless fallback — replace satelliteTiles with [esriTiles] to use it.
  esriTiles:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",

  terrainDem:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  terrainAttribution: "Elevation: AWS Terrain Tiles / Mapzen",
  terrainExaggeration: 1.4,
};
