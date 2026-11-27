// @ts-check
/**
 * What ducking measures, Node's side: files decoded once, their power per cell of the film, the curve worked out
 * and kept in the project's `.film/craft-duck/` so a render does not measure again what nothing has changed in.
 * The key of what is kept is everything the curve is worked out from: the files' bytes, their placement, the
 * ducking parameters — a file made again, a clip moved, a parameter changed, each makes a new key.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { duckCurve, GRID } from './duck-curve.mjs';

/** The rate power is measured at: speech's shape kept, a fraction of the mix's cost. */
const MEASURE_RATE = 16000;

/** A file's identity for the measures kept of it: its bytes (all of a file up to 32 MB; else its size, first and
 *  last 4 MB), not its path or time, so a copy is the same and a file made again in place is new.
 *  @param {string} file */
export function contentIdentity(file) {
  const st = statSync(file);
  const h = createHash('sha1').update(String(st.size));
  const fd = openSync(file, 'r');
  try {
    const read = (at, n) => {
      const b = Buffer.alloc(n);
      const got = readSync(fd, b, 0, n, at);
      h.update(b.subarray(0, got));
    };
    if (st.size <= 32 << 20) read(0, st.size);
    else { read(0, 4 << 20); read(st.size - (4 << 20), 4 << 20); }
  } finally { closeSync(fd); }
  return h.digest('hex').slice(0, 24);
}

/**
 * A file's sound decoded once at the measure rate, mono: mean-square power per GRID cell of the file's own time.
 * @param {string} file @param {AbortSignal} [signal]
 * @returns {Promise<Float64Array>}
 */
export function measurePower(file, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const p = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(MEASURE_RATE), '-f', 'f32le', '-'], { windowsHide: true, signal });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (b) => chunks.push(b));
    p.stderr.on('data', (b) => { err += b; });
    p.on('error', (e) => reject(new Error(`ffmpeg: ${/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT' ? 'not found on the PATH' : e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg could not read ${file} for ducking: ${err.trim().split('\n').pop() ?? code}`));
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 4);
      const x = new Float32Array(buf.buffer, buf.byteOffset, n);
      const per = MEASURE_RATE * GRID;
      const out = new Float64Array(Math.ceil(x.length / per));
      for (let k = 0; k < out.length; k++) {
        let s = 0;
        const a = Math.floor(k * per), z = Math.min(x.length, Math.floor((k + 1) * per));
        for (let i = a; i < z; i++) s += x[i] * x[i];
        out[k] = z > a ? s / (z - a) : 0;
      }
      resolve(out);
    });
  });
}

/**
 * A file's power measured once for everything that asks, kept in `cacheDir` by its bytes: a render again, a look,
 * an export each measures nothing twice.
 * @param {string} file @param {string} cacheDir @param {AbortSignal} [signal]
 */
export async function measurePowerCached(file, cacheDir, signal) {
  const id = contentIdentity(file);
  mkdirSync(cacheDir, { recursive: true });
  const kept = join(cacheDir, `power-${id}.f64`);
  if (existsSync(kept)) {
    try {
      const buf = readFileSync(kept);
      return new Float64Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 8));
    } catch { /* written over while read: measured again */ }
  }
  const power = await measurePower(file, signal);
  writeFileSync(kept, Buffer.from(power.buffer, power.byteOffset, power.length * 8));
  return power;
}

/**
 * Power on the film's time: a clip's measured power (of the region it plays, file time) placed where it plays
 * (`at` film seconds), summed into `into`. The region's cells are of the file's time; heard at `speed`, one of
 * them covers GRID / speed of the film.
 * @param {Float64Array} into @param {Float64Array} measured @param {number} at @param {number} [speed]
 */
export function placePower(into, measured, at, speed = 1) {
  const startCell = at / GRID;
  for (let k = 0; k < measured.length; k++) {
    const cell = Math.round(startCell + k / speed);
    if (cell >= 0 && cell < into.length) into[cell] += measured[k];
  }
  return into;
}

/**
 * The curve of one ducking clip, from cache or worked out now. Kept in `cacheDir` under a key of everything it
 * is worked out from.
 * @param {{ cacheDir: string, keyMaterial: unknown, power: Float64Array, frames: number, params: unknown }} job
 * @returns {Promise<number[]>} the gains, one per GRID cell of the film
 */
export async function curveCached({ cacheDir, keyMaterial, power, frames, params }) {
  const key = createHash('sha1').update(JSON.stringify(keyMaterial)).digest('hex').slice(0, 20);
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${key}.json`);
  if (existsSync(file)) {
    try {
      const kept = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(kept.gains) && kept.gains.length) return kept.gains;
    } catch { /* written over while read: worked out again */ }
  }
  const gains = Array.from(duckCurve(power, frames, params));
  writeFileSync(file, JSON.stringify({ gains }));
  return gains;
}
