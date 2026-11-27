// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendAt, blendsOf, twoPictures } from './check-blend.mjs';

const W = 64, H = 64;

/** both pictures structured everywhere, different patterns — like two real shots */
const textured = () => {
  const picA = new Uint8Array(W * H), picB = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    picA[y * W + x] = 60 + ((x * 7 + y * 3) % 5) * 30;
    picB[y * W + x] = 50 + ((x * 2 + y * 11) % 7) * 22;
  }
  return [picA, picB];
};
const mixOf = (a, b, alpha) => {
  const f = new Uint8Array(W * H);
  for (let p = 0; p < f.length; p++) f[p] = Math.round(alpha * a[p] + (1 - alpha) * b[p]);
  return f;
};

test('a true mix reads as a blend, alpha and fit exact', () => {
  const [a, b] = textured();
  const r = blendAt(a, mixOf(a, b, 0.5), b, W, H);
  assert.equal(r.blend, true, r.why);
  assert.ok(Math.abs(r.alpha - 0.5) < 0.02);
  assert.ok(r.fit < 0.05);
});

test('what is not a blend: one picture, noise, alike frames', () => {
  const [a, b] = textured();
  assert.equal(blendAt(a, a, b, W, H).why, 'one side', 'the frame IS a: alpha at the edge');
  assert.equal(blendAt(a, a, a, W, H).why, 'alike');
  const noise = new Uint8Array(W * H).map((_, i) => (i * 37) % 256);
  const r = blendAt(a, noise, b, W, H);
  assert.equal(r.blend, false, 'noise is no mix');
});

test('a flat fade over a plain page is not two pictures', () => {
  /* title fading in over a plain background: the plain side explains everything */
  const plain = new Uint8Array(W * H).fill(100);
  const titled = new Uint8Array(W * H).fill(100);
  for (let y = 24; y < 40; y++) for (let x = 16; x < 48; x++) titled[y * W + x] = 220;
  const mix = mixOf(plain, titled, 0.5);
  const r = blendAt(plain, mix, titled, W, H);
  assert.equal(r.blend, false, `a simple fade-in is meant, not a blend: ${r.why}`);
});

test('a crossfade sequence flags the middle frames, one finding', () => {
  const [a, b] = textured();
  const frames = [];
  for (let i = 0; i < 20; i++) {
    if (i < 8) frames.push(a);
    else if (i > 12) frames.push(b);
    else frames.push(mixOf(a, b, (12 - i) / 4 * 0 + (i - 7) / 6));
  }
  const out = blendsOf({ frames, w: W, h: H, fps: 10 });
  assert.ok(out.at.length >= 2, `middle frames flagged: ${out.at}`);
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].check, 'blend');
});

test('hard cuts are never blends', () => {
  const [a, b] = textured();
  const frames = [...Array(10).fill(a), ...Array(10).fill(b)];
  const out = blendsOf({ frames, w: W, h: H, fps: 10 });
  assert.equal(out.at.length, 0, 'a hard cut is right, not a blend');
});
