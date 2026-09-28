// Playback clock as a Solid store. Virtual time advances by wall-clock delta
// times the speed multiplier, so refresh rate never affects playback speed.

import { createSignal } from "solid-js";
import type { Track } from "./gpx";

export function createPlayback() {
  const [track, setTrack] = createSignal<Track | null>(null);
  const [time, setTime] = createSignal(0); // seconds into the track
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(1); // 1 | 2 | 4 | 8

  let raf = 0;
  let lastWall = 0;

  function tick(now: number) {
    const trk = track();
    if (!trk || !playing()) return;
    const dt = (now - lastWall) / 1000;
    lastWall = now;
    let next = time() + dt * speed();
    if (next >= trk.playDuration) {
      next = trk.playDuration;
      setTime(next);
      setPlaying(false);
      return;
    }
    setTime(next);
    raf = requestAnimationFrame(tick);
  }

  function play() {
    const trk = track();
    if (!trk) return;
    if (time() >= trk.playDuration) setTime(0);
    if (playing()) return;
    setPlaying(true);
    lastWall = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    setPlaying(false);
    cancelAnimationFrame(raf);
  }

  function toggle() {
    playing() ? pause() : play();
  }

  function seek(t: number) {
    const trk = track();
    if (!trk) return;
    setTime(Math.max(0, Math.min(trk.playDuration, t)));
    lastWall = performance.now();
  }

  function setSpeedMult(s: number) {
    setSpeed(s);
    lastWall = performance.now();
  }

  function load(trk: Track) {
    pause();
    setTrack(trk);
    setTime(0);
    setSpeed(1);
  }

  return {
    track,
    time,
    playing,
    speed,
    load,
    play,
    pause,
    toggle,
    seek,
    setSpeed: setSpeedMult,
  };
}

export type Playback = ReturnType<typeof createPlayback>;
