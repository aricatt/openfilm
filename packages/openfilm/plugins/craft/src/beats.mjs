// @ts-check
/**
 * craft beats: a song's beat grid, for cutting and animating to the music. Decoded by ffmpeg, then a short-time
 * spectrum, spectral-flux onsets, tempo by weighted autocorrelation refined by a comb, beats by dynamic programming
 * (Ellis 2007), snapped to the attacks they mark; the downbeat where kick and harmony change most (4/4); bars,
 * sections and accents from how the loudness moves.
 *
 * Pure DSP after the decode: no services, no models, deterministic.
 */
import { spawn } from 'node:child_process';

export const BEATS_VERSION = 1;
const SR = 22050, N = 2048, HOP = 256, FPS = SR / HOP;

/** Decode a sound to mono float samples at 22.05 kHz. @param {string} file @returns {Promise<Float32Array>} */
export function decodeMono(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { windowsHide: true });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (b) => chunks.push(b));
    p.stderr.on('data', (b) => { err += b; });
    p.on('error', (e) => reject(/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT' ? new Error('ffmpeg not found on the PATH') : e));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg could not read ${file}: ${err.trim().split('\n').pop() ?? code}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)).slice());
    });
  });
}

/* a radix-2 FFT, two real frames at once (packed re + i·im, teased apart by even/odd symmetry) */
function fftPlan(n) {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  return { n, rev, cos, sin };
}

function fft(plan, re, im) {
  const { n, rev, cos, sin } = plan;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sin[k * step], a = start + k, b = a + half;
        const tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

/**
 * Per hop-256 frame (centred): spectral flux of the whole spectrum and of the lows, RMS, bass and high power, and a
 * 12-bin chroma. Two real frames are transformed in one FFT.
 * @param {Float32Array} x
 */
export function frameFeatures(x) {
  const frames = Math.max(1, Math.floor(x.length / HOP) + 1);
  const pad = N / 2, plan = fftPlan(N), win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const bins = N / 2 + 1, hz = SR / N;
  const k150 = Math.ceil(150 / hz), k120 = Math.ceil(120 / hz), k6k = Math.floor(6000 / hz);
  const pc = new Int8Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) {
    const f = k * hz;
    if (f >= 55 && f <= 5000) pc[k] = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
  }
  const flux = new Float32Array(frames), low = new Float32Array(frames), rms = new Float32Array(frames);
  const bass = new Float32Array(frames), high = new Float32Array(frames), chroma = new Float32Array(frames * 12);
  let prev = new Float32Array(bins), cur = new Float32Array(bins);
  const re = new Float64Array(N), im = new Float64Array(N);
  const sample = (/** @type {number} */ i) => (i >= 0 && i < x.length ? x[i] : 0);
  const take = (/** @type {number} */ f, /** @type {Float64Array} */ out) => {
    const at = f * HOP - pad;
    let s2 = 0;
    for (let i = 0; i < N; i++) { const v = sample(at + i); out[i] = v * win[i]; s2 += v * v; }
    return Math.sqrt(s2 / N);
  };
  const a = new Float64Array(N), b = new Float64Array(N);
  const one = (/** @type {number} */ f, /** @type {{re: Float64Array, im: Float64Array}} */ X, /** @type {number} */ sign, /** @type {number} */ rmsValue) => {
    /* one of the two packed real frames: even part re, odd part im (sign picks which) */
    let fl = 0, lo = 0, ba = 0, hi = 0;
    const c = new Float64Array(12);
    for (let k = 0; k < bins; k++) {
      const j = (N - k) % N;
      const r = sign > 0 ? (X.re[k] + X.re[j]) / 2 : (X.im[k] + X.im[j]) / 2;
      const i2 = sign > 0 ? (X.im[k] - X.im[j]) / 2 : (X.re[j] - X.re[k]) / 2;
      const p = r * r + i2 * i2, m = Math.sqrt(p), lg = Math.log1p(10 * m);
      cur[k] = lg;
      const d = lg - prev[k];
      if (d > 0) { fl += d; if (k < k150) lo += d; }
      if (k < k120) ba += p; else if (k > k6k) hi += p;
      if (pc[k] >= 0) c[pc[k]] += p;
    }
    flux[f] = fl; low[f] = lo; rms[f] = rmsValue; bass[f] = ba; high[f] = hi;
    let norm = 0;
    for (let q = 0; q < 12; q++) norm += c[q] * c[q];
    norm = Math.sqrt(norm) || 1;
    for (let q = 0; q < 12; q++) chroma[f * 12 + q] = c[q] / norm;
    const t = prev; prev = cur; cur = t;
  };
  for (let f = 0; f < frames; f += 2) {
    const ra = take(f, a), rb = f + 1 < frames ? take(f + 1, b) : (b.fill(0), 0);
    for (let i = 0; i < N; i++) { re[i] = a[i]; im[i] = b[i]; }
    fft(plan, re, im);
    const X = { re, im };
    one(f, X, 1, ra);
    if (f + 1 < frames) one(f + 1, X, -1, rb);
  }
  return { frames, flux, low, rms, bass, high, chroma };
}

/** Subtract a moving mean (about a second), keep what rises above it. */
function lift(/** @type {Float32Array} */ o, width = Math.round(FPS)) {
  const out = new Float32Array(o.length), half = width >> 1;
  let sum = 0, n = 0, lo = 0, hi = -1;
  for (let i = 0; i < o.length; i++) {
    while (hi < Math.min(o.length - 1, i + half)) { sum += o[++hi]; n++; }
    while (lo < i - half) { sum -= o[lo++]; n--; }
    out[i] = Math.max(0, o[i] - sum / n);
  }
  return out;
}

const median = (/** @type {number[]} */ v) => {
  const s = [...v].sort((p, q) => p - q);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const mean = (/** @type {number[] | Float64Array} */ v) => (v.length ? v.reduce((p, q) => p + q, 0) / v.length : 0);
const db = (/** @type {number} */ p) => 10 * Math.log10(p + 1e-12);
const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/** Tempo period in frames: autocorrelation of the onset strength, weighted towards 110 BPM, refined by a comb. */
function tempoPeriod(/** @type {Float32Array} */ on) {
  const minLag = Math.floor((60 / 215) * FPS), maxLag = Math.ceil((60 / 55) * FPS);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < on.length; i++) s += on[i] * on[i - lag];
    ac[lag] = s;
  }
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * FPS) / lag, w = Math.exp(-0.5 * Math.log2(bpm / 110) ** 2);
    const score = ac[lag] * w;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  /* parabolic peak, then a comb over the whole song for the exact period */
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1], den = y0 - 2 * y1 + y2;
  const period = best + (den ? (0.5 * (y0 - y2)) / den : 0);
  const comb = (/** @type {number} */ P) => {
    let top = 0;
    for (let ph = 0; ph < P; ph += 0.5) {
      let s = 0;
      for (let t = ph; t < on.length; t += P) {
        const i = Math.round(t);
        s += on[i] + 0.5 * ((on[i - 1] ?? 0) + (on[i + 1] ?? 0));
      }
      if (s > top) top = s;
    }
    return top;
  };
  let bestP = period, bestC = comb(period);
  for (let P = period * 0.99; P <= period * 1.01; P += period * 0.0005) {
    const c = comb(P);
    if (c > bestC) { bestC = c; bestP = P; }
  }
  const ranked = [...ac.slice(minLag, maxLag + 1)].sort((p, q) => q - p);
  return { period: bestP, confidence: ranked[0] ? 1 - ranked[Math.min(5, ranked.length - 1)] / ranked[0] : 0 };
}

/** Beats by dynamic programming over the onset strength (Ellis 2007), tightness how strictly they keep the tempo. */
function trackBeats(/** @type {Float32Array} */ on, /** @type {number} */ period, tightness = 400) {
  const n = on.length;
  /* a little smoothing: a Gaussian about period/32 */
  const sd = Math.max(1, period / 32), half = Math.ceil(3 * sd), kern = [];
  for (let i = -half; i <= half; i++) kern.push(Math.exp(-0.5 * (i / sd) ** 2));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) s += (on[i + k] ?? 0) * kern[k + half];
    local[i] = s;
  }
  const std = Math.sqrt(mean([...local].map((v) => v * v))) || 1;
  for (let i = 0; i < n; i++) local[i] /= std;
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(2 * period), hi = Math.round(period / 2);
  for (let i = 0; i < n; i++) {
    let best = 0, from = -1;
    for (let j = i - lo; j <= i - hi; j++) {
      if (j < 0) continue;
      const v = score[j] - tightness * Math.log((i - j) / period) ** 2;
      if (from < 0 || v > best) { best = v; from = j; }
    }
    score[i] = local[i] + (from >= 0 ? Math.max(0, best) : 0);
    back[i] = from >= 0 && best > 0 ? from : -1;
  }
  /* end on the best-scoring frame of the last period, then follow the links back */
  let end = n - 1, top = -Infinity;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > top) { top = score[i]; end = i; }
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) beats.push(i);
  beats.reverse();
  /* drop weak beats at the ends (silence before and after the music) */
  const strong = median(beats.map((b) => local[b])) * 0.1;
  while (beats.length > 4 && local[beats[0]] < strong) beats.shift();
  while (beats.length > 4 && local[beats[beats.length - 1]] < strong) beats.pop();
  return beats;
}

/**
 * How far the beats sit from the attacks they mark (seconds, + later): the median, over beats with a clear attack,
 * of the steepest rise of log energy (128-sample windows every 32) within ±60 ms of the beat. One move for all:
 * beats stay evenly spaced.
 * @param {Float32Array} x @param {number[]} beats
 */
export function attackShift(x, beats) {
  const step = 32, w = 128, n = Math.floor((x.length - w) / step);
  if (n < 4) return 0;
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * step;
    for (let k = 0; k < w; k++) s += x[a + k] * x[a + k];
    e[i] = Math.log10(s / w + 1e-10);
  }
  /* window k covers samples [k·step, k·step + w): its rise from the one a window-width earlier is an attack at its end */
  const reach = Math.round((0.06 * SR) / step), gap = w / step, offs = [];
  for (const b of beats) {
    const c = Math.round((b * SR - w) / step);
    let best = 0, at = -1;
    for (let k = Math.max(gap, c - reach); k <= Math.min(n - 1, c + reach); k++) {
      const d = e[k] - e[k - gap];
      if (d > best) { best = d; at = k; }
    }
    if (at >= 0 && best > 0.5) offs.push((at * step + w) / SR - b);
  }
  return offs.length >= Math.max(4, beats.length / 4) ? median(offs) : 0;
}

/**
 * Where the song changes level: bar boundaries where the 4 bars after are ≥ 3 dB louder or softer than the 4 before,
 * sections at least 4 bars long. Accents: the first bar of a section coming in ≥ 3 dB louder (a drop, the band back).
 * @param {{ n: number, at: number, end: number, db: number }[]} bars
 */
export function sectionsOf(bars) {
  const d = bars.map((b) => b.db), n = bars.length;
  const avg = (/** @type {number} */ i, /** @type {number} */ j) => mean(d.slice(Math.max(0, i), Math.min(n, j)));
  const jump = bars.map((_, i) => (i >= 4 && i <= n - 4 ? avg(i, i + 4) - avg(i - 4, i) : 0));
  /** @type {number[]} */
  const cuts = [];
  for (let i = 4; i <= n - 4; i++) {
    if (Math.abs(jump[i]) < 3) continue;
    const near = jump.slice(Math.max(4, i - 2), Math.min(n - 3, i + 3)).map(Math.abs);
    if (Math.abs(jump[i]) < Math.max(...near)) continue;
    if (cuts.length && i - cuts[cuts.length - 1] < 4) {
      if (Math.abs(jump[i]) > Math.abs(jump[cuts[cuts.length - 1]])) cuts[cuts.length - 1] = i;
      continue;
    }
    cuts.push(i);
  }
  const bounds = [0, ...cuts, n];
  const means = bounds.slice(0, -1).map((a, k) => avg(a, bounds[k + 1]));
  const hi = Math.max(...means), lo = Math.min(...means), third = (hi - lo) / 3;
  const sections = bounds.slice(0, -1).map((a, k) => {
    const b = bounds[k + 1], m = means[k], mid = a + Math.max(1, Math.floor((b - a) / 2));
    const rise = b - a >= 4 && avg(mid, b) - avg(a, mid) >= 4;
    return { from: bars[a].at, to: bars[b - 1].end, bars: [bars[a].n, bars[b - 1].n], db: Math.round(m * 10) / 10,
      level: third < 1 ? 'mid' : m >= hi - third ? 'high' : m <= lo + third ? 'low' : 'mid', ...(rise ? { rise: true } : {}) };
  });
  const accents = cuts.filter((i) => jump[i] >= 3).map((i) => ({ bar: bars[i].n, at: bars[i].at, rise: Math.round(jump[i] * 10) / 10 }));
  return { sections, accents };
}

/**
 * The analysis of decoded samples: tempo, beats, downbeats, energy, bars, sections, accents, where to come in and
 * where a loop can close.
 * @param {Float32Array} x @returns {Record<string, unknown>}
 */
export function analyzeSamples(x) {
  const duration = x.length / SR;
  const F = frameFeatures(x);
  const flux = lift(F.flux), low = lift(F.low);
  const on = new Float32Array(F.frames);
  for (let i = 0; i < F.frames; i++) on[i] = flux[i] + 2 * low[i];
  const { period, confidence } = tempoPeriod(on);
  const frames = trackBeats(on, period);
  const tOf = (/** @type {number} */ f) => (f * HOP) / SR;
  if (frames.length < 8) {
    return { v: BEATS_VERSION, duration: r3(duration), bpm: null, period: null, meter: 4, confidence: 0, entry: 0, loop: null,
      beats: [], downbeats: [], energy: [], bars: [], sections: [], accents: [], note: 'no steady beat found' };
  }
  /* each beat to the strongest attack within ±60 ms, then one median shift for all (no beat jumping about) */
  const win = Math.round(0.06 * FPS), shifts = [];
  for (const f of frames) {
    let k = f;
    for (let j = Math.max(0, f - win); j <= Math.min(F.frames - 1, f + win); j++) if (on[j] > on[k]) k = j;
    const around = [...on.slice(Math.max(0, f - win), f + win + 1)];
    if (on[k] > 1.5 * median(around)) shifts.push(k - f);
  }
  const shift = shifts.length ? median(shifts) : 0;
  let beats = frames.map((f) => tOf(f + shift)).filter((t) => t >= 0 && t < duration);
  /* the beat or the off-beat: onset tracking often locks onto hi-hats between kicks; the kick is on the beat */
  const lowAt = (/** @type {number[]} */ ts) => mean(ts.map((t) => {
    const i = Math.round(t * FPS);
    let m = 0;
    for (let j = i - 2; j <= i + 2; j++) m = Math.max(m, low[j] ?? 0);
    return m;
  }));
  const halves = beats.slice(0, -1).map((b, i) => (b + beats[i + 1]) / 2);
  const onBeat = lowAt(beats), onHalf = lowAt(halves);
  const flipped = onHalf > onBeat * 1.15;
  if (flipped) beats = halves;
  /* on the attack itself: a wide spectrum hears a hit before it lands; the fine energy envelope says how far */
  const attack = attackShift(x, beats);
  /* the downbeat: the phase (of 4) where the kick and the change of harmony are strongest */
  const novelty = new Float32Array(F.frames);
  for (let i = 1; i < F.frames; i++) {
    let s = 0;
    for (let q = 0; q < 12; q++) {
      const d = F.chroma[i * 12 + q] - F.chroma[(i - 1) * 12 + q];
      s += d * d;
    }
    novelty[i] = Math.sqrt(s);
  }
  const at = (/** @type {Float32Array} */ series, /** @type {number} */ t) => {
    const i = Math.round(t * FPS);
    let m = 0;
    for (let j = i - 2; j <= i + 2; j++) m = Math.max(m, series[j] ?? 0);
    return m;
  };
  const z = (/** @type {number[]} */ v) => {
    const m = mean(v), s = Math.sqrt(mean(v.map((u) => (u - m) ** 2))) || 1;
    return v.map((u) => (u - m) / s);
  };
  const zl = z(beats.map((b) => at(low, b))), zc = z(beats.map((b) => at(novelty, b)));
  const phaseScore = [0, 1, 2, 3].map((p) => {
    const v = [];
    for (let i = p; i < beats.length; i += 4) v.push(zl[i] + zc[i]);
    return mean(v);
  });
  const phase = phaseScore.indexOf(Math.max(...phaseScore));
  const ranked = [...phaseScore].sort((p, q) => q - p);
  /* beats and downbeats move onto the attacks the phase was read without */
  if (attack) beats = beats.map((b) => b + attack);
  const keep = beats.map((t) => t >= 0 && t < duration);
  const downbeats = beats.filter((t, i) => i % 4 === phase && keep[i]);
  beats = beats.filter((_, i) => keep[i]);
  /* per beat energy (0–1 by the 95th percentile) */
  const meanOver = (/** @type {Float32Array} */ series, /** @type {number} */ a, /** @type {number} */ b) => {
    const i = Math.max(0, Math.round(a * FPS)), j = Math.min(series.length, Math.max(i + 1, Math.round(b * FPS)));
    let s = 0;
    for (let k = i; k < j; k++) s += series[k];
    return s / (j - i);
  };
  const edges = [...beats, duration];
  const beatRms = beats.map((b, i) => meanOver(F.rms, b, edges[i + 1]));
  const p95 = [...beatRms].sort((p, q) => p - q)[Math.floor(0.95 * (beatRms.length - 1))] || 1;
  const energy = beatRms.map((v) => r3(Math.min(1, v / p95)));
  /* bars: from each downbeat to the next; a short head before the first downbeat is bar 0 */
  const barStarts = downbeats.length ? downbeats : [0];
  const power = F.rms.map((v) => v * v);
  const bars = barStarts.map((a, i) => {
    const b = barStarts[i + 1] ?? Math.min(duration, a + (4 * period) / FPS);
    const pow = meanOver(power, a, b);
    return { n: i + 1, at: r3(a), end: r3(b), db: Math.round(db(pow) * 10) / 10,
      bassDb: Math.round(db(meanOver(F.bass, a, b) / (N * N)) * 10) / 10,
      hiDb: Math.round(db(meanOver(F.high, a, b) / (N * N)) * 10) / 10 };
  });
  const barDb = bars.map((b) => b.db), top = Math.max(...barDb), floor = Math.min(...barDb);
  for (const b of bars) /** @type {Record<string, unknown>} */ (b).energy = r3(top > floor ? (b.db - floor) / (top - floor) : 1);
  const { sections, accents } = sectionsOf(bars);
  /* entry: the first downbeat whose next 8 beats are at least of median energy (past a fade-in intro) */
  const med = median(energy);
  let entry = downbeats[0] ?? 0;
  for (const d of downbeats) {
    const i = beats.indexOf(d);
    if (i + 8 <= energy.length && mean(energy.slice(i, i + 8)) >= med) { entry = d; break; }
  }
  const tail = downbeats.filter((d) => d <= duration - 4);
  const bpm = (60 * FPS) / period;
  const loop = tail.length && tail[tail.length - 1] - entry >= (8 * 4 * 60) / bpm ? [r3(entry), r3(tail[tail.length - 1])] : null;
  return {
    v: BEATS_VERSION, duration: r3(duration), bpm: Math.round(bpm * 100) / 100, period: Math.round((60 / bpm) * 1e5) / 1e5,
    meter: 4, confidence: r3(confidence), downbeatConfidence: r3(ranked[0] - ranked[1]), phaseFlipped: flipped,
    shiftMs: Math.round(((shift * HOP) / SR + attack) * 10000) / 10,
    entry: r3(entry), loop, beats: beats.map(r3), downbeats: downbeats.map(r3), energy, bars, sections, accents,
  };
}

/** Analyse a sound file. @param {string} file */
export async function analyzeBeats(file) {
  return analyzeSamples(await decodeMono(file));
}

/** The analysis in a few lines, for a person or an agent. @param {Record<string, any>} r */
export function beatsSummary(r) {
  if (!r.bpm) return [`♪ no steady beat found (${r.duration}s)`];
  const t = (/** @type {number} */ s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  return [
    `♪ ${r.bpm} BPM · beat ${r.period}s · ${r.bars.length} bars of 4 · first downbeat ${t(r.downbeats[0] ?? 0)} · comes in at ${t(r.entry)}${r.loop ? ` · loops ${t(r.loop[0])}–${t(r.loop[1])}` : ''}`,
    ...r.sections.map((/** @type {any} */ s) => `  bars ${String(s.bars[0]).padStart(3)}–${String(s.bars[1]).padEnd(3)} ${t(s.from)}–${t(s.to)}  ${String(s.level).padEnd(4)} ${s.db.toFixed(1)} dB${s.rise ? ' · builds' : ''}`),
    r.accents.length ? `  accents: ${r.accents.map((/** @type {any} */ a) => `bar ${a.bar} (${t(a.at)}, +${a.rise} dB)`).join(', ')}` : '  accents: none (no section comes in 3 dB louder)',
  ];
}
