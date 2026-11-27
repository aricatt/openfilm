// @ts-check
/**
 * One frame of a video file, decoded by ffmpeg (ADu 2.0's still-frame, the extraction half rewritten):
 * that moment of the file, as a JPEG. The freeze-frame workflow's primitive — the frame drawn out,
 * then placed as an image clip (`craft edit` insert).
 *
 * Accurate seek: -ss before -i seeks to the keyframe and decodes on to the exact moment. The file's
 * last moment is after its last frame starts (nothing starts there, ffmpeg writes nothing): the frame
 * showing then is the last one before it — the last frame of the half second up to that moment, the
 * first failure standing when nothing is there either.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const run = (/** @type {string[]} */ args, /** @type {number} */ timeoutMs) => new Promise((ok, no) => {
  execFile('ffmpeg', args, { timeout: timeoutMs, windowsHide: true }, (error) => error ? no(Object.assign(error, { message: `ffmpeg: ${error.message}` })) : ok());
});

/**
 * The frame of `file` at `seconds` of its own, as a JPEG at most `long` px on its long side.
 * @param {string} file @param {number} seconds @param {{ long?: number, out?: string }} [o]
 * @returns {Promise<Buffer>} the JPEG's bytes (written to `out` when given)
 */
export async function stillFrame(file, seconds, { long = 1920, out } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('a still needs seconds, 0 or more');
  const dir = mkdtempSync(join(tmpdir(), 'craft-still-'));
  try {
    const frame = join(dir, 'frame.jpg');
    const scale = ['-an', '-vf', `scale='if(gt(iw,ih),min(${long},iw),-2)':'if(gt(iw,ih),-2,min(${long},ih))'`, '-q:v', '3'];
    const read = () => { try { return readFileSync(frame); } catch { return null; } };
    try {
      await run(['-v', 'error', '-y', '-ss', seconds.toFixed(3), '-i', file, '-frames:v', '1', ...scale, frame], 20_000);
      const bytes = read();
      if (!bytes) throw new Error('nothing written');
      if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, bytes); }
      return bytes;
    } catch (error) {
      if (seconds <= 0) throw error;
      /* the last moment of the file: no frame starts there, but one is showing — the last frame of the
         half second up to it */
      const from = Math.max(0, seconds - 0.5);
      await run(['-v', 'error', '-y', '-ss', from.toFixed(3), '-i', file, '-t', (seconds - from + 0.001).toFixed(3), '-update', '1', ...scale, frame], 20_000)
        .catch(() => { throw error; });
      const bytes = read();
      if (!bytes) throw error;
      if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, bytes); }
      return bytes;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
