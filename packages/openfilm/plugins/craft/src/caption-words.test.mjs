import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInlineWords, writeInlineWords, captionMarksValid, evenCaptionMarks, repairCaptionMarks } from './caption-words.mjs';

test('readInlineWords: stamps out, marks in text order', () => {
  const { plain, marks } = readInlineWords('<00:01.200>你好<00:01.800>世界');
  assert.equal(plain, '你好世界');
  assert.deepEqual(marks, [
    { index: 0, startMs: 1200 },
    { index: 2, startMs: 1800 },
  ]);
});

test('round trip: write then read gives the marks back', () => {
  const marks = [{ index: 0, startMs: 5000 }, { index: 3, startMs: 5400 }];
  const text = writeInlineWords('你好世界呀', marks);
  const back = readInlineWords(text);
  assert.equal(back.plain, '你好世界呀');
  assert.deepEqual(back.marks, marks);
});

test('valid marks pass; out-of-order or past end fail', () => {
  const base = { text: '你好世界', startMs: 1000, endMs: 3000 };
  assert.equal(captionMarksValid({ ...base, marks: [{ index: 0, startMs: 1000 }, { index: 2, startMs: 1500 }] }), true);
  assert.equal(captionMarksValid({ ...base, marks: [{ index: 2, startMs: 1500 }, { index: 0, startMs: 1600 }] }), false);
  assert.equal(captionMarksValid({ ...base, marks: [{ index: 0, startMs: 3100 }] }), false);
});

test('evenCaptionMarks spreads graphemes, strictly increasing', () => {
  const marks = evenCaptionMarks({ text: '你好 世界', startMs: 0, endMs: 2000 });
  assert.equal(marks.length, 4);
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i].startMs > marks[i - 1].startMs);
  assert.equal(marks[0].index, 0);
});

test('repair drops out-of-place, respreads when fewer than two left', () => {
  const cue = { text: '你好世界', startMs: 1000, endMs: 3000, marks: [{ index: 0, startMs: 1000 }, { index: 2, startMs: 900 }, { index: 3, startMs: 1500 }] };
  const r = repairCaptionMarks(cue);
  assert.equal(r.repaired, true);
  assert.deepEqual(r.cue.marks, [{ index: 0, startMs: 1000 }, { index: 3, startMs: 1500 }]);
  /* all bad: even spread */
  const r2 = repairCaptionMarks({ text: '你好世界', startMs: 1000, endMs: 3000, marks: [{ index: 0, startMs: 5000 }] });
  assert.equal(r2.repaired, true);
  assert.ok(r2.cue.marks.length >= 2);
  /* valid untouched */
  const good = { text: '你好', startMs: 0, endMs: 1000, marks: [{ index: 0, startMs: 0 }, { index: 1, startMs: 400 }] };
  assert.equal(repairCaptionMarks(good).repaired, false);
});
