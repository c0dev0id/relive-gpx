import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { createPlayback } from "./playback";
import { parseGpx, sampleAtPlayTime, type Sample, type Track } from "./gpx";
import { ReplayMap } from "./map";
import {
  elevationChart,
  speedChart,
  speedHistogram,
  type Chart,
} from "./charts";
import { fmtDist, fmtSpeed, fmtTime } from "./format";
import { config } from "./config";

// Phone-sized viewports: portrait (narrow) or landscape (short). Must match the
// breakpoints of the compact-layout media queries in styles.css.
const COMPACT_QUERY = "(max-width: 640px), (max-height: 500px)";

const CHART_HEIGHT = 108;

export default function App() {
  const pb = createPlayback();
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [follow, setFollow] = createSignal(true);
  const [dragOver, setDragOver] = createSignal(false);

  let mapContainer!: HTMLDivElement;
  let chartsContainer!: HTMLDivElement;
  let replay: ReplayMap | undefined;
  let charts: Chart[] = [];

  // The charts and legend panels start collapsed on phones, where they would
  // cover most of the map.
  const panelsStartOpen = !window.matchMedia(COMPACT_QUERY).matches;

  // Mutable cursor read by chart plugins each frame (avoids closure churn).
  const cursor = { t: 0, distKm: 0 };
  const [sample, setSample] = createSignal<Sample | null>(null);

  onMount(() => {
    replay = new ReplayMap(mapContainer);
  });

  onCleanup(() => {
    charts.forEach((c) => c.destroy());
    replay?.destroy();
  });

  async function loadFile(file: File) {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const text = await file.text();
      const track = parseGpx(text);
      if (track.isRoute)
        setNotice(
          "This file has no recorded track, only a planned route — speed and timing are synthetic.",
        );
      else if (!track.hasTime)
        setNotice("No timestamps in file — replaying at a synthetic 1 Hz.");
      pb.load(track);
      replay?.setTrack(track);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // The charts follow their container's width: they are built the first time it
  // has one (its panel is open; a collapsed panel has none) and resized when it
  // changes. The work runs outside the observer callback because building
  // changes the container's height, which the observer would otherwise report
  // again within the same frame.
  let chartsWidth = 0;
  let chartsTimer = 0;
  const chartsObserver = new ResizeObserver(([entry]) => {
    const track = pb.track();
    const width = Math.floor(entry.contentRect.width);
    if (!track || width === 0 || width === chartsWidth) return;
    chartsWidth = width;
    const build = charts.length === 0;
    clearTimeout(chartsTimer);
    chartsTimer = window.setTimeout(
      () => {
        if (build) buildCharts(track, width);
        else for (const c of charts) c.resize(width, CHART_HEIGHT);
      },
      build ? 0 : 150, // debounce resizes while the window is being dragged
    );
  });
  onCleanup(() => {
    chartsObserver.disconnect();
    clearTimeout(chartsTimer);
  });

  function buildCharts(track: Track, width: number) {
    // Vertical stack: every chart spans the panel's inner width.
    charts = [
      elevationChart(track, width, CHART_HEIGHT, () => cursor.distKm),
      speedChart(track, width, CHART_HEIGHT, () => cursor.t),
      speedHistogram(track, width, CHART_HEIGHT),
    ];
    for (const c of charts) chartsContainer.appendChild(c.el);
  }

  // Drive the map + telemetry + chart cursors off the playback clock.
  createEffect(() => {
    const track = pb.track();
    if (!track) return;
    const t = pb.time();
    const s = sampleAtPlayTime(track.points, t);
    setSample(s);
    cursor.t = t; // play-time; matches the speed chart's x axis
    cursor.distKm = s.dist / 1000;
    replay?.update(s);
    // Repaint the two cursor charts (cheap: paths are cached).
    charts[0]?.redraw();
    charts[1]?.redraw();
  });

  createEffect(() => {
    if (replay) replay.follow = follow();
  });

  const speeds = [1, 2, 4, 8];
  const SEEK_STEP = 5; // seconds per left/right nudge
  const ZOOM_STEP = 0.5; // zoom levels per up/down nudge

  // Speed legend, derived from the same stops that color the trail so the two
  // can't drift. Positions map each stop's speed across [lo, hi]; the ends
  // carry ≤/≥ because speeds outside the range clamp to the end colors.
  const stops = config.speedColorStops;
  const legendLo = stops[0].kmh;
  const legendHi = stops[stops.length - 1].kmh;
  const legendSpan = legendHi - legendLo || 1;
  const legendPct = (kmh: number) => ((kmh - legendLo) / legendSpan) * 100;
  const legendGradient = `linear-gradient(to right, ${stops
    .map((s) => `${s.color} ${legendPct(s.kmh)}%`)
    .join(", ")})`;

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pb.track()) return;
      // Let focused form controls keep their native key behavior (the scrubber
      // seeks with arrows, buttons activate with space) instead of firing twice.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "SUMMARY"
      )
        return;
      if (e.key === " ") {
        e.preventDefault();
        pb.toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        pb.seek(pb.time() - SEEK_STEP);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        pb.seek(pb.time() + SEEK_STEP);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        replay?.map.setZoom(replay.map.getZoom() + ZOOM_STEP);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        replay?.map.setZoom(replay.map.getZoom() - ZOOM_STEP);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="app">
      <div class="map" ref={mapContainer} />

      <Show when={!pb.track()}>
        <div
          class="dropzone"
          classList={{ over: dragOver() }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer?.files?.[0];
            if (f) loadFile(f);
          }}
        >
          <div class="dropzone-inner">
            <h1>live-gpx</h1>
            <p>Drop a GPX file here, or</p>
            <label class="btn">
              Choose file
              <input
                type="file"
                accept=".gpx,application/gpx+xml,application/xml,text/xml"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) loadFile(f);
                }}
              />
            </label>
            <Show when={loading()}>
              <p class="muted">Parsing…</p>
            </Show>
            <Show when={error()}>
              <p class="err">{error()}</p>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={pb.track() && sample()}>
        {(() => {
          const track = pb.track()!;
          return (
            <div class="hud">
              <Show when={notice()}>
                <div class="notice">
                  <span>{notice()}</span>
                  <button
                    class="notice-close"
                    onClick={() => setNotice("")}
                    title="Dismiss"
                  >
                    ×
                  </button>
                </div>
              </Show>

              <div class="panel telemetry">
                <div class="stat big">
                  <span class="val">{fmtSpeed(sample()!.speed)}</span>
                  <span class="unit">km/h</span>
                </div>
                <div class="stat">
                  <span class="label">Altitude</span>
                  <span class="val">
                    {sample()!.ele != null ? Math.round(sample()!.ele!) : "–"}
                    <span class="unit"> m</span>
                  </span>
                </div>
                <div class="stat">
                  <span class="label">Distance</span>
                  <span class="val">{fmtDist(sample()!.dist)}</span>
                </div>
                <div class="stat">
                  <span class="label">Time</span>
                  <span class="val">
                    {fmtTime(sample()!.t)}{" "}
                    <span class="muted">/ {fmtTime(track.duration)}</span>
                  </span>
                </div>
                <Show when={sample()!.hr != null}>
                  <div class="stat">
                    <span class="label">HR</span>
                    <span class="val">{Math.round(sample()!.hr!)} bpm</span>
                  </div>
                </Show>
                <Show when={sample()!.power != null}>
                  <div class="stat">
                    <span class="label">Power</span>
                    <span class="val">{Math.round(sample()!.power!)} W</span>
                  </div>
                </Show>
              </div>

              <div class="panels">
                <details class="panel charts-panel" open={panelsStartOpen}>
                  <summary>Charts</summary>
                  <div
                    class="charts"
                    ref={(el) => {
                      chartsContainer = el;
                      chartsObserver.observe(el);
                    }}
                  />
                </details>

                <details class="panel legend" open={panelsStartOpen}>
                  <summary>Speed (km/h)</summary>
                  <div class="legend-bar" style={{ background: legendGradient }} />
                  <div class="legend-ticks">
                    {stops.map((s, i) => (
                      <span
                        class="legend-tick"
                        style={{
                          left: `${legendPct(s.kmh)}%`,
                          transform:
                            i === 0
                              ? "translateX(0)"
                              : i === stops.length - 1
                                ? "translateX(-100%)"
                                : "translateX(-50%)",
                        }}
                      >
                        {i === 0
                          ? `≤${s.kmh}`
                          : i === stops.length - 1
                            ? `≥${s.kmh}`
                            : s.kmh}
                      </span>
                    ))}
                  </div>
                </details>
              </div>

              <div class="panel controls">
                <button class="ctrl" onClick={() => pb.toggle()}>
                  {pb.playing() ? "❚❚" : "▶"}
                </button>
                <input
                  class="scrubber"
                  type="range"
                  min={0}
                  max={track.playDuration}
                  step={0.05}
                  value={pb.time()}
                  onInput={(e) => pb.seek(Number(e.currentTarget.value))}
                />
                <div class="speeds">
                  {speeds.map((s) => (
                    <button
                      class="ctrl sm"
                      classList={{ active: pb.speed() === s }}
                      onClick={() => pb.setSpeed(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
                <button
                  class="ctrl sm follow"
                  classList={{ active: follow() }}
                  onClick={() => setFollow((v) => !v)}
                  title="Chase camera follows the rider"
                >
                  Follow
                </button>
                <button
                  class="ctrl sm"
                  onClick={() => replay?.frameToTrack()}
                  title="Frame the whole route"
                >
                  Fit
                </button>
              </div>
            </div>
          );
        })()}
      </Show>
    </div>
  );
}
