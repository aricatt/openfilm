// @ts-check
/**
 * Word-level caption timing, on the WebVTT standard: inline timestamps in the cue's text
 * (`00:01.200` before the word it times, the karaoke form), not a private side format. A cue
 * with inline timestamps is still a valid cue everywhere — players that know them karaoke,
 * players that don't show the line whole — so the film never depends on craft to read.
 *
 * `marks`: where each timed word starts in the cue's plain text (UTF-16 index) and when
 * (seconds, on the cue's own time base), in text order — ADu's shape, so the repair trio
 * (adudir-caption-marks, re-implemented) works on it as it did there.
 */

/** inline timestamp: `<00:01.200>` or `<0:01:02.300>`, as WebVTT writes them */
const STAMP = /<(\d{2}:)?\d{2}:\d{2}\.\d{3}>/g;

const toSeconds = (s) => {
  const parts = s.split(':');
  return +parts[parts.length - 1] + 60 * +parts[parts.length - 2] + (parts.length === 3 ? 3600 * +parts[0] : 0);
};

const toStamp = (t) => {
  const cs = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(cs / 3600000), m = Math.floor((cs % 3600000) / 60000), s = (cs % 60000) / 1000;
  const mm = String(m).padStart(2, '0'), ss = s.toFixed(3).padStart(6, '0');
  return h ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * A cue's word times from its inline timestamps (seconds, relative to the file — inline stamps
 * are absolute, as the cue's own start is). Plain text is the cue's text with the stamps out.
 * @param {string} text the cue's text as written (stamps in)
 * @returns {{ plain: string, marks: { index: number, startMs: number }[] }}
 */
export function readInlineWords(text) {
  const marks = [];
  let plain = '';
  let last = 0;
  for (const m of text.matchAll(STAMP)) {
    plain += text.slice(last, m.index);
    marks.push({ index: plain.length, startMs: Math.round(toSeconds(m[0].slice(1, -1)) * 1000) });
    last = m.index + m[0].length;
  }
  plain += text.slice(last);
  return { plain, marks };
}

/**
 * The cue's text with its word times written as inline timestamps: a stamp before each mark's
 * character, at the mark's time. Times absolute (the cue lives on the file's time base).
 * @param {string} plain @param {readonly { index: number, startMs: number }[]} marks
 */
export function writeInlineWords(plain, marks) {
  let out = '';
  let at = 0;
  for (const mark of [...marks].sort((a, b) => a.index - b.index)) {
    if (mark.index < at || mark.index > plain.length) continue;
    out += plain.slice(at, mark.index) + `<${toStamp(mark.startMs / 1000)}>`;
    at = mark.index;
  }
  return out + plain.slice(at);
}

/**
 * Whether a line's word times can be used as they are: each inside the text, after the one before
 * it, and inside the line's time (one word may start with the one before it, as the editor allows).
 * Times here are on the cue's own base: between cue.startMs and cue.endMs (milliseconds).
 * @param {{ text: string, startMs: number, endMs: number, marks?: readonly { index: number, startMs: number }[] }} cue
 */
export function captionMarksValid(cue) {
  let lastIndex = -1, lastTime = cue.startMs;
  for (const mark of cue.marks ?? []) {
    if (!usable(mark, lastIndex, lastTime, cue)) return false;
    lastIndex = mark.index; lastTime = mark.startMs;
  }
  return true;
}

/** @param {{ index: number, startMs: number }} mark @param {number} lastIndex @param {number} lastTime
 *  @param {{ text: string, endMs: number }} cue */
function usable(mark, lastIndex, lastTime, cue) {
  return Boolean(mark) && Number.isInteger(mark.index) && Number.isFinite(mark.startMs) && mark.index >= 0 && mark.index > lastIndex
    && mark.index < cue.text.length && mark.startMs >= lastTime && mark.startMs <= cue.endMs;
}

/**
 * The line's visible characters timed evenly over it (each grapheme that is not a space, at
 * start + i·length/n, whole ms, strictly later each); none for a line of fewer than two.
 * @param {{ text: string, startMs: number, endMs: number }} cue @returns {{ index: number, startMs: number }[]}
 */
export function evenCaptionMarks(cue) {
  /** @type {number[]} */
  const letters = [];
  const Segmenter = /** @type {any} */ (Intl).Segmenter;
  if (typeof Segmenter === 'function') {
    for (const part of new Segmenter(undefined, { granularity: 'grapheme' }).segment(cue.text)) if (part.segment.trim()) letters.push(part.index);
  } else {
    let at = 0;
    for (const char of cue.text) { if (char.trim()) letters.push(at); at += char.length; }
  }
  const span = cue.endMs - cue.startMs;
  if (letters.length < 2 || !(span > 0)) return [];
  /** @type {{ index: number, startMs: number }[]} */
  const out = [];
  letters.forEach((index, i) => {
    const startMs = Math.round(cue.startMs + span * i / letters.length);
    if (!out.length || startMs > out[out.length - 1].startMs) out.push({ index, startMs });
  });
  return out.length >= 2 ? out : [];
}

/**
 * A line with word times that can be used: those out of place dropped, and when fewer than two are
 * left, the line timed evenly. A line already right comes back as the same object (`repaired: false`);
 * a line whose own times are wrong (end not after start) too — that is the caller's check to say.
 * @template {{ text: string, startMs: number, endMs: number, marks?: { index: number, startMs: number }[] }} T
 * @param {T} cue @returns {{ cue: T, repaired: boolean }}
 */
export function repairCaptionMarks(cue) {
  const marks = cue.marks;
  if (!Array.isArray(marks) || !marks.length || !(cue.endMs > cue.startMs) || typeof cue.text !== 'string' || captionMarksValid(cue)) return { cue, repaired: false };
  /** @type {{ index: number, startMs: number }[]} */
  const kept = [];
  let lastIndex = -1, lastTime = cue.startMs;
  for (const mark of marks) {
    if (!usable(mark, lastIndex, lastTime, cue)) continue;
    kept.push({ index: mark.index, startMs: mark.startMs }); lastIndex = mark.index; lastTime = mark.startMs;
  }
  const next = kept.length >= 2 ? kept : evenCaptionMarks(cue);
  const { marks: _old, ...rest } = cue;
  return { cue: /** @type {T} */ (next.length ? { ...rest, marks: next } : rest), repaired: true };
}
