// @ts-check
/**
 * The ducking's tests: the curve's shape (pure), the processor's gain (the sound engine's own harness), and the
 * render path end to end — a voice over a music bed mixed, the music measured down while the voice is up.
 * Run with the rest: `node --test` here or pnpm test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dbGain, duckCurve, duckParams, GRID } from './duck-curve.mjs';
import './duck-processor.mjs';
import { clipChain } from '../../../src/sound-engine.mjs';

const db = (g) => 20 * Math.log10(Math.max(g, 1e-9));

/** a film: voice at -30 dBFS from 2 s to 4 s, quiet elsewhere */
function speechPower(frames) {
  const power = new Float64Array(frames);
  const p = dbGain(-30) ** 2;
  for (let i = Math.round(2 / GRID); i < Math.round(4 / GRID); i++) power[i] = p;
  return power;
}

test('the curve rests at pause inside the window, ducks in speech, holds, releases', () => {
  const frames = Math.round(8 / GRID);
  const curve = duckCurve(speechPower(frames), frames, duckParams(null));
  const at = (t) => db(curve[Math.round(t / GRID)]);
  /* at once at the pause level inside the window, not drifting down through the opening */
  assert.ok(Math.abs(at(0.1) - (-13)) < 0.5, `0.1s: ${at(0.1)}`);
  /* speech pushes toward the speech depth, part-way by the ratio (-30 is 10 dB over -40: 10/12 of the rest of the way) */
  assert.ok(Math.abs(at(2.5) - (-16.3)) < 0.6, `2.5s: ${at(2.5)}`);
  /* just after the voice ends the hold keeps it down */
  assert.ok(at(4.05) < -15, `4.05s: ${at(4.05)}`);
  /* and a second later it is back at the pause level */
  assert.ok(Math.abs(at(5.5) - (-13)) < 1.0, `5.5s: ${at(5.5)}`);
  /* never amplifies */
  assert.ok(Math.max(...curve) <= 1.0001);
});

test('outside the window the gain is full', () => {
  const frames = Math.round(8 / GRID);
  const params = duckParams({ from: 1, to: 7 });
  const curve = duckCurve(speechPower(frames), frames, params);
  assert.ok(db(curve[Math.round(0.5 / GRID)]) > -0.5, `0.5s: ${db(curve[Math.round(0.5 / GRID)])}`);
  assert.ok(db(curve[Math.round(7.5 / GRID)]) > -0.5 || curve[Math.round(7.5 / GRID)] >= curve[Math.round(6.9 / GRID)]);
});

test('parameters are checked', () => {
  assert.throws(() => duckParams({ ratio: 0.5 }), /ratio/);
  assert.throws(() => duckParams({ under: 'voice' }), /under/);
  assert.throws(() => duckParams({ over: [[1, 2]] }), /over/);
  assert.equal(duckParams(null).speech, -17);
});

test('the processor turns the sound by the curve at the film time', () => {
  const gains = new Array(100).fill(1);
  gains[50] = 0.25;
  const chain = clipChain([{ name: 'craft-duck', gains, at: 0 }]);
  assert.ok(chain);
  const n = 480;
  const l = new Float32Array(n).fill(0.8), r = new Float32Array(n).fill(0.8);
  const ol = new Float32Array(n), orr = new Float32Array(n);
  /* frames 0–479 are film times 0–0.01: cell 0, gain 1 */
  chain.process(l, r, ol, orr);
  assert.ok(Math.abs(ol[0] - 0.8) < 1e-6);
  /* a block exactly at cell 50 (0.5 s) is turned by its gain */
  const chain2 = clipChain([{ name: 'craft-duck', gains, at: 0 }]);
  let done = 0;
  while (done < Math.round(0.5 * 48000)) { const b = new Float32Array(128).fill(0.8), o = new Float32Array(128); chain2.process(b, b.slice(), o, new Float32Array(128)); done += 128; }
  const bl = new Float32Array(n).fill(0.8), br = new Float32Array(n).fill(0.8), xl = new Float32Array(n), xr = new Float32Array(n);
  chain2.process(bl, br, xl, xr);
  assert.ok(Math.abs(xl[0] - 0.2) < 0.01, `gain at 0.5s: ${xl[0]} (want 0.8*0.25=0.2)`);
});

test('a clip without its gains is an error, not silence', () => {
  assert.throws(() => clipChain([{ name: 'craft-duck' }]), /gains/);
});

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('the film end to end: music under a voice, mixed, the music measured down while the voice is up', { skip: !ffmpeg && 'ffmpeg not on the PATH' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-duck-'));
  try {
    const voice = join(dir, 'voice.wav'), music = join(dir, 'music.wav'), out = join(dir, 'mix.wav');
    /* the voice: loud from 2 s to 4 s, quiet elsewhere; the music: a low steady tone, apart in frequency */
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,4), 0.5*sin(440*2*PI*t), 0)':s=16000:d=8", voice]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=8,volume=0.8', music]);
    const { attachDuckChains } = await import('./duck-hook.mjs');
    const { mix } = await import('../../../src/shared.mjs');
    const clips = [
      { file: voice, at: 0, from: 0, to: 8, volume: 1, speed: 1, id: 'voice' },
      { file: music, at: 0, from: 0, to: 8, volume: 1, speed: 1, id: 'music', attrs: { 'data-craft-duck': '{}' } },
    ];
    const mixed = await attachDuckChains(clips, { root: dir, from: 0 });
    const bed = mixed.find((c) => c.id === 'music');
    assert.ok(bed.chain?.length, 'the music carries its chain');
    assert.equal(bed.chain[0].name, 'craft-duck');
    const g = bed.chain[0].gains;
    assert.ok(db(g[300]) < db(g[100]) - 1.5, `the curve dips in speech: ${db(g[100])} → ${db(g[300])}`);
    await mix(mixed, 8, out, ['-c:a', 'pcm_f32le']);
    assert.ok(existsSync(out));
    /* the music measured alone (a narrow band about its 220 Hz: the voice, 440 Hz, is 47 dB away) at 1 s and in speech at 3 s */
    const level = (t) => {
      const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(t), '-t', '0.8', '-i', out, '-af', 'bandpass=f=220:w=15,bandpass=f=220:w=15,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
      const m = (r.stderr ?? '').match(/mean_volume:\s*(-?[\d.]+)/);
      return m ? Number(m[1]) : NaN;
    };
    const before = level(1), during = level(3);
    assert.ok(Number.isFinite(before) && Number.isFinite(during), `measured: ${before}, ${during}`);
    assert.ok(during < before - 1.5, `the music ducks in speech: ${before} dB → ${during} dB`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
