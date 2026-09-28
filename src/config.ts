// Tile sources. No API key required by default.
//
// - Base imagery: Esri World Imagery (satellite). Swap `styleUrl` for a
//   MapTiler/vendor style if you have a key and prefer vector basemaps.
// - Terrain DEM: AWS "terrarium" elevation tiles (open data), free, no key.

export const config = {
  satelliteTiles:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  satelliteAttribution:
    "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  terrainDem:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  terrainAttribution: "Elevation: AWS Terrain Tiles / Mapzen",
  terrainExaggeration: 1.4,
};
