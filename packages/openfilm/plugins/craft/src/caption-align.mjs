// @ts-check
/**
 * Aligning caption text to sound: where the words of a line start, without the recognition saying.
 * The recognition (mimo asr) transcribes but times nothing, so the timing comes from the sound itself —
 * ffmpeg's silencedetect finds where speech is (soundStretches), the text is spread over it in order.
 *
 * Lines to stretches: both in order, the line's share of the text positioning it in the total sound.
 * It is the even spread of caption-words at two scales — lines over the speech, characters over the
 * line — exact for steady speech, close enough for the rest that the karaoke reads right.
 */
import { soundStretches } from './check-uncovered.mjs';
import { evenCaptionMarks, writeInlineWords } from './caption-words.mjs';

/**
 * The text broken into speakable lines: at the sentence punctuation, longest first kept whole.
 * @param {string} text @returns {string[]}
 */
export function linesOf(text) {
  return text.split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Lines laid over the sound stretches in order: each line's time is the share of the total sound
 * its characters account for, walked forward. Fewer stretches than lines is fine — the share is of
 * all the sound, silence between stretches falls between lines where it belongs.
 * @param {string[]} lines @param {[number, number][]} stretches seconds
 * @returns {{ text: string, startMs: number, endMs: number }[]} cues (milliseconds)
 */
export function layLines(lines, stretches) {
  if (!lines.length || !stretches.length) return [];
  const total = stretches[stretches.length - 1][1];
  const chars = lines.map((l) => [...l].filter((c) => c.trim()).length);
  const all = chars.reduce((a, b) => a + b, 0) || 1;
  const out = [];
  let at = stretches[0][0];
  lines.forEach((text, i) => {
    const len = (total - at) * (chars[i] / Math.max(1, chars.slice(i).reduce((a, b) => a + b, 0)));
    const end = i === lines.length - 1 ? total : at + len;
    out.push({ text, startMs: Math.round(at * 1000), endMs: Math.round(end * 1000) });
    at = end;
  });
  return out;
}

/**
 * A cue's text with its characters timed as inline stamps (the karaoke form) over its own time.
 * @param {{ text: string, startMs: number, endMs: number }} cue
 */
export function timedText(cue) {
  const marks = evenCaptionMarks(cue);
  return writeInlineWords(cue.text, marks);
}

const stamp = (ms) => {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = (ms % 60000) / 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
};

/**
 * The cues as a WebVTT file, inline stamps in every line's text.
 * @param {{ text: string, startMs: number, endMs: number }[]} cues
 */
export function vttOf(cues) {
  const body = cues.map((c) => `${stamp(c.startMs)} --> ${stamp(c.endMs)}\n${timedText(c)}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/**
 * The whole alignment: the file's sound found, the lines laid over it, the vtt written.
 * @param {string} file @param {number} duration seconds @param {string} text
 * @returns {{ vtt: string, cues: { text: string, startMs: number, endMs: number }[], stretches: [number, number][] } | null}
 */
export function alignText(file, duration, text) {
  const stretches = soundStretches(file, duration);
  if (!stretches?.length) return null;
  const cues = layLines(linesOf(text), stretches);
  return { vtt: vttOf(cues), cues, stretches };
}
