// @ts-check
/**
 * Uncovered speech: where the video has sound but no caption covers it. ADu's adudir-uncovered-speech,
 * re-implemented for craft check --lines: ADu compared a clip's sound against its per-word marks; upstream's
 * captions carry no word times, so coverage is cue-level here — a cue covers its whole line. What is found is
 * the same question a person asks of the finished film: talking with no captions over it.
 *
 * Sound is where ffmpeg's silencedetect finds none of silence; a stretch shorter than MIN_GAP_S is a breath,
 * not speech missed.
 */
import { spawnSync } from 'node:child_process';

/** a stretch shorter than this is a breath or a word's tail, not one missed */
export const MIN_GAP_S = 0.3;
/** quieter than this is silence (a talking-head clip's room) */
export const SILENCE_DB = -35;

/**
 * Where there is sound, as ffmpeg finds it: the file's [start, end] stretches between its silences (seconds).
 * @param {string} file @param {number} duration
 * @returns {[number, number][] | null} null when it cannot be read
 */
export function soundStretches(file, duration) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', `silencedetect=noise=${SILENCE_DB}dB:d=0.15`, '-f', 'null', '-'],
    { encoding: 'utf8', timeout: 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) return null;
  const silences = /** @type {[number, number][]} */ ([]);
  let start = null;
  for (const line of String(r.stderr).split('\n')) {
    const s = /silence_start: (-?[\d.]+)/.exec(line), e = /silence_end: ([\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    if (e && start !== null) { silences.push([start, Number(e[1])]); start = null; }
  }
  if (start !== null) silences.push([start, duration]);
  const out = /** @type {[number, number][]} */ ([]);
  let at = 0;
  for (const [a, b] of silences) { if (a > at) out.push([at, a]); at = Math.max(at, b); }
  if (at < duration) out.push([at, duration]);
  return out;
}

/**
 * The stretches the cues cover (seconds): each cue its whole line — upstream's captions carry no word times,
 * a line is the finest cover known. Cues are [startSeconds, endSeconds] pairs.
 * @param {[number, number][]} cues
 * @returns {[number, number][]}
 */
export function cueCover(cues) {
  return cues.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
}

/**
 * Sound no cue covers, MIN_GAP_S or longer (seconds).
 * @param {[number, number][]} sound @param {[number, number][]} cover @returns {[number, number][]}
 */
export function uncovered(sound, cover) {
  const out = /** @type {[number, number][]} */ ([]);
  for (const [a, b] of sound) {
    let at = a;
    for (const [c, d] of cover) {
      if (d <= at || c >= b) continue;
      if (c > at && c - at >= MIN_GAP_S) out.push([at, Math.min(c, b)]);
      at = Math.max(at, d);
      if (at >= b) break;
    }
    if (b - at >= MIN_GAP_S) out.push([at, b]);
  }
  return out;
}
