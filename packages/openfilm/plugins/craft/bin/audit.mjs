#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft audit`: other people's privacy found in a video and covered.
 *
 *   openfilm craft audit in.mp4 out.mp4 [--own 名字,品牌] [--size 24]   scan, cover, write
 *   openfilm craft audit in.mp4 --report                               scan, say what was found
 *
 * Frames read one a second by the configured model: every text with its place. The rules say
 * whose names they are — @names, nicknames before a colon, names cut off with an ellipsis —
 * and the ones that are not yours (--own, or nothing is yours) are pixelated away through the
 * mosaic. Faces are not covered yet: that half of ADu's audit is macOS Vision, a redesign here.
 *
 * Cost: one model call per second of video. Try a short clip first.
 * Exit status: 0 done, 1 a failure, 2 a wrong command.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { llmConfig } from '../src/llm.mjs';
import { seeImage } from '../src/llm.mjs';
import { visionFrames } from '../src/check-frames.mjs';
import { AUDIT_ASK, coversOf, readAuditAnswer } from '../src/audit.mjs';
import { mosaicGraph } from '../src/mosaic.mjs';

function fail(what, code = 1) {
  console.error(`✗ ${what}`);
  process.exit(code);
}

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h') || !words.length) {
  console.log(`openfilm craft audit — other people's privacy found in a video and covered

  craft audit in.mp4 out.mp4 [--own 名字,品牌]   scan one frame a second, cover what exposes others
  craft audit in.mp4 --report                    scan, say what was found, cover nothing

  cost: one model call per second of video — try a short clip first`);
  process.exit(words.length ? 0 : 2);
}

const files = words.filter((w) => !w.startsWith('--') && !/^\d+$/.test(w) && !w.includes(','));
const input = files[0];
if (!input || !existsSync(input)) fail(`no such input: ${input ?? '(none)'}`, 2);
const reportOnly = words.includes('--report');
const output = reportOnly ? null : files[1];
if (!reportOnly && !output) fail('no output given (or --report to only scan)', 2);

const ownAt = words.indexOf('--own');
const own = ownAt >= 0 && words[ownAt + 1] ? words[ownAt + 1].split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
const sizeAt = words.indexOf('--size');
const size = sizeAt >= 0 ? Number(words[sizeAt + 1]) : 24;

const config = llmConfig();
if (!config) fail('the audit reads frames with the model: `openfilm craft llm-config` first', 2);

console.log(`scanning ${input}, one frame a second…`);
const frames = await visionFrames(input);
const findings = [];
const boxes = [];
let read = 0;
for (const f of frames) {
  let blocks = null;
  try {
    const answer = await seeImage(config, f.jpg, AUDIT_ASK, { maxTokens: 2500 });
    blocks = readAuditAnswer(answer);
  } catch { /* a frame the model does not answer is skipped, the audit says */ }
  if (!blocks) continue;
  read++;
  const covers = coversOf(blocks, own);
  for (const c of covers) {
    findings.push({ t: f.t, name: c.name, kind: c.kind });
    boxes.push({ x: c.x, y: c.y, w: c.w, h: c.h, from: Math.max(0, f.t - 0.5), to: f.t + 0.5 });
  }
}

console.log(`${read}/${frames.length} frames read, ${findings.length} exposures:`);
for (const f of findings) console.log(`  ${f.t.toFixed(0)}s  ${f.kind}  ${f.name}`);

if (reportOnly) {
  console.log(JSON.stringify({ frames: frames.length, read, findings }, null, 2));
  process.exit(0);
}
if (!boxes.length) {
  console.log('nothing to cover — the input copies through');
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', input, '-c', 'copy', output], { encoding: 'utf8' });
  process.exit(r.status === 0 ? 0 : 1);
}

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input], { encoding: 'utf8' });
const [width, height] = probe.stdout.trim().split(',').map(Number);
const graph = mosaicGraph(boxes, { width, height }, { size });
console.log(`covering ${boxes.length} box-seconds…`);
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', input,
  '-filter_complex', graph,
  '-map', '[vout]', '-map', '0:a?', '-c:a', 'copy', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output],
  { encoding: 'utf8', timeout: 600_000 });
if (r.status !== 0) fail(`ffmpeg: ${(r.stderr ?? '').slice(0, 300)}`);
console.log(`✓ ${output} — ${findings.length} exposures covered`);
