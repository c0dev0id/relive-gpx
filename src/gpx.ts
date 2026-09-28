// GPX parsing + track preprocessing.
// The replay clock is driven by real timestamps, so every point carries a
// cumulative time offset (t) and cumulative distance for O(log n) lookups.

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number | null; // meters
  time: number; // epoch ms
  t: number; // seconds since track start
  dist: number; // cumulative meters
  speed: number; // m/s
  heading: number; // degrees, 0 = north
  hr: number | null;
  cad: number | null;
  power: number | null;
  temp: number | null;
}

export interface Track {
  name: string;
  points: TrackPoint[];
  duration: number; // seconds
  totalDist: number; // meters
  bounds: [[number, number], [number, number]]; // [[minLon,minLat],[maxLon,maxLat]]
  eleMin: number;
  eleMax: number;
  eleGain: number;
  speedMax: number;
  hasTime: boolean;
}

const R = 6371008.8; // mean earth radius, meters

export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function num(v: string | null | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Local (unprefixed) tag name. Derived from tagName rather than el.localName
// so it behaves identically regardless of namespace handling: GPX elements sit
// in the GPX default namespace, so CSS type selectors like "trkpt" don't match
// them portably — the universal selector plus this helper does.
function local(el: Element): string {
  const tag = el.tagName;
  const i = tag.indexOf(":");
  return i >= 0 ? tag.slice(i + 1) : tag;
}

// Reads a descendant's text value by local name, ignoring XML namespaces.
function childValue(parent: Element, localName: string): string | null {
  for (const child of Array.from(parent.querySelectorAll("*"))) {
    if (local(child) === localName) return child.textContent;
  }
  return null;
}

export function parseGpx(xml: string): Track {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("Invalid GPX: " + parseError.textContent);

  const all = Array.from(doc.querySelectorAll("*"));
  const trkpts = all.filter(
    (el) => local(el) === "trkpt" || local(el) === "rtept",
  );
  if (trkpts.length === 0)
    throw new Error("No track points (<trkpt>) found in file.");

  const nameEl = all.find((el) => local(el) === "name");
  const name = nameEl?.textContent?.trim() || "Track";

  interface Raw {
    lat: number;
    lon: number;
    ele: number | null;
    time: number | null;
    hr: number | null;
    cad: number | null;
    power: number | null;
    temp: number | null;
    extSpeed: number | null;
  }

  const raw: Raw[] = [];
  for (const pt of trkpts) {
    const lat = num(pt.getAttribute("lat"));
    const lon = num(pt.getAttribute("lon"));
    if (lat == null || lon == null) continue;
    const timeStr = childValue(pt, "time");
    const time = timeStr ? Date.parse(timeStr) : null;
    raw.push({
      lat,
      lon,
      ele: num(childValue(pt, "ele")),
      time: time != null && Number.isFinite(time) ? time : null,
      hr: num(childValue(pt, "hr")),
      cad: num(childValue(pt, "cad")),
      power: num(childValue(pt, "power")) ?? num(childValue(pt, "pwr")),
      temp: num(childValue(pt, "atemp")) ?? num(childValue(pt, "temp")),
      extSpeed: num(childValue(pt, "speed")),
    });
  }

  const hasTime = raw.every((r) => r.time != null) && raw.length > 1;
  const t0 = hasTime ? (raw[0].time as number) : 0;

  const points: TrackPoint[] = [];
  let dist = 0;
  let eleMin = Infinity;
  let eleMax = -Infinity;
  let eleGain = 0;
  let speedMax = 0;
  let lastEle: number | null = null;

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (i > 0) {
      const p = raw[i - 1];
      dist += haversine(p.lat, p.lon, r.lat, r.lon);
    }
    // Fabricate 1 Hz timing if the file has no timestamps.
    const time = hasTime ? (r.time as number) : t0 + i * 1000;
    const t = (time - t0) / 1000;

    let speed = r.extSpeed ?? 0;
    if (r.extSpeed == null && i > 0) {
      const prev = points[i - 1];
      const dt = t - prev.t;
      if (dt > 0) speed = (dist - prev.dist) / dt;
    }
    if (speed > speedMax) speedMax = speed;

    let heading = points[i - 1]?.heading ?? 0;
    if (i > 0) {
      const p = raw[i - 1];
      if (r.lat !== p.lat || r.lon !== p.lon)
        heading = bearing(p.lat, p.lon, r.lat, r.lon);
    }

    if (r.ele != null) {
      eleMin = Math.min(eleMin, r.ele);
      eleMax = Math.max(eleMax, r.ele);
      if (lastEle != null && r.ele > lastEle) eleGain += r.ele - lastEle;
      lastEle = r.ele;
    }

    points.push({
      lat: r.lat,
      lon: r.lon,
      ele: r.ele,
      time,
      t,
      dist,
      speed,
      heading,
      hr: r.hr,
      cad: r.cad,
      power: r.power,
      temp: r.temp,
    });
  }

  // Fix the first heading to match the second so the initial camera aims right.
  if (points.length > 1) points[0].heading = points[1].heading;

  let minLat = Infinity,
    minLon = Infinity,
    maxLat = -Infinity,
    maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }

  return {
    name,
    points,
    duration: points[points.length - 1].t,
    totalDist: dist,
    bounds: [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    eleMin: eleMin === Infinity ? 0 : eleMin,
    eleMax: eleMax === -Infinity ? 0 : eleMax,
    eleGain,
    speedMax,
    hasTime,
  };
}

// Binary search for the last point at or before time t (seconds).
export function indexAtTime(points: TrackPoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  if (t <= points[0].t) return 0;
  if (t >= points[hi].t) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface Sample {
  lat: number;
  lon: number;
  ele: number | null;
  speed: number;
  heading: number;
  dist: number;
  hr: number | null;
  cad: number | null;
  power: number | null;
  temp: number | null;
  index: number;
}

// Linearly interpolate track state at time t (seconds since start).
export function sampleAtTime(points: TrackPoint[], t: number): Sample {
  const i = indexAtTime(points, t);
  const a = points[i];
  const b = points[i + 1];
  if (!b) {
    return { ...a, index: i };
  }
  const span = b.t - a.t;
  const f = span > 0 ? (t - a.t) / span : 0;
  const lerp = (x: number, y: number) => x + (y - x) * f;
  const heading = a.heading + shortestAngle(a.heading, b.heading) * f;
  return {
    lat: lerp(a.lat, b.lat),
    lon: lerp(a.lon, b.lon),
    ele: a.ele != null && b.ele != null ? lerp(a.ele, b.ele) : a.ele,
    speed: lerp(a.speed, b.speed),
    heading,
    dist: lerp(a.dist, b.dist),
    hr: a.hr,
    cad: a.cad,
    power: a.power,
    temp: a.temp,
    index: i,
  };
}

function shortestAngle(from: number, to: number): number {
  let d = ((to - from + 540) % 360) - 180;
  return d;
}
