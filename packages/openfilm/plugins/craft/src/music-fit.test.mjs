import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMusic } from './music-fit.mjs';

const beats = {
  duration: 60,
  bars: Array.from({ length: 20 }, (_, i) => ({ n: i + 1, at: i * 3, end: (i + 1) * 3 })),
  beats: Array.from({ length: 80 }, (_, i) => i * 0.75),
  sections: [{ from: 30, to: 36, level: 'low', bars: [11, 12] }],
};

test('bar landing on a moment plays from earlier', () => {
  /* bar 5 (at 12s in the file) should land on film second 10, the piece cut from film 0:
     play starts at 12 - (10 - 0) = 2 */
  const pieces = planMusic(beats, [{ at: 0, bar: 5, on: 10 }], { end: 15 });
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].from, 2);
  assert.equal(pieces[0].at, 0);
  assert.equal(pieces[0].to, 17);
});

test('bar at the cut plays from the bar itself', () => {
  const pieces = planMusic(beats, [{ at: 5, bar: 3 }], { end: 10 });
  assert.equal(pieces[0].from, 6);
  assert.equal(pieces[0].to, 11);
});

test('quiet picks the low section', () => {
  const pieces = planMusic(beats, [{ at: 0, quiet: true }], { end: 6 });
  assert.equal(pieces[0].from, 30);
  assert.match(pieces[0].said, /quiet/);
});

test('tail ends the music with the film', () => {
  const pieces = planMusic(beats, [{ at: 50, tail: true }], { end: 60 });
  assert.equal(pieces[0].from, 60 - (60 - 50));
  assert.equal(pieces[0].to, 60);
});

test('pieces chain: each ends where the next cuts', () => {
  const pieces = planMusic(beats, [{ at: 0, bar: 1 }, { at: 9, bar: 4 }], { end: 20 });
  assert.equal(pieces[0].to, pieces[0].from + 9);
  assert.equal(pieces[1].to, pieces[1].from + 11);
  assert.equal(pieces[0].fadeOut, 0.08);
  assert.equal(pieces[1].fadeOut, 1.6);
});

test('errors are said plainly', () => {
  assert.throws(() => planMusic(beats, [{ at: 0, bar: 99 }], { end: 10 }), /no bar 99/);
  assert.throws(() => planMusic(beats, [{ at: 0, bar: 1, src: 3 }], { end: 10 }), /one of bar/);
  assert.throws(() => planMusic(beats, [{ at: 5, bar: 1 }, { at: 3, bar: 2 }], { end: 10 }), /not after/);
  assert.throws(() => planMusic(beats, [], { end: 10 }), /at least one/);
});
