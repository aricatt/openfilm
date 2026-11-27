// @ts-check
/**
 * Cuts snap to silence (ADu 2.0's snap-cuts, rewritten): a split or trim on a clip that is someone speaking,
 * cut inside a word, reads as 卡字、吃尾音. The cut moves to the nearest silence first — a split to the middle
 * of it, a trimmed edge so the kept side keeps a breath — and where there is no silence near, it is said in
 * one line; the edit is never refused for it.
 *
 * Opt-in per edit (`craft edit --snap`): the caller knows when the material is speech. Clips playing at other
 * than their own speed are left alone — the silence's place on the film is not the cut's place then.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

/** how far a cut may move to a silence (s), and the breath a kept side keeps */
export const SNAP_REACH = 0.6, BREATH = 0.1;
const NOISE = '-35dB', MIN_SILENCE = 0.08;
const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/**
 * Silences in [from, from + seconds] of a file's sound, as seconds of the file.
 * @param {string} file @param {number} from @param {number} seconds @param {{ ffmpeg?: string }} [o]
 * @returns {Promise<[number, number][]>}
 */
export function silencesNear(file, from, seconds, o = {}) {
  return new Promise((ok) => {
    const proc = spawn(o.ffmpeg ?? 'ffmpeg', ['-hide_banner', '-nostdin', '-ss', String(Math.max(0, from)), '-t', String(seconds), '-i', file, '-map', '0:a:0',
      '-af', `silencedetect=noise=${NOISE}:d=${MIN_SILENCE}`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', () => ok([]));
    proc.on('close', () => {
      const start = Math.max(0, from), out = /** @type {[number, number][]} */ ([]);
      let open = /** @type {number | null} */ (null);
      for (const line of err.split('\n')) {
        const s = /silence_start: (-?[\d.]+)/.exec(line), e = /silence_end: (-?[\d.]+)/.exec(line);
        if (s) open = Math.max(0, Number(s[1]));
        if (e) { out.push([r3(start + (open ?? 0)), r3(start + Number(e[1]))]); open = null; }
      }
      if (open !== null) out.push([r3(start + open), r3(start + seconds)]);
      ok(out);
    });
  });
}

/** the clip's source window and film placement, whatever the upstream shape carries */
const windowOf = (/** @type {any} */ c) => {
  const time = Array.isArray(c.time) ? c.time : [];
  return { at: Number(c.at ?? 0), from: Number(time[0] ?? c.from ?? 0), to: Number.isFinite(time[1] ?? c.to) ? Number(time[1] ?? c.to) : Infinity };
};

/**
 * The cut points of split / trim ops on clips moved into silence (the ops changed in place); what was done,
 * in the person's words. `silences` is for tests.
 * @param {string} root the project's directory
 * @param {any[]} ops the edit's operations (before translation: craft's own and Studio's as given)
 * @param {any} film the film's value (its clips looked up by id)
 * @param {{ silences?: typeof silencesNear, ffmpeg?: string }} [o]
 * @returns {Promise<string[]>}
 */
export async function snapCuts(root, ops, film, o = {}) {
  const cuts = ops.filter((op) => op && (op.op === 'split' || op.op === 'trim'));
  if (!cuts.length) return [];
  const clips = new Map();
  for (const t of film?.tracks ?? []) for (const c of t.clips ?? []) if (c.id) clips.set(c.id, c);
  const find = o.silences ?? ((file, from, seconds) => silencesNear(file, from, seconds, o.ffmpeg ? { ffmpeg: o.ffmpeg } : {}));
  /** @type {string[]} */
  const said = [];
  /** the nearest silence to a source second, and where the cut belongs in it */
  const snap = async (/** @type {string} */ file, /** @type {number} */ second, /** @type {'split' | 'start' | 'end'} */ side) => {
    const quiet = await find(file, second - SNAP_REACH, SNAP_REACH * 2);
    const near = quiet.filter(([a, b]) => b >= second - SNAP_REACH && a <= second + SNAP_REACH)
      .sort((x, y) => Math.abs((x[0] + x[1]) / 2 - second) - Math.abs((y[0] + y[1]) / 2 - second))[0];
    if (!near) return { moved: null, none: true };
    const [a, b] = near;
    const to = side === 'split' ? r3((a + b) / 2) : side === 'start' ? r3(Math.max(a, b - BREATH)) : r3(Math.min(b, a + BREATH));
    return { moved: Math.abs(to - second) < 0.005 ? null : to, none: false };
  };
  for (const op of cuts) {
    const c = clips.get(op.clip);
    if (!c || (c.speed ?? 1) !== 1) continue;
    const src = String(c.src ?? '').split(/[?#]/)[0];
    if (!src) continue;
    const file = join(root, src);
    const w = windowOf(c);
    if (op.op === 'trim') {
      for (const key of ['from', 'to']) {
        if (!Number.isFinite(op[key])) continue;
        const side = key === 'from' ? 'start' : 'end';
        const { moved, none } = await snap(file, /** @type {number} */ (op[key]), side);
        const where = `「${op.clip}」的${side === 'start' ? '开头' : '结尾'}`;
        if (none) { said.push(`${where}（素材第 ${r3(op[key])} 秒）附近没有静音，这一刀可能剪在字中间，听一下这一处`); continue; }
        if (moved == null) continue;
        if (side === 'start' && Number.isFinite(op.to) && moved >= op.to - 0.02) continue;
        if (side === 'end' && Number.isFinite(op.from) && moved <= op.from + 0.02) continue;
        op[key] = moved;
        said.push(`${where}挪到了素材第 ${moved} 秒的静音处（留一口气）`);
      }
    } else if (op.op === 'split' && Number.isFinite(op.at)) {
      /* the cut's source second: the film's `at` mapped through the clip's window (speed 1 or skipped above) */
      const second = w.from + (op.at - w.at);
      if (!(second > w.from) || second >= w.to) continue;
      const { moved, none } = await snap(file, second, 'split');
      const where = `「${op.clip}」第 ${r3(op.at)} 秒`;
      if (none) { said.push(`${where}附近没有静音，这一刀可能剪在字中间，听一下这一处`); continue; }
      if (moved == null) continue;
      const delta = moved - second;
      if (!(moved - w.from > 0.02) || moved > w.to - 0.02) continue;
      op.at = r3(op.at + delta);
      /* the halves' windows are the caller's: move the shared boundary with the cut so they stay consistent */
      if (Array.isArray(op.time) && Number.isFinite(op.time[1])) op.time = [op.time[0], r3(op.time[1] + delta)];
      if (Array.isArray(op.restTime) && Number.isFinite(op.restTime[0])) op.restTime = [r3(op.restTime[0] + delta), op.restTime[1]];
      said.push(`${where}的剪点挪到了第 ${op.at} 秒的静音处（前后各留一口气）`);
    }
  }
  return said;
}
