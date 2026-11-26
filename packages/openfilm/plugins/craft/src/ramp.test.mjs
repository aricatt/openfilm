// @ts-check
/**
 * craft ramp's tests: the curve math (pure) and the render path's mapping — sourceAt with a curved clip, the
 * integral normalized so the whole span is consumed, unevenly shared.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAMP_CURVES, rampPoints, rampSpeed, rampTable, rampShare, rampSourceAt } from './ramp.mjs';
import { sourceAt } from '../../../src/film-doc.mjs';

test('declarations read: presets, custom points; broken ones do not', () => {
  assert.ok(rampPoints('hero'), 'a preset reads');
  assert.ok(rampPoints('[[0,1],[0.5,0.2],[1,1]]'), 'points read');
  assert.equal(rampPoints('nonsense'), null);
  assert.equal(rampPoints('[[0.5,1],[1,1]]'), null, 'must start at u=0');
  assert.equal(rampPoints('[[0,1],[1,-2]]'), null, 'speeds positive');
  assert.equal(rampPoints(''), null);
});

test('the table is normalized: the whole span consumed exactly, ends exact', () => {
  for (const [name, points] of Object.entries(RAMP_CURVES)) {
    const table = rampTable(points.map((p) => [...p]));
    assert.equal(table[0], 0);
    assert.ok(Math.abs(table[table.length - 1] - 1) < 1e-9, `${name}: ends at 1`);
    /* monotonic: source never runs backwards */
    for (let i = 1; i < table.length; i++) assert.ok(table[i] >= table[i - 1], `${name} monotonic at ${i}`);
  }
});

test('montage shares time as shaped: fast ends, slow middle', () => {
  const table = rampTable(RAMP_CURVES.montage.map((p) => [...p]));
  /* the first tenth of film time consumes more source than the middle tenth */
  const early = rampShare(table, 0.1) - rampShare(table, 0);
  const middle = rampShare(table, 0.55) - rampShare(table, 0.45);
  const late = rampShare(table, 1) - rampShare(table, 0.9);
  assert.ok(early > middle * 3, `fast in (${early.toFixed(3)} vs ${middle.toFixed(3)})`);
  assert.ok(late > middle * 3, 'fast out');
  assert.ok(Math.abs(early - late) < 0.02, 'roughly symmetric');
});

test('rampSourceAt: ends at the span ends, the middle slowed for hero', () => {
  const points = /** @type {number[][]} */ (rampPoints('hero'));
  /* span [10, 20), clip 4 film seconds */
  assert.ok(Math.abs(rampSourceAt(points, 0, 4, 10, 20) - 10) < 1e-9, 'starts at from');
  assert.ok(Math.abs(rampSourceAt(points, 4, 4, 10, 20) - 20) < 0.02, 'ends at to');
  /* hero is symmetric: exactly half at the middle; but entering the slow-down it is ahead of linear
     (normalization boosts the fast parts), and inside the dip the source barely advances */
  const mid = rampSourceAt(points, 2, 4, 10, 20);
  assert.ok(Math.abs(mid - 15) < 0.1, `symmetric: half at the middle (${mid})`);
  const entering = rampSourceAt(points, 1.4, 4, 10, 20);
  assert.ok(entering > 13.5, `ahead of linear entering the dip (${entering} > 13.5)`);
  const dipAdvance = rampSourceAt(points, 2.4, 4, 10, 20) - rampSourceAt(points, 1.6, 4, 10, 20);
  assert.ok(dipAdvance < 1.5, `the dip barely advances (${dipAdvance} < 1.5 of 2 linear)`);
});

test('sourceAt in the render path maps a curved clip by the curve, a plain one linearly', () => {
  /* a consistent span: length = (to - from) / speed — 8 film seconds of the 8 source seconds */
  const span = { from: 0, to: 8, speed: 1, length: 8 };
  const curved = { src: 'v.mp4', attrs: { 'data-craft-ramp': 'montage' } };
  /* at a quarter of the film time, montage (3× at the start) is ahead of linear */
  const t = sourceAt(span, 1, curved);
  assert.ok(t > 1.5, `montage ahead of linear at 1s of 8 (${t} vs 1 linear)`);
  /* ends exact */
  assert.ok(Math.abs(sourceAt(span, 8, curved) - 8) < 0.02, 'ends at the span end');
  /* a broken declaration falls back to linear, no crash */
  const broken = { src: 'v.mp4', attrs: { 'data-craft-ramp': 'nonsense' } };
  assert.equal(sourceAt(span, 1, broken), 1);
  /* no declaration: untouched */
  assert.equal(sourceAt(span, 1, { src: 'v.mp4' }), 1);
  /* a constant curve is a null-op by design: normalized, any constant speed consumes the span evenly */
  const custom = { src: 'v.mp4', attrs: { 'data-craft-ramp': '[[0,2],[1,2]]' } };
  assert.ok(Math.abs(sourceAt(span, 1, custom) - 1) < 1e-9, 'constant speed normalizes to linear');
  /* a custom shaped curve reads: fast then slow */
  const shaped = { src: 'v.mp4', attrs: { 'data-craft-ramp': '[[0,4],[0.5,4],[0.75,0.5],[1,0.5]]' } };
  /* normalized: raw share at u=0.125 is 4×0.125/2.6875 ≈ 0.186 of the span — ahead of linear, not of the raw curve */
  const at1 = sourceAt(span, 1, shaped);
  assert.ok(at1 > 1.3 && at1 < 2, `fast start ahead of linear, normalized (${at1})`);
});

test('rampSpeed interpolates the points joined by straight lines', () => {
  const pts = [[0, 1], [0.5, 3], [1, 1]];
  assert.equal(rampSpeed(pts, 0), 1);
  assert.equal(rampSpeed(pts, 0.25), 2);
  assert.equal(rampSpeed(pts, 0.5), 3);
});
