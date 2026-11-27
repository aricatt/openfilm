import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linesOf, layLines, vttOf } from './caption-align.mjs';
import { readInlineWords } from './caption-words.mjs';

test('linesOf breaks at sentence punctuation, keeps it attached', () => {
  assert.deepEqual(linesOf('你好世界。这是一段测试！还有一句'), ['你好世界。', '这是一段测试！', '还有一句']);
  assert.deepEqual(linesOf('no punctuation'), ['no punctuation']);
});

test('layLines: proportional shares, in order, covering the sound', () => {
  const lines = ['四个字符。', '八个字符的一行话。'];
  const cues = layLines(lines, [[0, 6]]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 0);
  assert.equal(cues[1].endMs, 6000);
  assert.ok(cues[0].endMs === cues[1].startMs, 'no gap between lines');
  assert.ok(cues[1].endMs - cues[1].startMs > cues[0].endMs - cues[0].startMs, 'longer text gets more time');
});

test('layLines: empty input is empty output', () => {
  assert.deepEqual(layLines([], [[0, 1]]), []);
  assert.deepEqual(layLines(['x'], []), []);
});

test('vttOf writes valid karaoke cues that read back as marks', () => {
  const vtt = vttOf([{ text: '你好世界', startMs: 1000, endMs: 3000 }]);
  assert.ok(vtt.startsWith('WEBVTT'));
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:03.000'));
  const line = vtt.split('\n').find((l) => l.includes('<'));
  const { plain, marks } = readInlineWords(line);
  assert.equal(plain, '你好世界');
  assert.ok(marks.length >= 2);
  assert.equal(marks[0].startMs, 1000);
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i].startMs > marks[i - 1].startMs);
});
