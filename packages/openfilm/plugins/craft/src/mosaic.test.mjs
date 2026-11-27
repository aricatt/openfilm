import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mosaicGraph, parseBoxes } from './mosaic.mjs';

test('parseBoxes: geometry and windows', () => {
  assert.deepEqual(parseBoxes(['0.1,0.2,0.3,0.4']), [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]);
  assert.deepEqual(parseBoxes(['0.1,0.2,0.3,0.4@2-5']), [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, from: 2, to: 5 }]);
  assert.throws(() => parseBoxes(['2,0.2,0.3,0.4']), /out of the picture/);
  assert.throws(() => parseBoxes(['0.1,0.2']), /does not read/);
});

test('mosaicGraph: one box one chain, pixels from the picture size', () => {
  const g = mosaicGraph([{ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }], { width: 320, height: 240 });
  assert.ok(g.includes('crop=80:60:160:120'));
  assert.ok(g.includes('pixelize'));
  assert.ok(g.includes('[vout]'));
});

test('mosaicGraph: time window becomes an enable expression', () => {
  const g = mosaicGraph([{ x: 0, y: 0, w: 0.5, h: 0.5, from: 2, to: 5 }], { width: 100, height: 100 });
  assert.ok(g.includes('between(t,2.000,5.000)'));
});

test('mosaicGraph: several boxes chain in order', () => {
  const g = mosaicGraph([{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }], { width: 100, height: 100 });
  assert.ok(g.indexOf('[v0]') < g.indexOf('[vout]'));
});
