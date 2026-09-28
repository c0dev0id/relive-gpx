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

export default function App() {
  const pb = createPlayback();
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [follow, setFollow] = createSignal(true);
  const [dragOver, setDragOver] = createSignal(false);

  let mapContainer!: HTMLDivElement;
  let chartsContainer!: HTMLDivElement;
  let replay: ReplayMap | undefined;
  let charts: Chart[] = [];

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
    setLoading(true);
    try {
      const text = await file.text();
      const track = parseGpx(text);
      if (!track.hasTime)
        setError("No timestamps in file — replaying at a synthetic 1 Hz.");
      pb.load(track);
      replay?.setTrack(track);
      buildCharts(track);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function buildCharts(track: Track) {
    charts.forEach((c) => c.destroy());
    chartsContainer.innerHTML = "";
    // Vertical stack: every chart spans the panel's inner width.
    const each = Math.max(220, chartsContainer.clientWidth - 24);
    const h = 108;
    charts = [
      elevationChart(track, each, h, () => cursor.distKm),
      speedChart(track, each, h, () => cursor.t),
      speedHistogram(track, each, h),
    ];
    for (const c of charts) chartsContainer.appendChild(c.el);
    // Show the cursor immediately after a rebuild (e.g. resize while paused).
    charts[0]?.redraw();
    charts[1]?.redraw();
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

  let resizeTimer = 0;
  onMount(() => {
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const track = pb.track();
        if (track) buildCharts(track);
      }, 150);
    };
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });

  const speeds = [1, 2, 4, 8];

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
            <>
              <div class="telemetry">
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

              <div class="charts" ref={chartsContainer} />

              <div class="controls">
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
                  class="ctrl sm"
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
            </>
          );
        })()}
      </Show>
    </div>
  );
}
