// @ts-check
/**
 * craft check's tests: the motion reading on synthetic grey frames (deterministic), and the frame reading end to
 * end on ffmpeg-made videos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { motionOf, stepOf, shiftOf, zoomOf, runsOf, burstsOf, staysPut, CHECK_FPS, STILL_STEP } from './check-motion.mjs';

const BIN = fileURLToPath(new URL('../bin/check.mjs', import.meta.url));
const W = 64, H = 64;

/** a grey frame, noise or a bright block at (bx, by) of side s */
const frame = (bx = 0, by = 0, s = 16, base = 100) => {
  const f = new Uint8Array(W * H).fill(base);
  for (let y = by; y < Math.min(H, by + s); y++) for (let x = bx; x < Math.min(W, bx + s); x++) f[y * W + x] = 200;
  return f;
};

/** frames of a still picture (the encoder's noise: ±0–1 levels a step, nothing net) */
const stillFrames = (n) => Array.from({ length: n }, (_, i) => {
  const f = frame(10, 10);
  if (i % 2) f[0] = 101; /* encoder noise, well under STILL_STEP */
  return f;
});

/** frames of the block panning right, px a frame */
const panFrames = (n, px = 2) => Array.from({ length: n }, (_, i) => frame(Math.min(W - 16, i * px), 10));

test('stepOf measures mean grey difference; shiftOf finds the shift; zoomOf the scale', () => {
  const a = frame(10, 10), b = frame(14, 10);
  assert.equal(stepOf(a, a), 0);
  assert.ok(stepOf(a, b) > 1, 'a moved block differs');
  const s = shiftOf(a, b, W, H, undefined, 6);
  assert.equal(s.dx, 4);
  assert.equal(s.dy, 0);
  assert.ok(s.res < 1, `after the shift nearly nothing is left: ${s.res}`);
  /* a zoom: the block grown about the middle — scale reads close to 1 when identical */
  const z = zoomOf(a, a, W, H);
  assert.ok(Math.abs(z.scale - 1) < 0.01, `identical frames: scale near 1 (${z.scale}) — 1 itself is no candidate`);
  assert.ok(z.res < 1, `little left: ${z.res}`);
});

test('runsOf and burstsOf read runs and pushes', () => {
  assert.deepEqual(runsOf([true, true, false, true]), [[0, 2], [3, 4]]);
  assert.equal(burstsOf([0, 1, 2, 1, 0, 0, 0]), 1, 'one ease in and out is one push');
  assert.equal(burstsOf([0, 2, 3, 2, 0, 0, 2, 3, 2, 0]), 2, 'two separated pushes are two');
});

test('a still picture is a hold finding, not a drift', () => {
  const frames = stillFrames(Math.round(5 * CHECK_FPS));
  const { findings, stillShare } = motionOf({ frames, w: W, h: H, fps: CHECK_FPS });
  const hold = findings.find((f) => f.check === 'hold');
  assert.ok(hold, `a hold is found: ${JSON.stringify(findings)}`);
  assert.ok(hold.to - hold.from >= 4, 'spanning the still stretch');
  assert.ok(stillShare > 0.9, `nearly all still: ${stillShare}`);
  assert.ok(!findings.some((f) => f.check === 'move'), 'no move in a still picture');
});

test('a breathing picture (tiny sway) still counts as held', () => {
  /* the block swaying ±1 px — under BREATH_SHIFT of the long side — is a hold, not motion */
  const frames = Array.from({ length: Math.round(4 * CHECK_FPS) }, (_, i) => frame(10 + (i % 2), 10));
  const { findings } = motionOf({ frames, w: W, h: H, fps: CHECK_FPS });
  assert.ok(findings.some((f) => f.check === 'hold'), JSON.stringify(findings));
  assert.ok(!findings.some((f) => f.check === 'move'), 'a sway is not a move');
});

test('a continuous pan is one move that never lands', () => {
  const frames = panFrames(Math.round(4 * CHECK_FPS));
  const { findings } = motionOf({ frames, w: W, h: H, fps: CHECK_FPS });
  const move = findings.find((f) => f.check === 'move');
  assert.ok(move, `a move is found: ${JSON.stringify(findings)}`);
  assert.ok(!findings.some((f) => f.check === 'hold' && f.to - f.from > 3), 'no long hold in a panning picture');
});

test('footage excuses a long move', () => {
  const frames = panFrames(Math.round(4 * CHECK_FPS));
  const { findings } = motionOf({ frames, w: W, h: H, fps: CHECK_FPS, footage: true });
  assert.ok(!findings.some((f) => f.check === 'move'), 'no move finding for footage');
});

test('staysPut: a picture going nowhere passes, a moved one does not', () => {
  const frames = stillFrames(30);
  assert.ok(staysPut(frames, 0, 29, W, H));
  const moved = [...stillFrames(15), frame(40, 10), ...stillFrames(14).map(() => frame(40, 10))];
  assert.ok(!staysPut(moved, 0, 29, W, H), 'the block jumped away: not staying put');
});

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('end to end: a static video reads as held, a moving one does not', { skip: !ffmpeg && 'ffmpeg not on the PATH' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-check-'));
  try {
    const still = join(dir, 'still.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:size=320x240:duration=5:rate=10', '-pix_fmt', 'yuv420p', still]);
    const { greyFrames } = await import('./check-frames.mjs');
    const data = await greyFrames(still);
    assert.ok(data.frames.length >= 45, `frames read: ${data.frames.length}`);
    assert.equal(data.w + data.h > 0, true);
    const result = motionOf({ frames: data.frames.map((f) => new Uint8Array(f)), w: data.w, h: data.h, fps: data.fps });
    assert.ok(result.findings.some((f) => f.check === 'hold'), `static video: hold found (${JSON.stringify(result.findings)})`);

    /* the CLI over the same file */
    const run = spawnSync(process.execPath, [BIN, still], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes('hold'), run.stdout);

    /* a moving video: a crop window panning across a wide testsrc2 — a genuine pan, no rest */
    const moving = join(dir, 'moving.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "testsrc2=size=1280x240:duration=4:rate=10,crop=320:240:x='min(t*200,960)':y=0", '-pix_fmt', 'yuv420p', moving]);
    const data2 = await greyFrames(moving);
    const result2 = motionOf({ frames: data2.frames.map((f) => new Uint8Array(f)), w: data2.w, h: data2.h, fps: data2.fps });
    assert.ok(!result2.findings.some((f) => f.check === 'hold' && f.level === '!'), `moving video: no bad hold (${JSON.stringify(result2.findings)})`);
    assert.ok(result2.stillShare < 0.3, `little still time: ${result2.stillShare}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('encoder noise on a still frame stays under STILL_STEP', { skip: !ffmpeg && 'ffmpeg not on the PATH' }, async () => {
  /* calibration: if the encoder noise ever reads over STILL_STEP the still reading is noise-triggered, not real */
  const dir = mkdtempSync(join(tmpdir(), 'craft-check-cal-'));
  try {
    const still = join(dir, 'still.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:size=320x240:duration=3:rate=10', '-pix_fmt', 'yuv420p', still]);
    const { greyFrames } = await import('./check-frames.mjs');
    const data = await greyFrames(still);
    const steps = [];
    for (let i = 0; i < data.frames.length - 1; i++) steps.push(stepOf(new Uint8Array(data.frames[i]), new Uint8Array(data.frames[i + 1])));
    assert.ok(Math.max(...steps) < STILL_STEP, `encoder noise ${Math.max(...steps).toFixed(3)} under ${STILL_STEP}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
