import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisionsIn, collisionsOf } from './check-collision.mjs';

test('collisionsIn: overlapping boxes in the band found', () => {
  const blocks = [
    { s: '字幕文字', box: [0.2, 0.85, 0.4, 0.08] },
    { s: '画面自带字', box: [0.3, 0.88, 0.3, 0.06] },
  ];
  const out = collisionsIn(blocks);
  assert.equal(out.length, 1);
  assert.equal(out[0].a, '字幕文字');
});

test('collisionsIn: boxes above the band do not count', () => {
  const blocks = [
    { s: '顶部标题', box: [0.2, 0.1, 0.4, 0.08] },
    { s: '另一行', box: [0.3, 0.12, 0.3, 0.06] },
  ];
  assert.equal(collisionsIn(blocks).length, 0);
});

test('collisionsIn: mere touching is no collision', () => {
  const blocks = [
    { s: '左边的字', box: [0.1, 0.85, 0.2, 0.08] },
    { s: '右边的字', box: [0.32, 0.85, 0.2, 0.08] },
  ];
  assert.equal(collisionsIn(blocks).length, 0);
});

test('collisionsOf: a pair across seconds becomes one finding spanning them', () => {
  const seconds = [1, 2, 3].map((t) => ({
    t,
    text: [
      { s: '字幕', box: [0.2, 0.85, 0.4, 0.08] },
      { s: '画面字', box: [0.3, 0.88, 0.3, 0.06] },
    ],
  }));
  const { findings } = collisionsOf(seconds);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].from, 1);
  assert.equal(findings[0].check, 'collision');
});
