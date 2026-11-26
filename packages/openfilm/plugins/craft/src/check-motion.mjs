// @ts-check
/**
 * craft check's motion reading: what a rendered picture does, step by step, measured on small grey frames rather
 * than guessed from a few of them. Pure functions over Uint8Array grey frames — no files, no ffmpeg here
 * (check-frames.mjs brings the frames).
 *
 * The vocabulary a finding is said in:
 *   hold    the picture barely changes for seconds (a breath or a sway still counts as held)
 *   drift   it moves, but so slowly it reads as still — every step tiny, and it goes nowhere
 *   move    one pan or push that never lands
 *   scroll  the picture moving mostly up or down for seconds (a page scrolled on end)
 *
 * Thresholds are calibrated for frames read at CHECK_FPS on a long side of GREY_LONG px, the encoder's noise on a
 * still frame well under STILL_STEP a step.
 */

/** Frames a second the steps below are measured at. */
export const CHECK_FPS = 10;
/** The grey frames' long side, px. */
export const GREY_LONG = 128;
/** Mean grey difference of one step under which the picture counts as still. */
export const STILL_STEP = 0.4;
/** Under this a step is small: a run of only small steps that goes nowhere creeps. */
export const SLOW_STEP = 1.2;
/** Net change (first to last) under which a creeping run went nowhere. */
export const DRIFT_NET = 6;
/** A step this large is a cut, not motion. */
export const CUT_STEP = 40;
/** A shift or a scale explains a step when what is left after it is under this share of it. */
export const EXPLAINS = 0.75;
/** A still stretch whose net change passes this, stepping past the encoder's noise, creeps rather than holds. */
export const CREEP_NET = 3, CREEP_STEP = 0.15;
/** A stretch whose every frame is its first shifted at most this share of the long side, or scaled at most this, breathes: it holds. */
export const BREATH_SHIFT = 0.06, BREATH_SCALE = 0.025;
/** A move is measured between frames up to this far apart (at CHECK_FPS: a second). */
export const MOVE_STRIDE = 10;
/** Seconds: a held picture this long is noted (~), this long is a finding (!). */
export const HOLD_NOTE = 2, HOLD_BAD = 3;
/** Seconds of creeping before it is said; past HOLD_BAD it is a finding. */
export const DRIFT_MIN = 1.5;
/** Seconds: one move longer than this never lands; past MOVE_BAD it is a finding. */
export const MOVE_MAX = 1.4, MOVE_BAD = 2.5;
/** Seconds of the picture moving mostly up or down. */
export const SCROLL_MAX = 2;

/** @typedef {{ check: 'hold' | 'drift' | 'move' | 'scroll', level: '!' | '~', from: number, to: number, said: string }} Finding */

/** Mean absolute grey difference of two frames, over the kept pixels (keep: 1 look, 0 skip; absent: all). */
export function stepOf(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b, keep) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (keep && !keep[i]) continue;
    s += Math.abs(a[i] - b[i]);
    n++;
  }
  return n ? s / n : 0;
}

/**
 * The whole-pixel shift (within ±r grey px) that best lays a over b, and how far apart they still are after it.
 * Ties break toward the smaller shift.
 */
export function shiftOf(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b, w, h, keep, r = 4) {
  let best = { dx: 0, dy: 0, res: Infinity };
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    let s = 0, n = 0;
    for (let y = Math.max(0, dy); y < Math.min(h, h + dy); y++) {
      const row = y * w, from = (y - dy) * w - dx;
      for (let x = Math.max(0, dx); x < Math.min(w, w + dx); x++) {
        if (keep && !keep[row + x]) continue;
        s += Math.abs(a[from + x] - b[row + x]);
        n++;
      }
    }
    const res = n ? s / n : Infinity;
    if (res < best.res - 1e-9 || (Math.abs(res - best.res) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, res };
  }
  return best;
}

/** The scale about the middle (of a few around 1) that best lays a over b, and what is left after it. */
export function zoomOf(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b, w, h, keep) {
  let best = { scale: 1, res: Infinity };
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (const scale of [0.95, 0.97, 0.975, 0.98, 0.985, 0.99, 0.9925, 0.995, 0.9975, 1.0025, 1.005, 1.0075, 1.01, 1.015, 1.02, 1.025, 1.03, 1.05]) {
    let s = 0, n = 0;
    for (let y = 0; y < h; y++) {
      const fy = cy + (y - cy) / scale, y0 = Math.floor(fy), ty = fy - y0;
      if (y0 < 0 || y0 + 1 >= h) continue;
      for (let x = 0; x < w; x++) {
        if (keep && !keep[y * w + x]) continue;
        const fx = cx + (x - cx) / scale, x0 = Math.floor(fx), tx = fx - x0;
        if (x0 < 0 || x0 + 1 >= w) continue;
        /* read between pixels: a scale of a percent moves the middle less than a pixel */
        const i = y0 * w + x0;
        const v = (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + w] * (1 - tx) + a[i + w + 1] * tx) * ty;
        s += Math.abs(v - b[y * w + x]);
        n++;
      }
    }
    const res = n ? s / n : Infinity;
    if (res < best.res) best = { scale, res };
  }
  return best;
}

/** Runs of true in a list: [start, end) pairs. */
export function runsOf(/** @type {boolean[]} */ list) {
  /** @type {[number, number][]} */
  const out = [];
  let a = -1;
  list.forEach((v, i) => {
    if (v && a < 0) a = i;
    if (!v && a >= 0) { out.push([a, i]); a = -1; }
  });
  if (a >= 0) out.push([a, list.length]);
  return out;
}

/**
 * How many separate pushes a run of steps holds: peaks of the smoothed curve that stand out (at least 40 % of the
 * highest), told apart when the curve between two falls under half the lower one. One ease in and out is one.
 */
export function burstsOf(/** @type {number[]} */ steps) {
  if (steps.length < 3) return 1;
  const v = steps.map((_, i) => (steps[Math.max(0, i - 1)] + steps[i] + steps[Math.min(steps.length - 1, i + 1)]) / 3);
  const top = Math.max(...v);
  const peaks = v.flatMap((x, i) => (i > 0 && i < v.length - 1 && x >= v[i - 1] && x > v[i + 1] && x >= 0.4 * top ? [i] : []));
  if (peaks.length < 2) return 1;
  let n = 1, last = peaks[0];
  for (const p of peaks.slice(1)) {
    if (Math.min(...v.slice(last, p + 1)) < 0.5 * Math.min(v[last], v[p])) { n++; last = p; }
    else if (v[p] > v[last]) last = p;
  }
  return n;
}

/**
 * Whether the picture stays where it was from frame a to frame b: each frame across the stretch its first one
 * shifted at most BREATH_SHIFT of the long side or scaled at most BREATH_SCALE, little left after that — or no
 * different at all. How far it goes is what is bounded: the frames nearest the first (a fraction of a pixel off)
 * are no shift a whole-pixel search can name.
 */
export function staysPut(/** @type {Uint8Array[]} */ frames, /** @type {number} */ a, /** @type {number} */ b, w, h, keep) {
  const r = Math.max(1, Math.round(BREATH_SHIFT * Math.max(w, h)));
  const every = Math.max(1, Math.floor((b - a) / 12));
  const far = [];
  for (let j = a + every; j <= b; j += every) far.push({ j, raw: stepOf(frames[a], frames[j], keep) });
  const most = Math.max(0, ...far.map((x) => x.raw));
  for (const { j, raw } of far) {
    if (raw < Math.max(2 * STILL_STEP, 0.5 * most)) continue;
    const enough = Math.max(2 * STILL_STEP, EXPLAINS * raw);
    /* looked for a little further than allowed: a shift found at the edge of the search went further still */
    const s = shiftOf(frames[a], frames[j], w, h, keep, r + 2);
    if (Math.abs(s.dx) <= r && Math.abs(s.dy) <= r && s.res < enough) continue;
    const z = zoomOf(frames[a], frames[j], w, h, keep);
    if (Math.abs(z.scale - 1) <= BREATH_SCALE + 1e-9 && z.res < enough) continue;
    return false;
  }
  return true;
}

const mean = (/** @type {number[]} */ v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);

/**
 * What the picture does, step by step. `frames` grey at `fps`, `w`×`h`; `keepAt(i)` what of frame i is looked at —
 * or null: the frame is not judged (nothing of it left to look at). `footage`: the picture moves by itself (vlog
 * footage), so one long move or a scroll is no finding.
 * @param {{ frames: Uint8Array[], w: number, h: number, fps: number, keepAt?: (i: number) => Uint8Array | null, footage?: boolean }} o
 * @returns {{ steps: number[], still: boolean[], judged: boolean[], findings: Finding[], stillShare: number }}
 */
export function motionOf({ frames, w, h, fps, keepAt = () => undefined, footage = false }) {
  /** @type {Finding[]} */
  const found = [];
  const n = Math.max(0, frames.length - 1);
  /* step i: frame i to i + 1; NaN where not judged */
  const steps = Array.from({ length: n }, (_, i) => {
    const keep = keepAt(i);
    return keep === null ? NaN : stepOf(frames[i], frames[i + 1], keep ?? undefined);
  });
  const judged = steps.map((s) => Number.isFinite(s));
  const t = (/** @type {number} */ i) => Number((i / fps).toFixed(2));
  const still = steps.map((s) => Number.isFinite(s) && s < STILL_STEP);
  /* a twitch of a frame or two in a still picture (a cursor, the encoder) does not end it */
  for (const [a, b] of runsOf(steps.map((s, i) => judged[i] && !still[i]))) {
    if (a > 0 && b < n && still[a - 1] && still[b] && b - a <= 2 && Math.max(...steps.slice(a, b)) < SLOW_STEP) still.fill(true, a, b);
  }
  /* the stretches of motion, a cut splitting one (each side its own motion); one still step inside does not end it */
  const piecesOf = () => {
    const moving = steps.map((s, i) => judged[i] && !still[i]);
    for (let i = 1; i < n - 1; i++) if (!moving[i] && judged[i] && moving[i - 1] && moving[i + 1]) moving[i] = true;
    /** @type {[number, number][]} */
    const pieces = [];
    for (const [a, b] of runsOf(moving)) {
      let from = a;
      for (let i = a; i < b; i++) if (steps[i] >= CUT_STEP) {
        if (i - from >= 2) pieces.push([from, i]);
        from = i + 1;
      }
      if (b - from >= 2) pieces.push([from, b]);
    }
    return pieces;
  };
  /* a held shot that breathes or sways and goes nowhere holds: its steps are still ones (footage moves by itself: not) */
  if (!footage) for (const [x, y] of piecesOf()) {
    let a = x, b = y;
    while (a > 0 && still[a - 1]) a--;
    while (b < n && still[b]) b++;
    const keep = keepAt(x);
    if (staysPut(frames, a, b, w, h, keep === null ? undefined : keep)) still.fill(true, x, y);
  }
  for (const [a, b] of runsOf(still)) {
    const long = (b - a) / fps;
    if (long < HOLD_NOTE) continue;
    const keep = keepAt(a);
    /* every step too small to see, yet the picture went somewhere (further than a breath): it creeps */
    const net = stepOf(frames[a], frames[b], keep === null ? undefined : keep);
    const middle = [...steps.slice(a, b)].sort((x, y) => x - y)[(b - a) >> 1];
    if (net >= CREEP_NET && middle >= CREEP_STEP && !staysPut(frames, a, b, w, h, keep === null ? undefined : keep)) {
      found.push({ check: 'drift', level: long >= HOLD_BAD ? '!' : '~', from: t(a), to: t(b), said: `${long.toFixed(1)}s: every step nearly invisible, yet net change ${net.toFixed(1)} — too slow to read as motion` });
    } else {
      found.push({ check: 'hold', level: long >= HOLD_BAD ? '!' : '~', from: t(a), to: t(b), said: `${long.toFixed(1)}s: the picture barely changes (a breath or a sway counts as held)` });
    }
  }
  for (const [x, y] of piecesOf()) {
    const long = (y - x) / fps, part = steps.slice(x, y);
    const keepX = keepAt(x);
    const net = stepOf(frames[x], frames[y], keepX === null ? undefined : keepX);
    if (long >= DRIFT_MIN && Math.max(...part) < SLOW_STEP && net < DRIFT_NET) {
      found.push({ check: 'drift', level: long >= HOLD_BAD ? '!' : '~', from: t(x), to: t(y), said: `${long.toFixed(1)}s: always moving but every step small (mean ${mean(part).toFixed(2)}), net change only ${net.toFixed(1)}` });
      continue;
    }
    if (footage || long <= MOVE_MAX) continue;
    /* how the picture moved, a second at a time: a shift or a scale explaining most of the change is a pan, a scroll,
       a push or a pull; what neither explains is things changing in the picture, not one move */
    let vertical = 0, panned = 0, zoomed = 0, looked = 0;
    for (let i = x; i < y;) {
      const keep = keepAt(i) ?? undefined;
      let stride = 1, how = /** @type {'pan' | 'zoom' | null} */ (null), dx = 0, dy = 0, changed = false;
      for (;;) {
        const j = Math.min(y, i + stride), raw = stepOf(frames[i], frames[j], keep);
        if (raw >= 2 * STILL_STEP) {
          changed = true;
          const s = shiftOf(frames[i], frames[j], w, h, keep, 6);
          if ((s.dx || s.dy) && s.res < EXPLAINS * raw) { how = 'pan'; dx = s.dx; dy = s.dy; break; }
          if (zoomOf(frames[i], frames[j], w, h, keep).res < EXPLAINS * raw) { how = 'zoom'; break; }
        }
        if (stride >= MOVE_STRIDE || j >= y) break;
        stride = Math.min(MOVE_STRIDE, stride * 2);
      }
      i += Math.max(1, stride >> 1);
      looked++;
      if (!changed) continue;
      if (how === 'pan') { panned++; if (Math.abs(dy) >= 1 && Math.abs(dy) >= 2 * Math.abs(dx)) vertical++; }
      else if (how === 'zoom') zoomed++;
    }
    if (!looked) continue;
    if (long > SCROLL_MAX && vertical / looked >= 0.5) {
      found.push({ check: 'scroll', level: '!', from: t(x), to: t(y), said: `${long.toFixed(1)}s: the picture moving mostly up or down` });
    } else if ((panned + zoomed) / looked >= 0.5 && burstsOf(part) === 1) {
      found.push({ check: 'move', level: long > MOVE_BAD ? '!' : '~', from: t(x), to: t(y), said: `${long.toFixed(1)}s: one ${panned >= zoomed ? 'pan' : 'push'} that never lands` });
    }
  }
  const judgedStill = still.filter((s, i) => s === true && judged[i]).length;
  const judgedCount = judged.filter(Boolean).length;
  return { steps, still, judged, findings: found, stillShare: judgedCount ? judgedStill / judgedCount : 0 };
}
