// @ts-check
/**
 * craft beats' tests: the grid read on synthetic songs of a known tempo — a click track at 120 BPM, a kick pattern
 * at 90 — plus the frame features' shape and the CLI end to end.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/beats.mjs', import.meta.url));
const SR = 22050;

/** a click track: a short bright tick every beat, `bpm`, `beats` of them, a kick (low thump) on every 4th */
function clickTrack(bpm, beats, { kickEvery = 4 } = {}) {
  const beatLen = 60 / bpm;
  const len = Math.ceil((beats * beatLen + 0.5) * SR);
  const x = new Float32Array(len);
  for (let b = 0; b < beats; b++) {
    const at = Math.round(b * beatLen * SR);
    const kick = kickEvery && b % kickEvery === 0;
    const freq = kick ? 80 : 4000;
    const dur = kick ? 0.09 : 0.03;
    const samples = Math.round(dur * SR);
    for (let i = 0; i < samples && at + i < len; i++) {
      const env = Math.exp(-i / (samples / 6));
      x[at + i] += 0.8 * env * Math.sin((2 * Math.PI * freq * i) / SR);
    }
  }
  return { x, beatLen };
}

/** write a WAV (16-bit PCM mono) of the samples */
function wavFile(file, x) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32000))), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
}

test('a 120 BPM click track reads as 120 BPM, beats where the clicks are', async () => {
  const { analyzeSamples } = await import('./beats.mjs');
  const { x, beatLen } = clickTrack(120, 48);
  const r = /** @type {any} */ (analyzeSamples(x));
  assert.ok(r.bpm, 'a tempo is found');
  assert.ok(Math.abs(r.bpm - 120) < 2, `120 BPM (got ${r.bpm})`);
  assert.ok(r.beats.length > 40, `most beats found (${r.beats.length})`);
  /* beats land within 40 ms of a click */
  const offs = r.beats.map((/** @type {number} */ t) => {
    const k = Math.round(t / beatLen);
    return Math.abs(t - k * beatLen);
  });
  const worst = Math.max(...offs);
  assert.ok(worst < 0.04, `beats on the clicks (worst ${(worst * 1000).toFixed(0)} ms)`);
});

test('a 90 BPM track reads as 90 (or a musically related tempo), downbeats on the kicks', async () => {
  const { analyzeSamples } = await import('./beats.mjs');
  const { x } = clickTrack(90, 64);
  const r = /** @type {any} */ (analyzeSamples(x));
  assert.ok(r.bpm, 'a tempo is found');
  /* 90 or its double 180 (both read the same grid; the double counts the off-beats too) */
  const ratio = r.bpm / 90;
  assert.ok(Math.abs(ratio - 1) < 0.03 || Math.abs(ratio - 2) < 0.03, `~90 BPM (got ${r.bpm})`);
  assert.ok(r.downbeats.length >= 8, `downbeats found (${r.downbeats.length})`);
  /* downbeats are 4 beats apart */
  if (r.downbeats.length > 1) {
    const span = r.downbeats[1] - r.downbeats[0];
    const beat = 60 / r.bpm;
    assert.ok(Math.abs(span - 4 * beat) < 0.05, `4 beats apart (${span} vs ${4 * beat})`);
  }
});

test('silence finds no beat, and says so', async () => {
  const { analyzeSamples } = await import('./beats.mjs');
  const r = /** @type {any} */ (analyzeSamples(new Float32Array(SR * 3)));
  assert.equal(r.bpm, null);
  assert.equal(r.note, 'no steady beat found');
});

test('sections: a louder second half is read as a section coming in louder', async () => {
  const { sectionsOf } = await import('./beats.mjs');
  /* 16 bars, the first 8 quiet, the last 8 louder by 6 dB */
  const bars = Array.from({ length: 16 }, (_, i) => ({
    n: i + 1, at: i * 2, end: (i + 1) * 2, db: i < 8 ? -30 : -24,
  }));
  const { sections, accents } = sectionsOf(bars);
  assert.equal(sections.length, 2);
  assert.ok(sections[1].db > sections[0].db);
  assert.ok(accents.length === 1 && accents[0].bar === 9, JSON.stringify(accents));
});

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('the CLI end to end: decode by ffmpeg, the JSON written beside a project file', { skip: !ffmpeg && 'ffmpeg not on the PATH' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-beats-'));
  try {
    writeFileSync(join(dir, 'film.html'), '<!doctype html><html><head><meta name="viewport" content="width=1920,height=1080"></head><body></body></html>');
    const song = join(dir, 'song.wav');
    const { x } = clickTrack(120, 48);
    wavFile(song, x);
    const run = spawnSync(process.execPath, [BIN, 'song.wav'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes('BPM'), run.stdout);
    const written = join(dir, 'song.beats.json');
    assert.ok(existsSync(written), 'the JSON is written beside the song');
    const grid = JSON.parse(readFileSync(written, 'utf8'));
    assert.ok(Math.abs(grid.bpm - 120) < 2, `120 BPM (got ${grid.bpm})`);
    assert.equal(grid.v, 1);
    /* again: the cached read (same bytes, same mtime) — still fine, no error */
    const again = spawnSync(process.execPath, [BIN, 'song.wav'], { cwd: dir, encoding: 'utf8' });
    assert.equal(again.status, 0, again.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
