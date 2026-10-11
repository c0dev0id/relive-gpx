# live-gpx

A static, client-only single-page app that replays a recorded GPX track on a 3D
MapLibre map. It follows the rider with a chase camera, draws a speed-colored
trail, and shows uPlot telemetry charts for speed and elevation.

## Stack

Solid.js, MapLibre GL 5, uPlot, Vite 6, strict TypeScript.

## Usage

```sh
npm ci          # install
npm run dev     # start the Vite dev server
npm run build   # type-check and build to dist/
npm test        # run the parser and sampler tests
```

Load a GPX file in the running app to replay it. `examples/sample-4hz.gpx` is a
deterministic sample to try it with.
