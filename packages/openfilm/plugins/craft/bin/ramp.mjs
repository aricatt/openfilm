#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft ramp`: the film's speed curves, checked and said. A curve that does not read falls back to
 * linear playback silently in the render — so it is an error here, not a surprise there.
 *
 *   openfilm craft ramp            what declares a speed curve (data-craft-ramp on a video), each checked
 *
 * Declaring is an attribute on the clip, written by hand or by craft edit:
 *   {"op":"attr","clip":"v1","name":"data-craft-ramp","value":"hero"}
 *
 * Exit status: 0 all read (or none declared), 1 a declaration does not read, 2 not a project.
 */
import { lookProject } from '../../../src/plugin-look.mjs';
import { readProjectFilm } from '../../../studio/server/film.mjs';
import { RAMP_CURVES, rampPoints, RAMP_ATTR } from '../src/ramp.mjs';

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h')) {
  console.log(`openfilm craft ramp — the film's speed curves, checked and said

  declared on a video clip in film.html:  data-craft-ramp="hero"
  presets: ${Object.keys(RAMP_CURVES).join(', ')} — or the points themselves: '[[0,1],[0.5,0.2],[1,1]]'

  the curve is normalized: the clip stays as long on the film and shows the same source seconds,
  only shared out unevenly. A curved clip is not heard (its sound would stretch unevenly).`);
  process.exit(0);
}

const root = lookProject([]);
if (!root) {
  console.error('✗ not in a project (no film.html here or above)');
  process.exit(2);
}
const film = await readProjectFilm(root);
if (!film.value) {
  console.error(`✗ film.html does not read: ${film.problems[0] ?? ''}`);
  process.exit(2);
}

let declared = 0, bad = 0;
for (const track of film.value.tracks ?? []) {
  for (const clip of track.clips ?? []) {
    const value = clip.attrs?.[RAMP_ATTR];
    if (value === undefined) continue;
    declared++;
    const points = rampPoints(value);
    if (!points) {
      bad++;
      console.error(`✗ ${clip.id}: data-craft-ramp does not read: ${JSON.stringify(value)} — a preset (${Object.keys(RAMP_CURVES).join(', ')}) or points [[u, speed], …] from u=0 to u=1`);
      continue;
    }
    const kind = /[^?#]*\.(mp4|mov|m4v|webm|mkv|avi)([?#]|$)/i.test(String(clip.src)) ? 'video' : 'not a video';
    console.log(`✓ ${clip.id} (${kind}): ${value in RAMP_CURVES ? value : `custom, ${points.length} points`} — speeds ${Math.min(...points.map((p) => p[1]))}× … ${Math.max(...points.map((p) => p[1]))}×`);
    if (kind === 'not a video') console.error(`  ! ${clip.id}: a speed curve belongs on a video clip — ${clip.src} is not one`);
  }
}
if (!declared) console.log(`no speed curves declared — data-craft-ramp="hero" on a video clip; presets: ${Object.keys(RAMP_CURVES).join(', ')}`);
process.exit(bad ? 1 : 0);
