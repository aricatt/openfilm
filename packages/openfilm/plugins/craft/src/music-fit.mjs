// @ts-check
/**
 * The music cut to the story (ADu's adudir-music-fit, re-implemented): one file played in pieces,
 * each cut starting where the story wants it — a bar's downbeat on a moment, a quiet stretch from
 * a cut on, the music's own end as the film stops. Worked out from the beats grid (craft beats),
 * as the editor would by hand. Pure: the caller reads the beats and says the times.
 *
 *   hits: [ { at: 0, bar: 5, on: 8 },        from the film's start, so that bar 5 lands on second 8
 *           { at: 12, bar: 41 },             at second 12, bar 41 (lands right at the cut)
 *           { at: 20, quiet: true },         the next quiet stretch of the music from the cut on
 *           { at: 26, src: 211.2 },          a second of the file as it is
 *           { at: 30, tail: true } ]         so the music's own end comes as the music stops
 */

const r3 = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;

/** A bar's (or one of its beats') second in the file; throws when the music has no such bar. */
function barSecond(beats, bar, beat = 1) {
  const b = beats.bars?.find((/** @type {any} */ x) => x.n === bar);
  if (!b) throw new Error(`the music has no bar ${bar} (bars 1–${beats.bars?.length ?? 0})`);
  if (beat === 1) return b.at;
  const inBar = (beats.beats ?? []).filter((/** @type {number} */ t) => t >= b.at - 1e-6 && t < b.end - 1e-6);
  if (!inBar[beat - 1]) throw new Error(`bar ${bar} has no beat ${beat}`);
  return inBar[beat - 1];
}

/**
 * The pieces the music plays: one per hit, each from its cut to the next (the last to `end`).
 * @param {any} beats the beats grid (craft beats --json: duration, bars, beats, sections)
 * @param {any[]} hits the cuts, as above
 * @param {{ end: number, time?: (at: number | string) => number, fade?: number, out?: number, first?: number }} o
 *   `time`: a cue's film second when hits name cues; numbers pass through (default: the number itself)
 * @returns {{ at: number, from: number, to: number, fadeIn: number, fadeOut: number, said: string }[]}
 */
export function planMusic(beats, hits, o) {
  if (!Array.isArray(hits) || !hits.length) throw new Error('hits: at least one cut ({"at": 0, "bar": 1})');
  const time = o.time ?? ((x) => (typeof x === 'number' ? x : NaN));
  const fade = o.fade ?? 0.08, out = o.out ?? 1.6;
  const cuts = hits.map((h, i) => {
    const at = time(h.at);
    if (!Number.isFinite(at) || at < 0) throw new Error(`hit ${i + 1}: at is a film second`);
    const kinds = [h.bar !== undefined, h.quiet === true || h.section !== undefined, h.src !== undefined, h.tail === true].filter(Boolean).length;
    if (kinds !== 1) throw new Error(`hit ${i + 1}: one of bar (with on, or landing at the cut), quiet / section, src, tail`);
    let from, said;
    if (h.bar !== undefined) {
      const land = h.on !== undefined ? time(h.on) : at;
      if (!Number.isFinite(land)) throw new Error(`hit ${i + 1}: on is a film second`);
      from = barSecond(beats, h.bar, h.beat ?? 1) - (land - at);
      said = `bar ${h.bar}${h.beat > 1 ? ` beat ${h.beat}` : ''} ${h.on === undefined ? 'at the cut' : `on ${r3(land)}`}`;
    } else if (h.src !== undefined) {
      from = h.src; said = `the file's ${r3(h.src)} s`;
    } else if (h.tail) {
      if (i + 1 !== hits.length) throw new Error(`hit ${i + 1}: tail is the last cut (the music's end comes as it stops)`);
      from = beats.duration - (o.end - at); said = 'its last bars, to its end';
    } else {
      const sections = (beats.sections ?? []).filter((/** @type {any} */ s) => s.level === 'low');
      const s = h.section !== undefined ? (beats.sections ?? [])[h.section - 1] : sections[0];
      if (!s) throw new Error(`hit ${i + 1}: the music has no ${h.section !== undefined ? `section ${h.section}` : 'quiet stretch'} (craft beats lists its sections)`);
      from = s.from; said = `quiet: section bars ${s.bars[0]}–${s.bars[1]}`;
    }
    if (from < 0) throw new Error(`hit ${i + 1}: ${said} would start ${r3(-from)} s before the music does; cut later, or a later bar`);
    return { at, from, said };
  });
  for (let i = 1; i < cuts.length; i++) if (!(cuts[i].at > cuts[i - 1].at + 0.05)) throw new Error(`hit ${i + 1} cuts at ${r3(cuts[i].at)} s, not after hit ${i} (${r3(cuts[i - 1].at)} s)`);
  if (!(o.end > cuts[cuts.length - 1].at)) throw new Error(`the music ends at ${r3(o.end)} s, before the last cut`);
  return cuts.map((c, i) => {
    const until = i + 1 < cuts.length ? cuts[i + 1].at : o.end, to = c.from + (until - c.at);
    if (to > beats.duration + 1e-3) throw new Error(`piece ${i + 1} (${c.said}) runs ${r3(to - beats.duration)} s past the music's end: cut again before ${r3(c.at + beats.duration - c.from)} s`);
    return { at: r3(c.at), from: r3(c.from), to: r3(to), fadeIn: i === 0 ? (o.first ?? 0.3) : 0, fadeOut: i + 1 < cuts.length ? fade : out, said: c.said };
  });
}
