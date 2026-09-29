# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

live-gpx (repository: relive-gpx) is a static, client-only single-page app that replays a recorded GPX track on a 3D MapLibre map with a chase camera, a speed-colored trail, and uPlot telemetry charts. Stack: Solid.js, MapLibre GL 5, uPlot, Vite 6, strict TypeScript. The rationale for the key design decisions is in `.github/development-journal.md`; update it when one of those decisions changes.

## Commands

```sh
npm ci                        # install
npm run dev                   # Vite dev server; load examples/sample-4hz.gpx to try it
npm run build                 # tsc --noEmit, then vite build -> dist/
npm test                      # runs both test scripts
node scripts/test-parse.ts    # run a single test script
npm run sample                # regenerate examples/sample-4hz.gpx (deterministic)
```

- No linter or formatter is configured. `tsc` runs strict with `noUnusedLocals`/`noUnusedParameters`, so an unused binding fails `npm run build`.
- Tests are plain scripts with a local `assert` helper and no framework; the first failure throws. They rely on Node's built-in TypeScript type stripping, which needs Node >= 22.18.
- CI (`.github/workflows/deploy.yml`) runs only `npm ci && npm run build` on Node 20 for every push to `main`, then deploys `dist/` to GitHub Pages. Tests are not run in CI. `base: "./"` in `vite.config.ts` keeps the bundle independent of the hosting path.

## Architecture

Per-frame data flow:

`parseGpx` (`src/gpx.ts`) → `Track` → `createPlayback` (`src/playback.ts`: `track`/`time`/`playing`/`speed` signals plus the rAF loop) → a single `createEffect` in `src/App.tsx` calls `sampleAtPlayTime(track.points, pb.time())` and pushes the resulting `Sample` to the telemetry panel, `ReplayMap.update()` (`src/map.ts`), and the chart cursors (`src/charts.ts`).

That effect runs on every animation frame during playback, so everything downstream of it must stay cheap: paint-property updates, CSS transforms, O(log n) lookups. No geometry rebuilds or track-sized allocations per frame. All per-point derived values (cumulative distance, speed, heading, both time axes) and the track aggregates are computed once in `parseGpx`.

### Two time axes

Each `TrackPoint` has real time `t` and play-time `pt`. In play-time every inter-point gap is capped at `DEFAULT_MAX_GAP` (20 s), so receiver-off breaks become short holds instead of long freezes.

- Play-time (`pt`, `Track.playDuration`): the playback clock `pb.time()`, the scrubber, arrow-key seeking, the speed chart's x-axis, and `cursor.t` in App.tsx.
- Real time (`t`, `Track.duration`): only the telemetry clock, via `Sample.t`.
- The elevation chart's x-axis is distance in km (`cursor.distKm`).

`Sample.t` is real time while `cursor.t` is play-time. Check which axis a value is on before comparing or plotting it.

### GPX parsing (`src/gpx.ts`)

- Elements are matched by local name (derived from `tagName`) over `querySelectorAll("*")`. CSS type selectors such as `querySelector("trkpt")` do not portably match elements in the GPX default namespace, and linkedom (used by the tests) behaves differently from browsers there.
- `collectLeaves` does one DFS per point and keys leaf text by local name, so extension fields (`hr`, `cad`, `power`/`pwr`, `atemp`/`temp`, `speed`) are found under any namespace prefix. A `speed` value from the file overrides the speed derived from distance and time.
- `<trkpt>` wins; `<rtept>` is used only when there is no track and sets `isRoute`. If any point lacks a timestamp, the whole track gets synthetic 1 Hz timing (`hasTime: false`). App.tsx shows a dismissible notice in both cases.

### Map (`src/map.ts`)

- One GeoJSON source with `lineMetrics: true` feeds two line layers: `route-speed`, a static `line-gradient` coloring each vertex by speed, and `route-cover` on top, whose `line-gradient` is a `step` at the rider's position (transparent behind, `routeAheadColor` ahead). Advancing the trail is one `setPaintProperty`, skipped until the boundary would move about one screen pixel. MapLibre has no `line-trim-offset`; this replaces it.
- `line-progress` is cumulative distance in Mercator space. `ReplayMap` precomputes its own Mercator `cumProgress` and projects the rider onto the current segment. Using the geodesic `TrackPoint.dist` instead makes the reveal drift away from the marker on long tracks.
- `line-gradient` stops must be strictly ascending; the speed gradient is downsampled to about 1024 stops.
- The rider is a DOM `maplibregl.Marker`, not a symbol layer, because symbol placement is throttled and moves in visible steps when updated every frame.
- Follow camera: `jumpTo` with low-pass-filtered center and bearing (`easeTo` would fight the rAF loop). Zoom is set only on the first follow frame after a load (`framedFollow`), so manual zoom sticks.

### Charts (`src/charts.ts`)

uPlot, built imperatively. The playback cursor is a DOM line over the plot area moved by a CSS transform; `Chart.redraw()` only moves that line and never re-strokes the series. App.tsx rebuilds all charts on window resize (debounced). The histogram counts moving speeds only (>= 5 km/h) and caps its axis at the 99th percentile so GPS spikes don't flatten it.

### Config (`src/config.ts`)

Tile sources, terrain exaggeration, `routeAheadColor`, and `speedColorStops`. The stops drive both the trail colors (map.ts) and the speed legend (App.tsx).

Base imagery must stay keyless and permitted for public use, because the app is deployed to GitHub Pages; Esri World Imagery is the default. MapTiler was removed because its free tier returns HTTP 429 once the monthly quota is used up, which a 3D replay reaches quickly. Google `mt*.google.com` tiles are against Google's ToS for public use and stay commented out for local builds. The terrain DEM needs the virtual-hosted S3 URL (`<bucket>.s3.amazonaws.com`); the path-style form no longer serves HTTPS.

## Test constraints

`scripts/test-*.ts` import `src/gpx.ts` directly into Node (type stripping, no bundler), and `test-parse.ts` installs linkedom's `DOMParser` as a global. Code reachable from those imports must:

- Have no relative imports. Node needs the `./format.ts` form, which `tsc` rejects (TS5097) without `allowImportingTsExtensions`. `gpx.ts` currently has no imports; keep it that way or change `tsconfig.json`.
- Use erasable TypeScript only: no `enum`, `namespace`, or constructor parameter properties. Type-only imports need the `type` modifier.
- Use no browser globals other than `DOMParser`.

Only `gpx.ts` has tests; the map, charts, and UI need WebGL and a real DOM and are checked by hand in `npm run dev`. `test-parse.ts` asserts exact values from `examples/sample-4hz.gpx` (720 points, 179.75 s), so changing `scripts/make-sample.mjs` means updating those assertions.
