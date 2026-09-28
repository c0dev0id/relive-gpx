// Generates a synthetic 4 Hz GPX ride (a hilly loop) for testing the replay.
import { writeFileSync, mkdirSync } from "node:fs";

const HZ = 4;
const durationSec = 180; // 3 min
const n = durationSec * HZ;
const start = new Date("2026-09-28T08:00:00Z").getTime();

// Center near the Alps for some terrain relief.
const lat0 = 46.5197;
const lon0 = 6.6323;
const R = 0.004; // ~450 m loop radius in degrees latitude

const pts = [];
for (let i = 0; i < n; i++) {
  const t = i / HZ;
  const angle = (t / durationSec) * Math.PI * 2 * 2; // two laps
  const lat = lat0 + R * Math.sin(angle);
  const lon = lon0 + R * Math.cos(angle) * 1.4;
  const ele = 620 + 45 * Math.sin(angle * 1.5) + 8 * Math.sin(angle * 6);
  const time = new Date(start + i * (1000 / HZ)).toISOString();
  const hr = Math.round(135 + 25 * Math.sin(angle * 1.2));
  pts.push({ lat, lon, ele, time, hr });
}

const body = pts
  .map(
    (p) =>
      `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">\n` +
      `      <ele>${p.ele.toFixed(1)}</ele>\n` +
      `      <time>${p.time}</time>\n` +
      `      <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>\n` +
      `    </trkpt>`,
  )
  .join("\n");

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="live-gpx sample"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>Sample 4Hz loop</name>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>
`;

mkdirSync(new URL("../examples", import.meta.url), { recursive: true });
const out = new URL("../examples/sample-4hz.gpx", import.meta.url);
writeFileSync(out, gpx);
console.log(`Wrote ${pts.length} points to examples/sample-4hz.gpx`);
