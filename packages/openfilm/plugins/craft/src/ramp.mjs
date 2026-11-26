// @ts-check
/**
 * craft ramp: a clip's speed curve — its film time shared out unevenly over the same part of its file: fast, then
 * slow, then fast. The clip stays as long on the film and shows the same source seconds from first frame to last,
 * so a trim, a move, a cut beside it and an export keep their times.
 *
 * Declared on a video clip as data-craft-ramp: a preset's name, or the points themselves
 * (`[[u, speed], …]`, u the share along the clip 0–1, speed relative, joined by straight lines). The curve is
 * normalized: its mean speed is 1, so the whole source span is always consumed exactly — only its distribution
 * changes. A curved clip is not heard: its sound would be stretched and squeezed unevenly.
 *
 * The same math lives in src/film-doc.mjs (sourceAt) for the render path — the core cannot import the plugin, so
 * the integral is tiny and duplicated there. This module is the reference: the CLI validates declarations against
 * it, and the tests exercise it.
 */

/** The presets: each [[u, speed], …], u rising 0 to 1. */
export const RAMP_CURVES = Object.freeze({
  /* fast in, a slow middle, fast out — the montage staple */
  montage: [[0, 3], [0.3, 0.45], [0.7, 0.45], [1, 3]],
  /* normal, a slow-downed peak, back — the hero moment */
  hero: [[0, 1], [0.35, 1], [0.5, 0.18], [0.65, 1], [1, 1]],
  /* fast, a held slow stretch, fast out — bullet time */
  bullet: [[0, 1.6], [0.3, 1.6], [0.4, 0.12], [0.7, 0.12], [0.8, 1.6], [1, 1.6]],
  /* fast in settling to normal — an entrance */
  'flash-in': [[0, 4], [0.3, 4], [0.45, 1], [1, 1]],
  /* normal leaving fast — an exit */
  'flash-out': [[0, 1], [0.55, 1], [0.7, 4], [1, 4]],
});

export const RAMP_ATTR = 'data-craft-ramp';

/** The points a declaration names: a preset's, or its own JSON list checked. Null when it does not read. */
export function rampPoints(/** @type {string | unknown} */ declaration) {
  if (typeof declaration !== 'string' || !declaration.trim()) return null;
  const name = declaration.trim();
  if (name in RAMP_CURVES) return RAMP_CURVES[/** @type {keyof typeof RAMP_CURVES} */ (name)].map((p) => [...p]);
  let list;
  try { list = JSON.parse(name); } catch { return null; }
  if (!Array.isArray(list) || list.length < 2) return null;
  if (!list.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)))) return null;
  if (list[0][0] !== 0 || list[list.length - 1][0] !== 1) return null;
  if (!list.every((p, i) => i === 0 || p[0] > list[i - 1][0])) return null;
  if (list.some((p) => p[1] <= 0)) return null;
  return list.map((p) => [...p]);
}

/** The curve's relative speed at u (0–1), points joined by straight lines. */
export function rampSpeed(/** @type {number[][]} */ points, /** @type {number} */ u) {
  for (let i = 1; i < points.length; i++) {
    const [u0, s0] = points[i - 1], [u1, s1] = points[i];
    if (u <= u1) return u1 > u0 ? s0 + ((s1 - s0) * (u - u0)) / (u1 - u0) : s1;
  }
  return points[points.length - 1][1];
}

const STEPS = 512;

/**
 * The curve integrated and normalized: a table of the source span's running share (0–1) at STEPS + 1 even shares
 * of the film time. Normalized so the whole span is consumed over the whole clip, whatever the curve's absolute
 * speeds — only their shape matters.
 * @param {number[][]} points @returns {Float64Array}
 */
export function rampTable(points) {
  const raw = new Float64Array(STEPS + 1);
  const du = 1 / STEPS;
  let acc = 0;
  for (let i = 1; i <= STEPS; i++) {
    /* trapezoids of the speed's reciprocal: source advanced per film time is the speed; the running source share
       is the integral of the speed itself */
    acc += (rampSpeed(points, (i - 1) * du) + rampSpeed(points, i * du)) / 2 * du;
    raw[i] = acc;
  }
  const total = raw[STEPS] || 1;
  for (let i = 0; i <= STEPS; i++) raw[i] /= total;
  return raw;
}

/**
 * The source span's share (0–1) consumed at film share u (0–1), from a table built by rampTable.
 * @param {Float64Array} table @param {number} u
 */
export function rampShare(table, u) {
  const x = Math.max(0, Math.min(1, u)) * STEPS;
  const i = Math.min(STEPS - 1, Math.floor(x));
  const f = x - i;
  return table[i] * (1 - f) + table[i + 1] * f;
}

/**
 * The source second showing `localSec` film seconds into a clip whose span is [from, to): the linear part of
 * sourceAt's mapping replaced by the curve. `length` the clip's film seconds.
 * @param {number[][]} points @param {number} localSec @param {number} length @param {number} from @param {number} to
 */
export function rampSourceAt(points, localSec, length, from, to) {
  if (!(length > 0) || !(to > from)) return from;
  const table = rampTable(points);
  return from + (to - from) * rampShare(table, localSec / length);
}
