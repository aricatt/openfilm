#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft still <video> <second> <out.jpg>`: one frame of a video as a JPEG — the freeze-frame
 * workflow's first step. The frame drawn out, then placed in the film as an image clip:
 *
 *   openfilm craft still narration.mp4 12.4 assets/freeze.jpg
 *   openfilm craft edit '{"op":"insert","track":"v1","src":"assets/freeze.jpg","at":12.4,"len":2}'
 *
 * The file's last moment is after its last frame starts: the frame showing then (the last one before
 * it) is what you get, never a failure.
 *
 * Exit status: 0 written, 1 the frame could not be read, 2 a wrong command.
 */
import { existsSync } from 'node:fs';
import { stillFrame } from '../src/still.mjs';

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h') || words.length < 3) {
  console.log(`openfilm craft still <video> <second> <out.jpg> [--long 1920]

  One frame of the video at that second as a JPEG. Freeze-frame workflow:
  draw the frame out, then place it as an image clip (craft edit insert).`);
  process.exit(words.includes('--help') || words.includes('-h') ? 0 : 2);
}
const [file, second, out] = words.filter((w) => !w.startsWith('--'));
if (!existsSync(file)) { console.error(`✗ ${file}: no such file`); process.exit(2); }
const longAt = words.indexOf('--long');
const long = longAt >= 0 ? Number(words[longAt + 1]) || 1920 : 1920;
try {
  const bytes = await stillFrame(file, Number(second), { long, out });
  console.log(`✓ ${out} — the frame at ${Number(second).toFixed(3)} s (${(bytes.length / 1024).toFixed(0)} KB)`);
} catch (e) {
  console.error(`✗ ${/** @type {Error} */ (e).message}`);
  process.exit(1);
}
