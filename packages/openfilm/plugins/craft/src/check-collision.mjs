// @ts-check
/**
 * Caption collision, the geometric way: text blocks pressed onto each other in the band where
 * captions sit. ADu's adudir-subtitle-overlap measures exact DOM rectangles through its fork's
 * browser composition — an architecture that does not exist upstream. But the vision pass of
 * craft check already reads every text block with its box, and a collision is geometry: boxes
 * in the caption band overlapping each other. Same question answered, no extra model call.
 */

/** the caption band: this share of the picture's height from its bottom */
export const BAND = 0.22;
/** an overlap smaller than this share of the smaller box is anti-aliasing, not a collision */
export const MIN_OVERLAP = 0.25;

const overlapArea = (a, b) => {
  const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
  const r = Math.min(a[0] + a[2], b[0] + b[2]), btm = Math.min(a[1] + a[3], b[1] + b[3]);
  return r > x && btm > y ? (r - x) * (btm - y) : 0;
};

/**
 * Colliding pairs in one second's read: boxes touching the caption band whose overlap covers
 * MIN_OVERLAP of the smaller one.
 * @param {{ s: string, box: number[] }[]} blocks
 * @returns {{ a: string, b: string, box: number[] }[]}
 */
export function collisionsIn(blocks) {
  const band = blocks.filter((b) => b.s?.trim() && b.box[1] + b.box[3] > 1 - BAND);
  const out = [];
  for (let i = 0; i < band.length; i++) {
    for (let j = i + 1; j < band.length; j++) {
      const [a, b] = [band[i], band[j]];
      const area = overlapArea(a.box, b.box);
      const smaller = Math.min(a.box[2] * a.box[3], b.box[2] * b.box[3]);
      if (smaller > 0 && area / smaller >= MIN_OVERLAP) {
        const x = Math.max(a.box[0], b.box[0]), y = Math.max(a.box[1], b.box[1]);
        out.push({
          a: a.s.slice(0, 20), b: b.s.slice(0, 20),
          box: [x, y, Math.min(a.box[0] + a.box[2], b.box[0] + b.box[2]) - x, Math.min(a.box[1] + a.box[3], b.box[1] + b.box[3]) - y],
        });
      }
    }
  }
  return out;
}

/**
 * Collisions over the film: a pair seen in several seconds is one finding, first to last second.
 * @param {{ t: number, text: { s: string, box: number[] }[] }[]} seconds
 */
export function collisionsOf(seconds) {
  /** @type {Map<string, { from: number, to: number, a: string, b: string }>} */
  const runs = new Map();
  for (const { t, text } of seconds) {
    for (const c of collisionsIn(text ?? [])) {
      const key = `${c.a}×${c.b}`;
      const run = runs.get(key);
      if (run) run.to = t;
      else runs.set(key, { from: t, to: t, a: c.a, b: c.b });
    }
  }
  const findings = [...runs.values()].map((r) => ({
    level: 'bad', check: 'collision', from: r.from, to: r.to + 1,
    said: `text pressed onto text in the caption band: 「${r.a}」 onto 「${r.b}」`,
  }));
  return { findings, pairs: runs.size };
}
