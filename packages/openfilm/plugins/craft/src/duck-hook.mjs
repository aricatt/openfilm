// @ts-check
/**
 * The render hook: chains attached to the mix's clips from what the film's sound clips declare
 * (`data-craft-duck` on an <audio>). Called from filmSound (src/shared.mjs, the one place a film's sounds
 * become the mix's clips) — the only touch of upstream's code, and additive: nothing declared, nothing changes.
 *
 * The processors themselves are registered by importing duck-processor.mjs here, so a film that declares
 * ducking has its processor defined in this realm before its chain is built.
 */
import { duckParams, GRID } from './duck-curve.mjs';
import { contentIdentity, curveCached, measurePowerCached, placePower } from './duck-analyze.mjs';
import './duck-processor.mjs';
import { join } from 'node:path';

export const DUCK_ATTR = 'data-craft-duck';

/**
 * @param {object[]} clips the mix's clips as soundSources made them (with `id`/`attrs` carried through),
 *   their `at`/`from` on the window's time (shared.mjs: the film's less `from`)
 * @param {{ root: string, from: number, signal?: AbortSignal }} where
 * @returns {Promise<object[]>} the same clips, chains on the ones that declared ducking
 */
export async function attachDuckChains(clips, { root, from, signal }) {
  const ducking = [];
  for (const c of clips) {
    const raw = c.attrs?.[DUCK_ATTR];
    if (raw === undefined) continue;
    let parsed = null;
    if (raw.trim()) {
      try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`${c.id ?? c.file}: data-craft-duck is not JSON: ${/** @type {Error} */ (e).message}`); }
    }
    ducking.push({ clip: c, params: duckParams(parsed) });
  }
  if (!ducking.length) return clips;

  const cacheDir = join(root, '.film', 'craft-duck');
  /* each file decoded once for everything asked of it in this pass, and only files that are followed:
     the music itself is never measured */
  /** @type {Map<string, Promise<Float64Array>>} */
  const measured = new Map();
  const measure = (file) => {
    if (!measured.has(file)) measured.set(file, measurePowerCached(file, cacheDir, signal));
    return measured.get(file);
  };
  /** the clip's power and placement on the film's time: the region it plays measured, its window `at` put back */
  const place = async (c) => {
    const speed = c.speed && c.speed !== 1 ? c.speed : 1;
    const all = await measure(c.file);
    const a = Math.floor(c.from / GRID);
    const z = c.to != null ? Math.min(all.length, Math.ceil(c.to / GRID)) : all.length;
    const power = all.slice(Math.min(a, all.length), z);
    return { clip: c, absAt: from + c.at, len: (power.length * GRID) / speed, power };
  };

  for (const { clip, params } of ducking) {
    const rest = clips.filter((c) => c !== clip && !c.attrs?.[DUCK_ATTR]
      && (params.under.length ? params.under.includes(c.id) : true));
    if (!rest.length) continue;
    const follows = await Promise.all(rest.map(place));
    let end = 0;
    for (const p of follows) end = Math.max(end, p.absAt + p.len);
    const frames = Math.ceil(end / GRID) + 2;
    const power = new Float64Array(frames);
    const keyFiles = [];
    for (const p of follows) {
      keyFiles.push([contentIdentity(p.clip.file), p.clip.from, p.clip.to, p.absAt]);
      placePower(power, p.power, p.absAt, p.clip.speed && p.clip.speed !== 1 ? p.clip.speed : 1);
    }
    const gains = await curveCached({
      cacheDir,
      keyMaterial: { params, follows: keyFiles, v: 1 },
      power,
      frames,
      params: clip.attrs[DUCK_ATTR].trim() ? JSON.parse(clip.attrs[DUCK_ATTR]) : null,
    });
    clip.chain = [{ name: 'craft-duck', gains, at: from + clip.at }];
  }
  return clips;
}
