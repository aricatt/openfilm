// @ts-check
/**
 * Lines said over a picture that does not move (死句): the film's caption cues crossed with the motion read's
 * per-step stillness. A line is dead when the picture is still for DEAD_SHARE of it; the craft is that dead
 * lines stay a small share of all lines (DEAD_LIMIT) — one held moment with a line over it can be meant,
 * a film of them reads as a slideshow with a voiceover.
 *
 * Steps come from the grey-frame motion read (check-motion): step i covers [i/fps, (i+1)/fps) of the film,
 * still when the mean grey difference from the frame before is under STILL_STEP. A cue's share is the still
 * steps of the steps it covers — the first and last partial step counted whole, the line's edges never
 * measured finer than the read itself.
 */
import { STILL_STEP } from './check-motion.mjs';

/** A line is dead when the picture is still for this share of it. */
export const DEAD_SHARE = 0.9;
/** Lines over a still picture at most this share of all lines. */
export const DEAD_LIMIT = 0.1;

/**
 * @param {object} o
 * @param {(number|null)[]} o.steps mean grey difference of each step (null where not judged), from motionOf
 * @param {number} o.fps steps a second
 * @param {{ start: number, end: number, text?: string }[]} o.lines caption cues on the film's time
 * @returns {{ dead: number[], lines: { index: number, start: number, end: number, share: number, text: string }[], share: number, over: boolean }}
 *   dead: indexes into lines; share: dead / lines; over: share past DEAD_LIMIT
 */
export function deadLines({ steps, fps, lines }) {
  const still = steps.map((s) => s != null && Number.isFinite(s) && s < STILL_STEP);
  const rows = lines.map((line, index) => {
    const a = Math.max(0, Math.floor(line.start * fps));
    const z = Math.min(still.length, Math.ceil(line.end * fps));
    let n = 0, dead = 0;
    for (let i = a; i < z; i++) { n++; if (still[i]) dead++; }
    const share = n ? dead / n : 0;
    return { index, start: line.start, end: line.end, share, text: (line.text ?? '').replace(/<[^>]+>/g, '').trim() };
  });
  /* a line shorter than a step or two is never judged dead: its stillness is the cut around it, not the picture */
  const judged = rows.filter((r) => (r.end - r.start) * fps >= 2);
  const dead = judged.filter((r) => r.share >= DEAD_SHARE).map((r) => r.index);
  const share = judged.length ? dead.length / judged.length : 0;
  return { dead, lines: rows, share, over: share > DEAD_LIMIT };
}
