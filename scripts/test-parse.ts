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

assert(
  Math.abs(track.playDuration - track.duration) < 1,
  "no gaps in sample: playDuration ~= duration",
);

console.log(
  `\nTrack: ${(track.totalDist / 1000).toFixed(2)} km, ` +
    `${track.duration.toFixed(0)}s, ` +
    `vmax ${(track.speedMax * 3.6).toFixed(1)} km/h, ` +
    `ele ${track.eleMin.toFixed(0)}–${track.eleMax.toFixed(0)}m (+${track.eleGain.toFixed(0)}m)`,
);

// A recording break: 4 points 1s apart, then a 1000s gap, then 2 more.
const gapGpx = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
<trkpt lat="46.5" lon="6.60"><time>2026-01-01T00:00:00Z</time></trkpt>
<trkpt lat="46.5" lon="6.61"><time>2026-01-01T00:00:01Z</time></trkpt>
<trkpt lat="46.5" lon="6.62"><time>2026-01-01T00:00:02Z</time></trkpt>
<trkpt lat="46.5" lon="6.63"><time>2026-01-01T00:16:42Z</time></trkpt>
<trkpt lat="46.5" lon="6.64"><time>2026-01-01T00:16:43Z</time></trkpt>
</trkseg></trk></gpx>`;
const g = parseGpx(gapGpx, 20);
// Real duration spans the full ~1003s; play-time caps the gap at 20s.
assert(Math.abs(g.duration - 1003) < 1, `gap: real duration ~1003s, got ${g.duration}`);
// dts between the 5 points: 1 + 1 + 1000(capped to 20) + 1 = 23s.
assert(Math.abs(g.playDuration - 23) < 0.001, `gap: play duration = 1+1+20+1 = 23s, got ${g.playDuration}`);
assert(g.points[4].t > 1000 && g.points[4].pt < 30, "gap: last point keeps real time but capped play-time");

console.log("gap capping ok (real 1003s -> play 23s)");
console.log("All parser checks passed.");
