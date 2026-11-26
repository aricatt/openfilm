// @ts-check
/**
 * craft check's frames: a rendered video read small and grey, CHECK_FPS a second — what the motion reading is
 * measured on. ffmpeg does the reading; nothing but the frames comes back.
 */
import { execFile } from 'node:child_process';
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
