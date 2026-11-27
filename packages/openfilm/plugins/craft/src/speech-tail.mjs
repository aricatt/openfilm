// @ts-check
/**
 * Where a line really stops talking (ADu's adudir-speech-tail, re-implemented): a word-time
 * estimate ends the last word early on a drawn-out syllable, so the line's end listens to the
 * sound itself — in 10 ms windows, the last loud one before a hold of quiet. Decoded by ffmpeg
 * to 16 kHz mono, any file read the same.
 */
import { spawn } from 'node:child_process';

export const TAIL_AFTER_WORD = 0.14;
export const TAIL_AFTER_SOUND = 0.06;
const RATE = 16000;

/** The file's sound as 16 kHz mono samples (-1…1), or null when ffmpeg cannot read it. @param {string} file */
export function monoSamples(file) {
  return new Promise((done) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { windowsHide: true });
    /** @type {Buffer[]} */
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', () => done(null));
    p.on('close', (code) => {
      if (code !== 0) return done(null);
      const b = Buffer.concat(chunks);
      const out = new Float32Array(Math.floor(b.length / 2));
      for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(i * 2) / 32768;
      done(out);
    });
  });
}

/**
 * Where speech ends in `samples`, scanning from `from` seconds: the end of the last loud 10 ms window
 * before `hold` seconds of quiet; `from` itself when nothing after it is loud.
 * @param {Float32Array} samples @param {number} from @param {{ rate?: number, loud?: number, quiet?: number, hold?: number }} [o]
 */
export function speechEndIn(samples, from, { rate = RATE, loud = -42, quiet = -48, hold = 0.15 } = {}) {
  const win = Math.round(rate * 0.01), dur = samples.length / rate;
  const db = (/** @type {number} */ s) => {
    const a = Math.floor(s * rate);
    let acc = 0, k = 0;
    for (let i = a; i < Math.min(samples.length, a + win); i++, k++) acc += samples[i] * samples[i];
    return 20 * Math.log10(Math.sqrt(acc / Math.max(1, k)) + 1e-9);
  };
  let last = Math.max(0, from), q = 0;
  for (let s = Math.max(0, from); s < dur; s += 0.01) {
    const d = db(s);
    if (d > loud) { last = s + 0.01; q = 0; } else if (d < quiet) { q += 0.01; if (q >= hold - 1e-9) break; } else q = 0;
  }
  return Math.min(dur, last);
}

/**
 * A line's tail corrected: where its speech really ends and the end to give it, both in seconds;
 * `cutEarly` how much an end at the estimate + 0.14 s would have lost (0 when none).
 * @param {Float32Array} samples @param {number} estimatedEnd the line's end as laid out (seconds)
 * @param {number} scanFrom where listening starts — the line's start, or its last word's end when known
 * @returns {{ speechEnd: number, end: number, cutEarly: number }}
 */
export function tailCorrected(samples, estimatedEnd, scanFrom) {
  const end0 = speechEndIn(samples, scanFrom);
  const r = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
  const byEstimate = estimatedEnd + TAIL_AFTER_WORD;
  const end = Math.max(byEstimate, end0 + TAIL_AFTER_SOUND);
  return { speechEnd: r(end0), end: r(end), cutEarly: r(Math.max(0, end - byEstimate)) };
}
