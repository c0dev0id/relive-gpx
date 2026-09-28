import { indexAtTime, sampleAtTime, haversine, type TrackPoint } from "../src/gpx.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

// Build a tiny 4-point track, 1s apart, moving east.
const pts: TrackPoint[] = [0, 1, 2, 3].map((i) => ({
  lat: 46.5,
  lon: 6.6 + i * 0.001,
  ele: 600 + i * 10,
  time: i * 1000,
  t: i,
  dist: i * 76.5, // ~76m per 0.001 lon at this latitude
  speed: 10,
  heading: 90,
  hr: null,
  cad: null,
  power: null,
  temp: null,
}));

assert(indexAtTime(pts, -5) === 0, "clamps below start");
assert(indexAtTime(pts, 100) === 3, "clamps above end");
assert(indexAtTime(pts, 1.9) === 1, "finds preceding index");
assert(indexAtTime(pts, 2) === 2, "exact match lands on point");

const mid = sampleAtTime(pts, 0.5);
assert(Math.abs(mid.lon - (6.6 + 0.0005)) < 1e-9, "lon interpolates halfway");
assert(Math.abs(mid.ele! - 605) < 1e-9, "ele interpolates halfway");
assert(mid.index === 0, "sample index is the preceding point");

const end = sampleAtTime(pts, 3);
assert(end.index === 3 && Math.abs(end.lon - 6.603) < 1e-9, "end sample exact");

const d = haversine(46.5, 6.6, 46.5, 6.601);
assert(d > 70 && d < 82, `haversine ~76m, got ${d.toFixed(1)}`);

console.log("\nAll sampler checks passed.");
