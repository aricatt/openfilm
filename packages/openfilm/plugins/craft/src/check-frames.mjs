// @ts-check
/**
 * craft check's frames: a rendered video read small and grey, CHECK_FPS a second — what the motion reading is
 * measured on. ffmpeg does the reading; nothing but the frames comes back.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECK_FPS, GREY_LONG } from './check-motion.mjs';

const run = (/** @type {string[]} */ args) => new Promise((resolve, reject) => {
  execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 1024, windowsHide: true, encoding: 'buffer' }, (err, stdout, stderr) => {
    if (err) reject(new Error(`ffmpeg: ${stderr?.toString().slice(-300) || err.message}`));
    else resolve(stdout);
  });
});

/**
 * The video's frames, small and grey, `fps` a second (frame i is the video at i / fps). The long side GREY_LONG px,
 * the short one as the picture's shape says, both even.
 * @param {string} file @param {{ fps?: number, long?: number }} [o]
 * @returns {Promise<{ w: number, h: number, fps: number, frames: Uint8Array[], duration: number }>}
 */
export async function greyFrames(file, { fps = CHECK_FPS, long = GREY_LONG } = {}) {
  /* the shape first, for the scale's other side */
  const probe = await new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { windowsHide: true }, (err, stdout) => {
      if (err) reject(new Error(`ffprobe: ${err.message}`));
      else resolve(stdout.toString());
    });
  });
  const info = JSON.parse(/** @type {string} */ (probe));
  const sw = info.streams?.[0]?.width, sh = info.streams?.[0]?.height;
  if (!(sw > 0 && sh > 0)) throw new Error(`${file}: no video stream`);
  const duration = Number(info.format?.duration ?? 0);
  const wide = sw >= sh;
  const w = wide ? long : Math.max(2, 2 * Math.round((long * sw) / sh / 2));
  const h = wide ? Math.max(2, 2 * Math.round((long * sh) / sw / 2)) : long;
  const raw = await run(['-v', 'error', '-nostdin', '-i', file, '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-']);
  const size = w * h;
  const count = Math.floor(raw.length / size);
  if (!count) throw new Error(`${file}: no frames read`);
  const frames = [];
  for (let i = 0; i < count; i++) frames.push(new Uint8Array(raw.buffer, raw.byteOffset + i * size, size));
  return { w, h, fps, frames, duration };
}

/**
 * Colour frames for the vision read: one a second, JPEG at most `long` px on the long side, written into a
 * temp dir and read back as bytes with their seconds. Fewer bytes than PNG, sharp enough for text at 768.
 * @param {string} file @param {{ fps?: number, long?: number, signal?: AbortSignal }} [o]
 * @returns {Promise<{ t: number, jpg: Buffer }[]>}
 */
export async function visionFrames(file, { fps = 1, long = 768, signal } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-vis-'));
  try {
    await new Promise((ok, no) => {
      execFile('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `fps=${fps},scale='if(gt(iw,ih),min(${long},iw),-2)':'if(gt(iw,ih),-2,min(${long},ih))'`, '-q:v', '4', join(dir, 'f%04d.jpg')],
        { timeout: 120_000, signal }, (e) => e ? no(e) : ok());
    });
    const out = [];
    for (const f of readdirSync(dir).sort()) {
      const n = /^f(\d+)\.jpg$/.exec(f);
      if (!n) continue;
      out.push({ t: (Number(n[1]) - 1) / fps, jpg: readFileSync(join(dir, f)) });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
