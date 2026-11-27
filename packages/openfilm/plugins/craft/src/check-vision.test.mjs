// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { denseOf, nonstopOf, readWordsAnswer, DENSE_BOXES } from './check-vision.mjs';

const smallBlocks = (n, seed = 0) => Array.from({ length: n }, (_, i) => ({
  s: `word ${i}`, box: [0.05 + ((i + seed) % 4) * 0.2, 0.05 + Math.floor((i + seed) / 4) * 0.1, 0.15, 0.02], big: false,
}));
const bigTitle = [{ s: 'TITLE', box: [0.3, 0.4, 0.4, 0.08], big: true }];

test('dense: many small blocks for seconds is a finding, big text is not', () => {
  const denseSeconds = [0, 1, 2, 3].map((t) => ({ t, text: smallBlocks(10, t) }));
  const r = denseOf(denseSeconds);
  assert.equal(r.findings.length, 1, JSON.stringify(r.per));
  assert.equal(r.findings[0].check, 'dense');
  assert.equal(r.findings[0].level, '!', 'three seconds or more');
  /* big titles instead: no finding */
  const titles = [0, 1, 2, 3].map((t) => ({ t, text: bigTitle }));
  assert.equal(denseOf(titles).findings.length, 0);
  /* few small blocks: under the count, no finding */
  const sparse = [0, 1, 2].map((t) => ({ t, text: smallBlocks(3, t) }));
  assert.equal(denseOf(sparse).findings.length, 0);
  /* a one-second run is a note at most */
  const one = [0, 1, 2].map((t) => ({ t, text: t === 1 ? smallBlocks(10) : [] }));
  assert.equal(denseOf(one).findings.length, 0, 'a single dense second is not a run');
});

test('nonstop: words that keep moving for seconds, settled words are fine', () => {
  const moving = [0, 1, 2, 3, 4].map((t) => ({
    t, text: [{ s: 'word', box: [0.1 + t * 0.05, 0.5, 0.1, 0.03], big: false }],
  }));
  const r = nonstopOf(moving);
  assert.equal(r.findings.length, 1, 'four seconds of moving');
  assert.equal(r.findings[0].check, 'nonstop');
  /* words that stay: nothing */
  const still = [0, 1, 2, 3, 4].map((t) => ({ t, text: [{ s: 'word', box: [0.1, 0.5, 0.1, 0.3 + 0], big: false }] }));
  still.forEach((x) => { x.text[0].box[3] = 0.03; });
  assert.equal(nonstopOf(still).findings.length, 0, JSON.stringify(nonstopOf(still).findings));
  /* brief movement settles: under the max, no finding */
  const brief = [0, 1, 2, 3, 4, 5, 6].map((t) => ({
    t, text: [{ s: 'word', box: [t < 3 ? 0.1 + t * 0.05 : 0.1, 0.5, 0.1, 0.03], big: false }],
  }));
  assert.equal(nonstopOf(brief).findings.length, 0);
});

test('readWordsAnswer: strict parsing of what the model says', () => {
  assert.deepEqual(readWordsAnswer('{"text":[]}'), []);
  const fenced = readWordsAnswer('```json\n{"text":[{"s":"hi","box":[0.1,0.2,0.3,0.04],"big":true}]}\n```');
  assert.equal(fenced?.length, 1);
  assert.equal(fenced?.[0].big, true);
  assert.equal(readWordsAnswer('no json here'), null);
  assert.equal(readWordsAnswer('{"text":"not array"}'), null);
  /* bad boxes dropped, good kept */
  const mixed = readWordsAnswer('{"text":[{"s":"ok","box":[0.1,0.2,0.3,0.04]},{"s":"bad","box":[0.1,0.2,-1,0.04]},{"s":"bad2","box":"xx"}]}');
  assert.equal(mixed?.length, 1);
  assert.equal(mixed?.[0].s, 'ok');
});
