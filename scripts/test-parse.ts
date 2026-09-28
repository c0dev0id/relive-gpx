import { readFileSync } from "node:fs";
import { DOMParser } from "linkedom";
import { parseGpx } from "../src/gpx.ts";

// Provide a DOMParser for the Node test environment.
(globalThis as any).DOMParser = DOMParser;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

const xml = readFileSync(new URL("../examples/sample-4hz.gpx", import.meta.url), "utf8");
const track = parseGpx(xml);

assert(track.points.length === 720, `parsed 720 points, got ${track.points.length}`);
assert(track.hasTime, "detected timestamps");
assert(Math.abs(track.duration - 179.75) < 0.5, `duration ~180s, got ${track.duration}`);
assert(track.points[0].t === 0, "first point t=0");
assert(track.points[0].hr === 110 || track.points[0].hr! > 100, `hr parsed, got ${track.points[0].hr}`);
assert(track.totalDist > 0, `distance accumulated, got ${track.totalDist.toFixed(0)}m`);
assert(track.speedMax > 0, `max speed computed, got ${(track.speedMax * 3.6).toFixed(1)} km/h`);
assert(track.eleMax > track.eleMin, "elevation range non-empty");
assert(
  track.bounds[0][0] < track.bounds[1][0] && track.bounds[0][1] < track.bounds[1][1],
  "bounds ordered [min,max]",
);

console.log(
  `\nTrack: ${(track.totalDist / 1000).toFixed(2)} km, ` +
    `${track.duration.toFixed(0)}s, ` +
    `vmax ${(track.speedMax * 3.6).toFixed(1)} km/h, ` +
    `ele ${track.eleMin.toFixed(0)}–${track.eleMax.toFixed(0)}m (+${track.eleGain.toFixed(0)}m)`,
);
console.log("All parser checks passed.");
