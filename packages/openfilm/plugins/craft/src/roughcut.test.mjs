import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roughCutNarrations, srcWindow, tempoChain } from './roughcut.mjs';

const clip = (id, src, at, extra = {}) => ({ id, src, at, ...extra });
const film = (clips) => ({ tracks: [{ clips }] });

test('pieces of one file end to end read as a narration', () => {
  const n = roughCutNarrations(film([
    clip('a', 'assets/vo.mp4', 0, { time: [0, 3] }),
    clip('b', 'assets/vo.mp4', 3, { time: [5, 8] }),
    clip('m', 'assets/music.m4a', 0),
  ]));
  assert.equal(n.length, 1);
  assert.equal(n[0].pieces.length, 2);
  assert.deepEqual(n[0].pieces[0], { from: 0, to: 3, speed: 1 });
  assert.deepEqual(n[0].clipIds, ['a', 'b']);
});

test('a whole-file clip or a lone piece is not a rough cut', () => {
  assert.equal(roughCutNarrations(film([clip('a', 'assets/vo.mp4', 0, { time: [0, 3] })])).length, 0);
  assert.equal(roughCutNarrations(film([clip('a', 'assets/vo.mp4', 0)])).length, 0);
});

test('overlap in the file or a timeline gap is not a rough cut', () => {
  /* the second piece reads the file backwards: not one take in order */
  assert.equal(roughCutNarrations(film([
    clip('a', 'assets/vo.mp4', 0, { time: [0, 5] }),
    clip('b', 'assets/vo.mp4', 5, { time: [4, 8] }),
  ])).length, 0);
  /* a gap on the timeline: not end to end */
  assert.equal(roughCutNarrations(film([
    clip('a', 'assets/vo.mp4', 0, { time: [0, 3] }),
    clip('b', 'assets/vo.mp4', 5, { time: [5, 8] }),
  ])).length, 0);
});

test('speed pieces keep their speed', () => {
  const n = roughCutNarrations(film([
    clip('a', 'assets/vo.mp4', 0, { time: [0, 4], speed: 2 }),
    clip('b', 'assets/vo.mp4', 2, { time: [4, 8] }),
  ]));
  assert.equal(n.length, 1);
  assert.equal(n[0].pieces[0].speed, 2);
});

test('srcWindow reads the fragment', () => {
  assert.deepEqual(srcWindow('assets/vo.mp4#t=2,10'), { file: 'assets/vo.mp4', from: 2, to: 10 });
  assert.equal(srcWindow('assets/vo.mp4'), null);
});

test('tempoChain chains atempo within ffmpeg limits', () => {
  assert.equal(tempoChain(1), '');
  assert.equal(tempoChain(1.5), 'atempo=1.5');
  assert.equal(tempoChain(4), 'atempo=2,atempo=2');
  assert.equal(tempoChain(0.25), 'atempo=0.5,atempo=0.5');
});
