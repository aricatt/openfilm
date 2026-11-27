// @ts-check
/**
 * 叠化: frames that are a mix of two pictures (ADu's blend detection, rewritten). A dissolve reads as a
 * mistake in a film of hard cuts — titles especially. The read: frame f is a blend when f ≈ α·a + (1−α)·b
 * for frames a, b a few steps either side, the two pictures differ, α is mid-range, little is left after
 * the mix, and the two pictures are genuinely two pictures on top of each other where they differ (not a
 * pan, a dim, or one layer fading over a busy background).
 *
 * The two-pictures test is the heart: tiles where they differ must hold structure of each that the other
 * does not explain — not scaled-and-lifted, not moved a few px — and the frame must be the mix in those
 * tiles. A title fading over a plain page fails it (the plain side explains everything); a pan fails it
 * (everything explained by the move); two titles crossfading passes it (each tile holds only one).
 */
import { runsOf } from './check-motion.mjs';

/** frames either side the mix is read against (at CHECK_FPS: 0.2–0.4 s) */
export const BLEND_K = Object.freeze([2, 3, 4]);
/** mean grey difference of the two pictures under which they are the same picture */
export const BLEND_DIFF = 1;
/** α must sit inside this range — nearer an end, the frame is one picture, not a mix */
export const BLEND_MIX = Object.freeze([0.25, 0.75]);
/** RMS of what the mix leaves, as a share of the two pictures' difference, over which it is no mix */
export const BLEND_FIT = 0.4;
/** tile side px */
export const BLEND_TILE = 8;
/** a tile's own structure (grey sd) under which it has none */
export const BLEND_STRUCT = 6;
/** gone: at least this share of that picture's own spread there */
export const BLEND_GONE = 0.65;
/** and this many times the structure that picture has around and elsewhere */
export const BLEND_OWN = 2;
/** how far (px) about the whole picture's move a tile's structure may have moved and still be the same picture */
export const BLEND_REACH = 4;
/** at least this many tiles holding two pictures */
export const BLEND_TILES = 3;
/** of each picture's structure in the zone, at least this share gone or new (replaced, not moving) */
export const BLEND_REPLACED = 0.25;
/** the mix's median tile fit at most this */
export const BLEND_TILE_FIT = 0.3;
/** a pixel whose grey differs by this much between the two pictures is where they differ */
const BLEND_PIXEL = 16;
/** frames in a row a mix takes to be said */
export const BLEND_FRAMES = 2;

/** The spread (standard deviation) of grey over some pixels. */
function sdOf(/** @type {Uint8Array} */ f, /** @type {number[]} */ px) {
  let s = 0, q = 0;
  for (const p of px) { s += f[p]; q += f[p] * f[p]; }
  return px.length ? Math.sqrt(Math.max(0, q / px.length - (s / px.length) ** 2)) : 0;
}

/** The whole picture's shift a to b in whole px within ±r, read on every other pixel. */
function coarseShift(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ r) {
  let best = { dx: 0, dy: 0, res: Infinity };
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    let s = 0, n = 0;
    for (let y = Math.max(0, dy); y < Math.min(h, h + dy); y += 2) {
      const row = y * w, from = (y - dy) * w - dx;
      for (let x = Math.max(0, dx); x < Math.min(w, w + dx); x += 2) { s += Math.abs(a[from + x] - b[row + x]); n++; }
    }
    const res = n ? s / n : Infinity;
    if (res < best.res - 1e-9 || (Math.abs(res - best.res) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, res };
  }
  return best;
}

/**
 * What of y over pixels `px` its other picture x does not explain (RMS grey left): the least of x scaled
 * and lifted (least squares) and x moved by (dx, dy) plus up to BLEND_REACH px more, with a half-pixel
 * refinement. Under `enough` it stops looking: explained.
 */
function unexplained(/** @type {Uint8Array} */ x, /** @type {Uint8Array} */ y, /** @type {number[]} */ px, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ enough) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const p of px) { n++; sx += x[p]; sy += y[p]; sxx += x[p] * x[p]; sxy += x[p] * y[p]; syy += y[p] * y[p]; }
  const vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2, cov = sxy / n - (sx / n) * (sy / n);
  let best = Math.sqrt(Math.max(0, vx > 1e-9 ? vy - (cov * cov) / vx : vy));
  if (best < enough) return best;
  const moved = (/** @type {number} */ mx, /** @type {number} */ my) => {
    let s = 0, m = 0;
    for (const p of px) {
      const fx = (p % w) - mx, fy = Math.floor(p / w) - my, x0 = Math.floor(fx), y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
      const tx = fx - x0, ty = fy - y0, i = y0 * w + x0;
      const v = (x[i] * (1 - tx) + x[i + 1] * tx) * (1 - ty) + (x[i + w] * (1 - tx) + x[i + w + 1] * tx) * ty;
      s += (v - y[p]) ** 2; m++;
    }
    return m >= px.length / 2 ? Math.sqrt(s / m) : Infinity;
  };
  let at = { mx: dx, my: dy, res: Infinity };
  for (let oy = -BLEND_REACH; oy <= BLEND_REACH; oy++) for (let ox = -BLEND_REACH; ox <= BLEND_REACH; ox++) {
    const res = moved(dx + ox, dy + oy);
    if (res < at.res) at = { mx: dx + ox, my: dy + oy, res };
  }
  best = Math.min(best, at.res);
  for (let oy = -1; oy <= 1 && best >= enough; oy++) for (let ox = -1; ox <= 1 && best >= enough; ox++) if (ox || oy) best = Math.min(best, moved(at.mx + ox / 2, at.my + oy / 2));
  return best;
}

/**
 * Whether a and b are two pictures on top of each other where they differ.
 * @returns {{ tiles: number, zone: number, replaced: number, mixed: number, two: boolean }}
 */
export function twoPictures(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ f, /** @type {Uint8Array} */ b, /** @type {number} */ alpha, /** @type {number} */ w, /** @type {number} */ h) {
  const S = BLEND_TILE, tw = Math.ceil(w / S), th = Math.ceil(h / S), full = (S * S) / 2;
  /** @type {{ px: number[], zone: boolean, sdA: number, sdB: number }[]} */
  const tiles = [];
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const px = [];
    let changed = 0;
    for (let y = ty * S; y < Math.min(h, ty * S + S); y++) for (let x = tx * S; x < Math.min(w, tx * S + S); x++) {
      const p = y * w + x;
      px.push(p);
      if (Math.abs(a[p] - b[p]) >= BLEND_PIXEL) changed++;
    }
    tiles.push({ px, zone: px.length >= full && changed >= 3, sdA: sdOf(a, px), sdB: sdOf(b, px) });
  }
  const ringA = [], ringB = [], elseA = [], elseB = [];
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    if (t.zone || t.px.length < full) continue;
    elseA.push(t.sdA); elseB.push(t.sdB);
    const x = k % tw, y = Math.floor(k / tw);
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < tw && yy < th && tiles[yy * tw + xx].zone) { near = true; break; }
    }
    if (near) { ringA.push(t.sdA); ringB.push(t.sdB); }
  }
  const part = (/** @type {number[]} */ v, /** @type {number} */ q) => (v.length >= 3 ? [...v].sort((x, y) => x - y)[Math.min(v.length - 1, Math.floor(q * v.length))] : 0);
  const needA = Math.max(BLEND_STRUCT, BLEND_OWN * Math.max(part(ringA, 0.75), part(elseA, 0.8)));
  const needB = Math.max(BLEND_STRUCT, BLEND_OWN * Math.max(part(ringB, 0.75), part(elseB, 0.8)));
  const move = coarseShift(a, b, w, h, 6);
  let two = 0, zone = 0, ownA = 0, goneA = 0, ownB = 0, newB = 0;
  /** @type {number[]} */
  const fits = [];
  for (const t of tiles) {
    if (!t.zone) continue;
    zone++;
    let gone = false, fresh = false;
    if (t.sdA >= needA) { ownA++; const enough = Math.max(needA, BLEND_GONE * t.sdA); gone = unexplained(b, a, t.px, w, h, -move.dx, -move.dy, enough) >= enough; goneA += Number(gone); }
    if (t.sdB >= needB) { ownB++; const enough = Math.max(needB, BLEND_GONE * t.sdB); fresh = unexplained(a, b, t.px, w, h, move.dx, move.dy, enough) >= enough; newB += Number(fresh); }
    if (gone && fresh) {
      two++;
      let e = 0, d = 0;
      for (const p of t.px) { const x = a[p] - b[p], y = f[p] - b[p] - alpha * x; d += x * x; e += y * y; }
      fits.push(d ? Math.sqrt(e / d) : 0);
    }
  }
  const replaced = Math.min(ownA ? goneA / ownA : 0, ownB ? newB / ownB : 0);
  const mixed = fits.length ? [...fits].sort((x, y) => x - y)[fits.length >> 1] : Infinity;
  return { tiles: two, zone, replaced, mixed, two: two >= BLEND_TILES && replaced >= BLEND_REPLACED && mixed <= BLEND_TILE_FIT };
}

/**
 * Whether frame f is a mix of a and b: f ≈ α·a + (1−α)·b, the two differ, α mid-range, little left after
 * the mix, and the two genuinely two pictures on top of each other. `why` says which test it failed.
 */
export function blendAt(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ f, /** @type {Uint8Array} */ b, /** @type {number} */ w, /** @type {number} */ h) {
  let n = 0, sum = 0, dd = 0, rd = 0;
  for (let p = 0; p < a.length; p++) {
    const d = a[p] - b[p], r = f[p] - b[p];
    sum += Math.abs(d); dd += d * d; rd += r * d; n++;
  }
  const diff = n ? sum / n : 0;
  if (diff < BLEND_DIFF || !dd) return { blend: false, why: 'alike', diff, alpha: NaN, fit: NaN };
  const alpha = rd / dd;
  if (alpha < BLEND_MIX[0] || alpha > BLEND_MIX[1]) return { blend: false, why: 'one side', diff, alpha, fit: NaN };
  let res = 0;
  for (let p = 0; p < a.length; p++) {
    const e = f[p] - b[p] - alpha * (a[p] - b[p]);
    res += e * e;
  }
  const fit = Math.sqrt(res / dd);
  const said = { diff, alpha, fit };
  if (fit > BLEND_FIT) return { blend: false, why: 'no mix', ...said };
  if (!twoPictures(a, f, b, alpha, w, h).two) return { blend: false, why: 'one picture', ...said };
  return { blend: true, why: '', ...said };
}

/**
 * The frames that are a mix of two pictures, read at every frame against the frames BLEND_K either side;
 * one finding a stretch of BLEND_FRAMES or more (a single frame between two blends does not split it).
 * @param {{ frames: Uint8Array[], w: number, h: number, fps: number }} o
 * @returns {{ at: number[], findings: { check: string, level: string, from: number, to: number, said: string }[] }}
 */
export function blendsOf({ frames, w, h, fps }) {
  const n = frames.length;
  const flagged = new Array(n).fill(false);
  for (let i = 1; i < n - 1; i++) {
    for (const k of BLEND_K) {
      const a = i - k, b = i + k;
      if (a < 0 || b >= n) continue;
      if (blendAt(frames[a], frames[i], frames[b], w, h).blend) { flagged[i] = true; break; }
    }
  }
  for (let i = 1; i < n - 1; i++) if (!flagged[i] && flagged[i - 1] && flagged[i + 1]) flagged[i] = true;
  const t = (/** @type {number} */ i) => Number((i / fps).toFixed(2));
  const findings = runsOf(flagged).filter(([a, b]) => b - a >= BLEND_FRAMES)
    .map(([a, b]) => ({ check: 'blend', level: '~', from: t(a), to: t(b - 1), said: '两层画面叠在一起（标题切换请硬切）' }));
  return { at: flagged.flatMap((x, i) => (x ? [i] : [])), findings };
}
