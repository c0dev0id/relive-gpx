# Development Journal

## Overview and intent

live-gpx is a static, browser-based tool for replaying a recorded GPX track on a
3D map. A user uploads a GPX file; the app parses it and produces a replay view
with a moving rider marker, a growing trail, a chase camera, and telemetry
panels (speed, altitude, distance, time, and a speed-distribution histogram).
Playback can be scrubbed, paused, and run at 1x/2x/4x/8x.

The tool targets high-rate recordings (e.g. 4 Hz). Because the replay clock is
driven by real timestamps rather than point index, dense recordings replay with
proportional accuracy — a 4 Hz track and a 1 Hz track both play back in true
elapsed time.

## Software stack

- **Build/tooling:** Vite 6, TypeScript (strict), no framework CLI — hand-written
  config for a static single-page bundle (`base: "./"`, so it can be hosted from
  any path).
- **UI:** Solid.js. Fine-grained reactivity maps cleanly onto a single playback
  cursor signal that fans out to the map and charts.
- **Map:** MapLibre GL JS 5. Satellite imagery (Esri World Imagery) draped over
  AWS "terrarium" DEM terrain. No API key required.
- **Charts:** uPlot. Chosen for its performance with dense time series.
- **Testing:** Node 24 native TypeScript type-stripping runs the test scripts
  directly; linkedom provides a DOM for parser tests.

## Key decisions

- **Timestamp-driven clock, not index-driven.** Each track point carries a
  cumulative time offset and cumulative distance, precomputed once. Playback and
  the scrubber write into one `time` signal; a binary-search sampler interpolates
  position/speed/heading at any instant. This is what makes 4 Hz data accurate.

- **Trail via `line-gradient`, not growing geometry.** MapLibre has no
  `line-trim-offset` (that is a Mapbox feature). The full route is drawn once as a
  line with `lineMetrics`; the traveled portion is revealed by updating a
  `line-gradient` step expression over `line-progress` each frame. This avoids
  rebuilding a large GeoJSON coordinate array on every frame.

- **Camera uses `jumpTo` with a low-pass-smoothed bearing.** Position is already
  interpolated smoothly by the sampler, so per-frame `easeTo` would fight the
  animation loop. The bearing is smoothed so the chase camera swings gently
  instead of snapping on every squiggle in the track.

- **Namespace-agnostic GPX parsing.** GPX elements live in the GPX default
  namespace, so CSS type selectors like `querySelector("trkpt")` do not match them
  portably. The parser enumerates with the universal selector and derives each
  element's local name from `tagName`, which behaves identically across browsers
  and test DOMs and tolerates arbitrary extension prefixes (gpxtpx, gpxdata, …).

- **No API keys / open tile sources.** Default imagery and terrain come from
  keyless providers so the tool works as a drop-in static page. Tile sources are
  isolated in `src/config.ts` for easy swapping to a vendor style.

## Core features

- Drag-and-drop or file-picker GPX upload with error reporting.
- 3D terrain map with satellite imagery.
- Moving rider marker (heading-aligned) with a growing trail over the dim full route.
- Slow-follow chase camera (toggleable) and a "fit route" control.
- Telemetry panel: current speed, altitude, distance, elapsed/total time, plus
  HR and power when present in the file.
- Charts: altitude-over-distance and speed-over-time with a synced playback
  cursor, and a speed-distribution histogram.
- Transport controls: play/pause, timeline scrubber, 1x/2x/4x/8x speed.
