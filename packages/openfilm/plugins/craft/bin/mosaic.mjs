#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft mosaic`: boxes of a video pixelated away.
 *
 *   openfilm craft mosaic in.mp4 out.mp4 --box x,y,w,h [--box …] [--size 24]
 *
 * A box is 0–1 of the picture from its top left, a time window after `@`: `--box 0.4,0.1,0.2,0.3@2-5`
 * pixelates that rectangle between 2 s and 5 s only. Several boxes cover several things, each its
 * own window. Reads and writes the video with ffmpeg — sound passes through untouched.
 *
 * Exit status: 0 written, 1 ffmpeg failed, 2 a wrong command.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mosaicGraph, parseBoxes } from '../src/mosaic.mjs';

const HELP = `openfilm craft mosaic — boxes of a video pixelated away

  craft mosaic in.mp4 out.mp4 --box x,y,w,h [--box …] [--size 24]

  x,y,w,h     0–1 of the picture from its top left
  @from-to    optional time window in seconds (--box 0.4,0.1,0.2,0.3@2-5)
  --size      mosaic block in pixels, bigger covers heavier (24)
`;

function fail(what, code = 1) {
  console.error(`✗ ${what}`);
  process.exit(code);
}

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h') || words.length < 2) {
  console.log(HELP);
  process.exit(words.length ? 0 : 2);
}

const [input, output] = words.filter((w) => !w.startsWith('--'));
if (!input || !existsSync(input)) fail(`no such input: ${input ?? '(none)'}`, 2);
if (!output) fail('no output given', 2);

const sizeAt = words.indexOf('--size');
const size = sizeAt >= 0 ? Number(words[sizeAt + 1]) : 24;
if (!Number.isFinite(size) || size < 4) fail('--size: a number of pixels, 4 at least', 2);

const boxWords = [];
words.forEach((w, i) => { if (w === '--box' && words[i + 1]) boxWords.push(words[i + 1]); });
if (!boxWords.length) fail('nothing to cover — at least one --box x,y,w,h', 2);

let boxes;
try {
  boxes = parseBoxes(boxWords);
} catch (e) {
  fail(/** @type {Error} */ (e).message, 2);
}

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input], { encoding: 'utf8' });
const [width, height] = probe.stdout.trim().split(',').map(Number);
if (!width || !height) fail(`ffprobe reads no video size of ${input}`);

const graph = mosaicGraph(boxes, { width, height }, { size });
console.log(`covering ${boxes.length} box${boxes.length > 1 ? 'es' : ''} of ${width}×${height}…`);
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', input,
  '-filter_complex', graph,
  '-map', '[vout]', '-map', '0:a?', '-c:a', 'copy', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output],
  { encoding: 'utf8', timeout: 600_000 });
if (r.status !== 0) fail(`ffmpeg: ${(r.stderr ?? '').slice(0, 300)}`);
console.log(`✓ ${output}`);
