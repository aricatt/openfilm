// @ts-check
/**
 * The ducking curve, pure: from what is measured of the sounds a clip ducks under, the gain it is turned by,
 * per cell of GRID seconds of the film. Nothing of Node's or a browser's here: the same code makes the curve the
 * export multiplies in and the one the command draws for a check.
 *
 * The shape is a compressor's with a rest level: speech pushes the gain down fast (`attack`) toward `speech` dB,
 * how far by how loud it is over `threshold` (harder the higher `ratio`); a word ended, the gain is `hold`d where
 * it is, then comes back up (`release`) — to `pause` dB while the clip is inside its ducking window, to full
 * outside it.
 */

/** The grid the curve is worked out on (s): fine enough that the ear hears no steps. */
export const GRID = 0.01;

export const DEFAULTS = {
  speech: -17,
  pause: -13,
  ratio: 3,
  threshold: -40,
  attack: 0.04,
  release: 0.35,
  hold: 0.15,
  ramp: 0.15,
};

/** A level in dB as a gain. @param {number} db */
export const dbGain = (db) => 10 ** (db / 20);

/**
 * The ducking parameters of one clip, checked: every number there or its default, `under` the clip ids it follows
 * (empty: every other sounding clip), `over` the windows set to a level whatever is said.
 * @param {unknown} raw what data-craft-duck carried (JSON), or null for the defaults
 */
export function duckParams(raw) {
  /** @type {Record<string, unknown>} */
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
  const num = (k, d, lo, hi) => {
    const v = o[k];
    if (v === undefined) return d;
    if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) throw new Error(`data-craft-duck: ${k} has to be a number ${lo} to ${hi}`);
    return v;
  };
  const under = o.under === undefined ? [] : o.under;
  if (!Array.isArray(under) || under.some((u) => typeof u !== 'string')) throw new Error('data-craft-duck: under has to be clip ids');
  const over = o.over === undefined ? [] : o.over;
  if (!Array.isArray(over) || over.some((w) => !Array.isArray(w) || w.length !== 3 || w.some((x) => typeof x !== 'number' || !isFinite(x)))) {
    throw new Error('data-craft-duck: over has to be [[from, to, dB], …]');
  }
  return {
    under: /** @type {string[]} */ (under),
    speech: num('speech', DEFAULTS.speech, -60, 0),
    pause: num('pause', DEFAULTS.pause, -60, 0),
    ratio: num('ratio', DEFAULTS.ratio, 1, 20),
    threshold: num('threshold', DEFAULTS.threshold, -80, 0),
    attack: num('attack', DEFAULTS.attack, 0.005, 1),
    release: num('release', DEFAULTS.release, 0.02, 2),
    hold: num('hold', DEFAULTS.hold, 0, 1),
    ramp: num('ramp', DEFAULTS.ramp, 0.01, 1),
    from: num('from', 0, 0, Infinity),
    to: num('to', Infinity, 0, Infinity),
    over: /** @type {[number, number, number][]} */ (over),
  };
}

/**
 * The gain curve of one ducking clip, per GRID cell of the film (0 the film's start), 1 at its loudest.
 * @param {Float64Array} power mean-square power of everything it follows, per GRID cell of the film
 * @param {number} frames cells of the film
 * @param {ReturnType<typeof duckParams>} p
 * @returns {Float32Array} linear gain per cell
 */
export function duckCurve(power, frames, p) {
  const out = new Float32Array(frames);
  const thresholdP = dbGain(p.threshold) ** 2;
  /* how far down speech takes it, in dB: none at the threshold, all of the way to `speech` over a span that
     the ratio shortens (a harder ratio ducks fully on a quieter voice) */
  const span = (12 * 3) / p.ratio;
  const depthDb = (pw) => {
    const overDb = 10 * Math.log10(pw / thresholdP);
    return p.pause + (p.speech - p.pause) * Math.min(1, overDb / span);
  };
  const attackStep = Math.max(1, Math.round(p.attack / GRID));
  const releaseStep = Math.max(1, Math.round(p.release / GRID));
  const holdCells = Math.round(p.hold / GRID);
  /* starting inside the window the music is already at its pause level: a film does not open with the music
     drifting down through its first seconds */
  let g = p.from <= 0 ? dbGain(p.pause) : 1;
  let held = 0;
  for (let i = 0; i < frames; i++) {
    const t = i * GRID;
    const inside = t >= p.from && t < p.to;
    const pw = power[i] ?? 0;
    const speech = pw > thresholdP;
    /* where the gain belongs once the hold is past: the pause level inside the window, full outside */
    const rest = inside ? dbGain(p.pause) : 1;
    if (speech) {
      held = holdCells;
      const down = dbGain(depthDb(pw));
      g += (down - g) / attackStep;
      if (g < down) g = down;
    } else {
      if (held > 0) held -= 1;
      else {
        g += (rest - g) / releaseStep;
        if (Math.abs(rest - g) < 1e-4) g = rest;
      }
    }
    out[i] = Math.min(1, g);
  }
  /* windows set to a level whatever is said, ramped in and out */
  for (const [from, to, db] of p.over) {
    const fixed = dbGain(db);
    const a = Math.max(0, Math.round(from / GRID)), z = Math.min(frames, Math.round(to / GRID));
    const ramp = Math.max(1, Math.round(p.ramp / GRID));
    for (let i = a; i < z; i++) {
      const amount = Math.min(1, (i - a) / ramp, (z - i) / ramp);
      const level = 1 + (fixed - 1) * amount;
      if (level < out[i]) out[i] = level;
    }
  }
  return out;
}

