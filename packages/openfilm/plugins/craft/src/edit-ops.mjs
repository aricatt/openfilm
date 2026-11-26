// @ts-check
/**
 * craft edit operations, said as what they change (a clip, a time, a track) and worked out into the operations
 * Studio writes (studio/server/ops.mjs). Pure: given the film's value and the operations, the operations Studio
 * applies come out — nothing read, nothing written.
 *
 * craft's own operations (the compound ones Studio has no one operation for):
 *   trim    { clip, from, to }        the part of its file a clip plays (source seconds; null: to the file's end)
 *   fade    { clip, in, out }         its fades in seconds (0 takes one off)
 *   attr    { clip, name, value }     a data-* / aria-* attribute on the clip (null takes it off)
 *   replace { clip, src, keep? }      another file in the clip, the same kind; "keep":"time" keeps the trim
 *   shift   { from, by, extend? }     everything from a film second on later (by < 0: earlier); extend: the clip
 *                                     across `from` plays that much longer
 *   ripple  { clip, by, length? }     the clip that much longer at its end (by < 0: shorter); what starts at or
 *                                     after its end moves by as much. length: the clip's film seconds when its
 *                                     end cannot be told from the film (a sound or video with no trim)
 * Every operation Studio knows (set, move, insert, remove, split, props, fields, track, track-layout, reorder,
 * captions, uncaptions, keyframes, stage) passes through as it is.
 */
import { EditError } from '../../../studio/server/ops.mjs';

const STUDIO_OPS = new Set(['set', 'move', 'insert', 'remove', 'split', 'props', 'fields', 'track', 'track-layout', 'reorder', 'captions', 'uncaptions', 'keyframes', 'stage']);
const r3 = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
const fin = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n);

/** Where every clip is: id → { t, clip }. @param {import('../../../studio/server/ops.mjs').FilmValue} value */
const byId = (value) => {
  const map = new Map();
  value.tracks.forEach((track, t) => track.clips.forEach((clip) => { if (clip.id) map.set(clip.id, { t, clip }); }));
  return map;
};

/** A clip's film seconds: where it starts (`at`, 0 when absent). */
const startOf = (/** @type {Record<string, unknown>} */ clip) => (fin(clip.at) ? /** @type {number} */ (clip.at) : 0);

/** The trim of a clip in source seconds [start, end): its `time` pair or its start/end props. */
function trimOf(/** @type {Record<string, unknown>} */ clip) {
  const time = Array.isArray(clip.time) ? clip.time : [];
  const start = fin(time[0]) ? /** @type {number} */ (time[0]) : fin(clip.start) ? /** @type {number} */ (clip.start) : 0;
  const end = fin(time[1]) ? /** @type {number} */ (time[1]) : fin(clip.end) ? /** @type {number} */ (clip.end) : null;
  return { start, end };
}

/** A clip's speed (1 when absent). */
const speedOf = (/** @type {Record<string, unknown>} */ clip) => (fin(clip.speed) && /** @type {number} */ (clip.speed) > 0 ? /** @type {number} */ (clip.speed) : 1);

/**
 * How long a clip plays on the film, in seconds: from its trim and speed, or the file's probed length when the
 * trim has no end (the clip plays its file to the end). Null when it cannot be told.
 */
function filmLength(/** @type {Record<string, unknown>} */ clip, /** @type {number | undefined} */ probed) {
  const { start, end } = trimOf(clip);
  const speed = speedOf(clip);
  if (end != null && end > start) return (end - start) / speed;
  if (fin(probed) && /** @type {number} */ (probed) > start) return (/** @type {number} */ (probed) - start) / speed;
  return null;
}

/**
 * Work craft operations out into Studio operations. Throws EditError (kind 'invalid') naming what is wrong;
 * nothing is half-translated — either the whole list comes out or nothing does.
 * @param {import('../../../studio/server/ops.mjs').FilmValue} value the film as it is now
 * @param {object[]} ops craft operations (and Studio operations passed through)
 * @param {{ lengths?: Record<string, number> }} [facts] probed file lengths by src, for clips with no trim end
 * @returns {import('../../../studio/server/ops.mjs').Op[]}
 */
export function translateOps(value, ops, facts = {}) {
  if (!Array.isArray(ops) || !ops.length) throw new EditError('an edit needs at least one operation', 'invalid');
  const clips = byId(value);
  const need = (/** @type {string} */ id) => {
    const found = clips.get(id);
    if (!found) throw new EditError(`clip "${id}" is not in the film`, 'invalid');
    return found;
  };
  /** @type {import('../../../studio/server/ops.mjs').Op[]} */
  const out = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object' || typeof /** @type {{op?:unknown}} */ (op).op !== 'string') throw new EditError('every operation needs an "op"', 'invalid');
    const o = /** @type {Record<string, unknown> & { op: string }} */ (op);
    if (STUDIO_OPS.has(o.op)) { out.push(/** @type {never} */ (o)); continue; }
    switch (o.op) {
      case 'trim': {
        need(/** @type {string} */ (o.clip));
        const from = fin(o.from) ? /** @type {number} */ (o.from) : 0;
        const to = fin(o.to) ? /** @type {number} */ (o.to) : null;
        if (to != null && to <= from) throw new EditError(`trim ${o.clip}: to (${to}) has to be after from (${from})`, 'invalid');
        out.push({ op: 'props', edits: [
          { clip: /** @type {string} */ (o.clip), prop: 'start', value: r3(from) },
          { clip: /** @type {string} */ (o.clip), prop: 'end', value: to == null ? null : r3(to) },
        ] });
        break;
      }
      case 'fade': {
        need(/** @type {string} */ (o.clip));
        const fi = fin(o.in) ? Math.max(0, /** @type {number} */ (o.in)) : 0;
        const fo = fin(o.out) ? Math.max(0, /** @type {number} */ (o.out)) : 0;
        out.push({ op: 'props', edits: [{ clip: /** @type {string} */ (o.clip), prop: 'fade', value: (fi || fo) ? [r3(fi), r3(fo)] : null }] });
        break;
      }
      case 'attr': {
        const { clip } = need(/** @type {string} */ (o.clip));
        if (typeof o.name !== 'string' || !/^(data|aria)-[\w-]+$|^(alt|title|lang|dir)$/.test(o.name)) {
          throw new EditError(`attr: "${o.name}" cannot be set this way — alt, title, lang, dir, data-* or aria-*`, 'invalid');
        }
        const attrs = { ...(/** @type {Record<string, string>} */ (clip.attrs) ?? {}) };
        if (o.value === null || o.value === undefined) delete attrs[o.name];
        else attrs[o.name] = String(o.value);
        out.push({ op: 'fields', clip: /** @type {string} */ (o.clip), fields: { attrs: Object.keys(attrs).length ? attrs : null } });
        break;
      }
      case 'replace': {
        const { clip } = need(/** @type {string} */ (o.clip));
        if (typeof o.src !== 'string' || !o.src) throw new EditError('replace needs a src', 'invalid');
        const oldExt = String(clip.src).replace(/[?#].*$/, '').split('.').pop();
        const newExt = o.src.replace(/[?#].*$/, '').split('.').pop();
        if (oldExt !== newExt) throw new EditError(`replace ${o.clip}: ${o.src} is not the same kind of file as ${clip.src}`, 'invalid');
        /** @type {Record<string, unknown>} */
        const fields = { src: o.src };
        if (o.keep !== 'time') { fields.start = null; fields.end = null; fields.time = null; }
        out.push({ op: 'fields', clip: /** @type {string} */ (o.clip), fields });
        break;
      }
      case 'shift': {
        if (!fin(o.from) || !fin(o.by) || o.by === 0) throw new EditError('shift needs from (a film second) and by (seconds, not 0)', 'invalid');
        const from = /** @type {number} */ (o.from);
        const by = /** @type {number} */ (o.by);
        /** @type {{ clip: string, prop: string, value: unknown }[]} */
        const edits = [];
        for (const track of value.tracks) {
          for (const clip of track.clips) {
            if (!clip.id) continue;
            const at = startOf(clip);
            /* a clip starting exactly at `from` moves (a millisecond either side too) */
            if (at >= from - 0.001) {
              const to = at + by;
              if (to < -0.001) throw new EditError(`shift: ${clip.id} would start before the film's start`, 'invalid');
              edits.push({ clip: clip.id, prop: 'at', value: r3(Math.max(0, to)) });
            }
          }
        }
        if (typeof o.extend === 'string') {
          const { clip } = need(o.extend);
          const at = startOf(clip);
          const length = filmLength(clip, facts.lengths?.[/** @type {string} */ (clip.src)]);
          if (length == null) throw new EditError(`shift: how long ${o.extend} plays cannot be told — give it a trim first`, 'invalid');
          const end = at + length;
          if (!(at < from - 0.001 && end > from + 0.001)) throw new EditError(`shift: ${o.extend} does not play across ${from}`, 'invalid');
          if (by < 0) throw new EditError('shift: extend only stretches (by > 0)', 'invalid');
          const { end: trimEnd } = trimOf(clip);
          if (trimEnd == null) throw new EditError(`shift: ${o.extend} has no trim end to stretch — trim it first`, 'invalid');
          edits.push({ clip: o.extend, prop: 'end', value: r3(trimEnd + by * speedOf(clip)) });
        }
        if (!edits.length) throw new EditError(`shift: nothing starts at or after ${from}`, 'invalid');
        out.push({ op: 'props', edits });
        break;
      }
      case 'ripple': {
        const { clip } = need(/** @type {string} */ (o.clip));
        const by = fin(o.by) && o.by !== 0 ? /** @type {number} */ (o.by) : fin(o.length) ? null : null;
        if (!fin(o.by) || o.by === 0) throw new EditError('ripple needs by (seconds, not 0): the clip that much longer at its end', 'invalid');
        void by;
        const amount = /** @type {number} */ (o.by);
        const at = startOf(clip);
        const length = filmLength(clip, facts.lengths?.[/** @type {string} */ (clip.src)] ?? (fin(o.length) ? /** @type {number} */ (o.length) : undefined));
        if (length == null) throw new EditError(`ripple: how long ${o.clip} plays cannot be told — say "length" (its film seconds) or trim it first`, 'invalid');
        if (length + amount <= 0.001) throw new EditError(`ripple: ${o.clip} would be nothing left`, 'invalid');
        const endAt = at + length;
        const { start, end: trimEnd } = trimOf(clip);
        const speed = speedOf(clip);
        /** @type {{ clip: string, prop: string, value: unknown }[]} */
        const edits = [];
        /* the clip itself: its trim end grows by as much in source seconds; a clip with no trim end gets one written */
        if (trimEnd != null) edits.push({ clip: /** @type {string} */ (o.clip), prop: 'end', value: r3(trimEnd + amount * speed) });
        else edits.push({ clip: /** @type {string} */ (o.clip), prop: 'end', value: r3(start + (length + amount) * speed) });
        /* what starts at or after its end moves up as much, on every track */
        for (const track of value.tracks) {
          for (const other of track.clips) {
            if (!other.id || other.id === o.clip) continue;
            const otherAt = startOf(other);
            if (otherAt >= endAt - 0.001) {
              const to = otherAt + amount;
              if (to < -0.001) throw new EditError(`ripple: ${other.id} would start before the film's start`, 'invalid');
              edits.push({ clip: other.id, prop: 'at', value: r3(Math.max(0, to)) });
            }
          }
        }
        out.push({ op: 'props', edits });
        break;
      }
      default:
        throw new EditError(`unknown operation ${o.op}`, 'invalid');
    }
  }
  return out;
}

/**
 * The srcs craft operations need probed (a ripple's or shift's clip whose trim has no end), so the caller can ask
 * ffprobe and call again with `lengths`. Pictures are never probed (they have no length of their own).
 * @param {import('../../../studio/server/ops.mjs').FilmValue} value @param {object[]} ops
 * @returns {string[]} srcs to probe
 */
export function lengthsNeeded(value, ops) {
  const clips = byId(value);
  const srcs = new Set();
  for (const op of ops) {
    const o = /** @type {Record<string, unknown> & { op?: string }} */ (op ?? {});
    if (!o.op || !['ripple', 'shift'].includes(o.op)) continue;
    const id = o.op === 'ripple' ? /** @type {string} */ (o.clip) : typeof o.extend === 'string' ? o.extend : null;
    if (!id) continue;
    const found = clips.get(id);
    if (!found) continue;
    const { end } = trimOf(found.clip);
    if (end == null && typeof found.clip.src === 'string' && !/\.(png|jpe?g|webp|gif|svg|avif)([?#]|$)/i.test(found.clip.src)) {
      srcs.add(found.clip.src.split('#')[0]);
    }
  }
  return [...srcs];
}
