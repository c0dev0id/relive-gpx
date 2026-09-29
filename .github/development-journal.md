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
- **Testing:** Node's native TypeScript type stripping (Node 22.18 or later)
  runs the test scripts directly; linkedom provides a DOM for parser tests.

## Key decisions

- **Timestamp-driven clock, not index-driven.** Each track point carries a
  cumulative time offset and cumulative distance, precomputed once. Playback and
  the scrubber write into one `time` signal; a binary-search sampler interpolates
  position/speed/heading at any instant. This is what makes 4 Hz data accurate.

- **Two time axes with gap capping.** Real recordings contain long time gaps
  because the receiver is switched off during breaks (the export also applies a
  1 m distance filter, so a stationary receiver adds almost no points). Each
  point keeps its real time `t` and a play-time `pt` where every inter-point gap
  is capped at `DEFAULT_MAX_GAP` (20 s). Playback, the scrubber, and the speed
  chart run on `pt`, so a break becomes a ~20 s hold instead of freezing the
  replay for hours; the telemetry clock shows the real `t`, which jumps forward
  across a break. On a sample 340 km ride this collapsed ~4.3 h of breaks, taking
  playback from 590 min down to 333 min.

- **Single-pass leaf collection when parsing.** Reading each field with its own
  `querySelectorAll` was O(points × fields) and cost ~2 s on a 74 k-point file.
  The parser now walks each track point's subtree once, collecting leaf text by
  local name into a reused object.

- **Trail via `line-gradient`, not growing geometry.** MapLibre has no
  `line-trim-offset` (that is a Mapbox feature). The full route is drawn once,
  with `lineMetrics`, as two layers: a static line whose `line-gradient` colors
  each vertex by speed, and a cover line on top whose `line-gradient` is a step
  over `line-progress`, transparent behind the rider and dim ahead. Advancing
  the trail is a single paint-property update, so no GeoJSON is rebuilt per
  frame. The update is skipped until the reveal would move about one screen
  pixel; a fixed fraction of the line would jump tens of meters on long rides.

- **Reveal position in Mercator space.** `line-progress` measures cumulative
  distance in projected (Mercator) space, not geodesic distance. The map
  precomputes a matching Mercator progress per vertex and projects the rider
  onto the current segment, so the reveal cannot drift from the marker.

- **Rider as a DOM marker, not a symbol layer.** Symbol placement is recomputed
  on a throttle, so a symbol moved every frame renders in visible steps. A
  `maplibregl.Marker` updates its CSS transform on every map move and is
  projected onto the terrain surface.

- **Camera uses `jumpTo` with a low-pass-smoothed center and bearing.** Position
  is already interpolated smoothly by the sampler, so per-frame `easeTo` would
  fight the animation loop. Smoothing makes the chase camera drift gently
  instead of snapping on every squiggle in the track. Zoom is set only on the
  first follow frame after a load, so the user can pull the camera back, which
  also stops it clipping into hills at high pitch. The top padding that keeps
  the rider low in the frame is 30% of the map height rather than a fixed pixel
  value, which on a landscape phone put the rider under the controls.

- **Overlays in one flex column.** The notice, telemetry, panels and controls
  are laid out in a single column above the map, and the panels row takes the
  remaining height. Absolutely positioned panels with fixed offsets overlapped
  on phone screens (a `100vh - 320px` max-height went negative in landscape).

- **Collapsible panels via `<details>`.** Charts and legend collapse to a small
  button using the native element (the same one MapLibre uses for its compact
  attribution), which brings keyboard and accessibility handling for free. They
  start open on large screens and collapsed on phones. The charts follow their
  container's width through a `ResizeObserver`: they are built when the panel
  first has a width (a closed panel has none) and resized after that, which
  replaced separate rebuild triggers for load, window resize and opening.

- **Attribution under the navigation control.** The playback controls span the
  bottom edge, so the attribution moved from its default bottom-right corner to
  the top-right, below the zoom and compass buttons.

- **Chart cursor as a DOM overlay.** The playback cursor is a positioned line
  over each uPlot plot, moved with a CSS transform. Redrawing the canvas every
  frame would re-stroke tens of thousands of points.

- **Speed histogram covers moving speeds only.** Samples below 5 km/h form a
  large stationary mass near zero that would dwarf the riding-speed spread. The
  axis is capped at the 99th percentile, not the maximum, because a single GPS
  glitch can spike the maximum to thousands of km/h.

- **Recorded track preferred over planned route.** When a file has both, only
  `<trkpt>` points are used; `<rtept>` is a fallback for route-only files, which
  get a warning that speed and timing are synthetic.

- **Namespace-agnostic GPX parsing.** GPX elements live in the GPX default
  namespace, so CSS type selectors like `querySelector("trkpt")` do not match them
  portably. The parser enumerates with the universal selector and derives each
  element's local name from `tagName`, which behaves identically across browsers
  and test DOMs and tolerates arbitrary extension prefixes (gpxtpx, gpxdata, …).

- **No API keys / open tile sources.** Default imagery and terrain come from
  keyless providers so the tool works as a drop-in static page. Tile sources are
  isolated in `src/config.ts` for easy swapping to a vendor style. Two
  alternatives were tried and dropped for the public deployment: MapTiler's
  free tier suspends the map with HTTP 429 once its monthly quota is used up,
  which a pitched 3D replay reaches quickly, and Google's `mt*.google.com`
  tiles are undocumented and not permitted for public use. Google remains in
  `config.ts` as a commented-out option for local builds.

## Core features

- Drag-and-drop or file-picker GPX upload with error reporting, plus a
  dismissible notice for route-only files and files without timestamps.
- 3D terrain map with satellite imagery.
- Moving rider marker (heading-aligned); the ridden trail is colored by speed,
  the route ahead is drawn dim. A legend shows the speed color scale.
- Slow-follow chase camera (toggleable, keeps the user's zoom) and a "fit route"
  control.
- Telemetry panel: current speed, altitude, distance, elapsed/total time, plus
  HR and power when present in the file.
- Charts: altitude-over-distance and speed-over-time with a synced playback
  cursor, and a moving-speed distribution histogram.
- Transport controls: play/pause, timeline scrubber, 1x/2x/4x/8x speed.
- Keyboard: Space plays/pauses, Left/Right seek 5 s, Up/Down zoom the map.
- Charts and legend panels collapse to buttons.
- Phone layout (portrait and landscape): compact telemetry row, charts and
  legend collapsed by default, controls wrapping onto a second row.
