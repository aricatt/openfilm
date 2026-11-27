// @ts-check
/**
 * 可读性 checks (ADu's dense/nonstop, rewritten): one frame a second read by the vision model — every text
 * block it shows with its box as shares of the picture. Then deterministic logic, no model:
 *
 *   密字 dense:    many words, few of them big enough to read — a second with DENSE_BOXES or more blocks of
 *                 which the big ones (as tall as BIG_TEXT of the picture's height) cover under
 *                 DENSE_BIG_SHARE of the text area. Seconds on end of it is the finding.
 *   字不停 nonstop: words that never stay put long enough to read — of one second's words, under 70% of
 *                 their area sits where it was the next second, for longer than NONSTOP_MAX.
 *
 * The model is asked for JSON only; what it says is validated hard (boxes in range, numbers finite) — a
 * second it answers badly is simply not read, and a gap splits a run the same as a settled second.
 */
import { runsOf } from './check-motion.mjs';

/** Words big enough to read: a box this tall, as a share of the picture's height (24 px of 1080). */
export const BIG_TEXT = 24 / 1080;
/** A dense second: at least this many word boxes, and the big ones under this share of the text area. */
export const DENSE_BOXES = 8, DENSE_BIG_SHARE = 0.45;
/** Seconds of words on screen that keep moving. */
export const NONSTOP_MAX = 3;

/**
 * 密字.
 * @param {{ t: number, text: { s: string, box: number[] }[] }[]} seconds
 * @returns {{ per: object[], findings: object[] }}
 */
export function denseOf(seconds) {
  const per = seconds.map(({ t, text }) => {
    const boxes = text.filter((x) => x.s?.trim());
    const area = boxes.reduce((s, x) => s + x.box[2] * x.box[3], 0);
    const big = boxes.filter((x) => x.big === true || (x.big !== true && x.big !== false && x.box[3] >= BIG_TEXT)).reduce((s, x) => s + x.box[2] * x.box[3], 0);
    const share = area ? big / area : 1;
    return { t, count: boxes.length, share, dense: boxes.length >= DENSE_BOXES && share < DENSE_BIG_SHARE };
  });
  /** @type {[number, number][]} */
  const runs = [];
  let start = -1;
  per.forEach((x, i) => {
    if (start >= 0 && !(x.dense && x.t - per[i - 1].t <= 1 + 1e-6)) { runs.push([start, i]); start = -1; }
    if (x.dense && start < 0) start = i;
  });
  if (start >= 0) runs.push([start, per.length]);
  /** @type {object[]} */
  const found = [];
  for (const [a, b] of runs) {
    const long = b - a;
    if (long < 2) continue;
    const part = per.slice(a, b), most = Math.max(...part.map((x) => count(x))), share = Math.min(...part.map((x) => x.share));
    found.push({ check: 'dense', level: long >= 3 ? '!' : '~', from: per[a].t, to: per[b - 1].t + 1, said: `${long} 秒里一屏 ${most} 个字块，够大的字（高 ≥ 画面 ${(BIG_TEXT * 100).toFixed(1)}%）只占字面积 ${Math.round(share * 100)}%` });
  }
  return { per, findings: found };
}
const count = (/** @type {any} */ x) => x.count;

/**
 * 字不停.
 * @param {{ t: number, text: { s: string, box: number[] }[] }[]} seconds
 * @returns {{ findings: object[] }}
 */
export function nonstopOf(seconds) {
  const boxes = seconds.map(({ text }) => text.filter((x) => x.s?.trim()).map((x) => x.box));
  const same = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.abs(a[0] + a[2] / 2 - b[0] - b[2] / 2) < 0.015 && Math.abs(a[1] + a[3] / 2 - b[1] - b[3] / 2) < 0.015 && Math.abs(a[3] - b[3]) < 0.25 * Math.max(a[3], b[3]);
  const unsettled = boxes.map((now, k) => {
    if (!now.length || k === 0 || seconds[k].t - seconds[k - 1].t > 1 + 1e-6) return false;
    const before = boxes[k - 1];
    if (!before.length) return false;
    const area = before.reduce((s, b) => s + b[2] * b[3], 0);
    const stay = before.filter((b) => now.some((x) => same(b, x))).reduce((s, b) => s + b[2] * b[3], 0);
    return stay < 0.7 * area;
  });
  /** @type {object[]} */
  const found = [];
  for (const [a, b] of runsOf(unsettled)) {
    const from = seconds[a - 1].t, to = seconds[b - 1].t, long = to - from;
    if (long > NONSTOP_MAX) found.push({ check: 'nonstop', level: '!', from, to, said: `画面上有字，${long.toFixed(0)} 秒里字一直在动，没停下来让人读` });
  }
  return { findings: found };
}

/** The ask every frame is read with. JSON only — nothing else parses. */
export const WORDS_ASK = `List every block of text visible in this video frame — subtitles, titles, captions, labels, watermarks, text that is part of the picture itself. Answer with JSON only, no other text:
{"text":[{"s":"the text","box":[x,y,w,h],"big":true}]}
where box is the block's position as fractions of the frame's width and height (0-1): x,y the top-left corner, w,h the size, and big is true when the text is large enough to read comfortably at a glance (title or subtitle size), false for small print a viewer would have to lean in to read. Example: {"text":[{"s":"标题文字","box":[0.30,0.75,0.40,0.06],"big":true},{"s":"角落里的小字","box":[0.02,0.95,0.15,0.02],"big":false}]}
If there is no readable text, answer {"text":[]}. Read small text too — list every block you can make out, even partly.`;

/**
 * The model's answer read hard: JSON (a fence around it forgiven), every box four finite numbers in range,
 * anything else dropped rather than trusted. null: the answer does not read at all (the second is not read).
 * @param {string} answer
 * @returns {{ s: string, box: number[] }[] | null}
 */
export function readWordsAnswer(answer) {
  const m = answer.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(data?.text)) return null;
  const out = [];
  for (const x of data.text) {
    if (typeof x?.s !== 'string' || !Array.isArray(x.box) || x.box.length !== 4) continue;
    const box = x.box.map(Number);
    if (!box.every((v) => Number.isFinite(v) && v >= -0.05 && v <= 1.05)) continue;
    if (box[2] <= 0 || box[3] <= 0) continue;
    out.push({ s: x.s, box, big: x.big === true });
  }
  return out;
}
