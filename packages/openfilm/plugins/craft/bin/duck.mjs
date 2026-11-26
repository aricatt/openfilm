#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft duck`: the film's ducking, checked and said.
 *
 *   openfilm craft duck            what declares ducking (data-craft-duck on a sound or a video), its parameters
 *                                  read, what it follows, what is wrong with it
 *
 * Ducking itself needs no command: declared on a clip, it is measured and multiplied into the film's sound when
 * the film is rendered or looked at (src/shared.mjs filmSound, plugins/craft/src/duck-hook.mjs). This command is
 * how an agent checks what it wrote before rendering: a declaration that does not read is an error here, not a
 * surprise in a render.
 *
 * Exit status: 0 done, 1 the film or the check failed, 2 not a project or a wrong command.
 */
import { lookProject } from '../../../src/plugin-look.mjs';
import { readProjectFilm } from '../../../studio/server/film.mjs';
import { duckParams, DEFAULTS } from '../src/duck-curve.mjs';
import { DUCK_ATTR } from '../src/duck-hook.mjs';

const HELP = `openfilm craft duck — the film's ducking, checked and said

  declared on a sound or a video in film.html:
    <audio id="music" src="music.mp3#t=0,60" data-craft-duck='{"speech":-17}'/>

  under      clip ids it follows (default: every other sound)
  speech     gain while they speak, dB (${DEFAULTS.speech})      pause   between their words, dB (${DEFAULTS.pause})
  ratio      how hard a voice over the threshold pushes down (${DEFAULTS.ratio})
  threshold  what counts as speaking, dBFS (${DEFAULTS.threshold})
  attack     seconds down (${DEFAULTS.attack})   release  seconds back up (${DEFAULTS.release})   hold  after a word (${DEFAULTS.hold})
  from / to  the film seconds it ducks within (default: all of it)
  over       [[from, to, dB], …] windows set to a level whatever is said
`;

function fail(what, code = 1) {
  console.error(`✗ ${what}`);
  process.exit(code);
}

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}
if (words.length) fail(`takes no words but --help (${words.join(' ')} given)`, 2);

const root = lookProject([]);
if (!root) fail('not in a project (no film.html here or above)', 2);

const film = await readProjectFilm(root);
if (!film.value) fail(film.problems[0] ?? 'film.html does not read');

/** Every sound-bearing clip of the film: its sounds and its videos (a video's own sound is heard). */
const sounding = [];
for (const track of film.value.tracks ?? []) {
  for (const clip of track.clips ?? []) {
    if (clip.src === undefined) continue;
    if (!('volume' in clip || (clip.overrides ?? []).length || clip.attrs?.[DUCK_ATTR] !== undefined)) continue;
    sounding.push(clip);
  }
}

const ducking = sounding.filter((c) => c.attrs?.[DUCK_ATTR] !== undefined);
if (!ducking.length) {
  console.log('nothing ducks: no sound or video carries data-craft-duck');
  console.log('declare it as  data-craft-duck=\'{}\'  on the music’s <audio> — `openfilm craft duck --help` says what it takes');
  process.exit(0);
}

let bad = 0;
for (const clip of ducking) {
  const id = clip.id ?? clip.src;
  const raw = clip.attrs[DUCK_ATTR];
  let params;
  try {
    params = duckParams(raw.trim() ? JSON.parse(raw) : null);
  } catch (e) {
    console.log(`✗ ${id}: ${/** @type {Error} */ (e).message}`);
    bad += 1;
    continue;
  }
  const unknown = params.under.filter((u) => !sounding.some((c) => c.id === u && c !== clip));
  if (unknown.length) {
    console.log(`✗ ${id}: under names no sounding clip of the film: ${unknown.join(', ')}`);
    bad += 1;
    continue;
  }
  const follows = params.under.length
    ? sounding.filter((c) => c !== clip && params.under.includes(c.id)).map((c) => c.id)
    : sounding.filter((c) => c !== clip && c.attrs?.[DUCK_ATTR] === undefined).map((c) => c.id ?? c.src);
  if (!follows.length) {
    console.log(`! ${id}: nothing to follow — no other sound in the film, ducking does nothing`);
    continue;
  }
  const window = params.from > 0 || params.to < Infinity ? `, within ${params.from}–${params.to === Infinity ? 'end' : params.to} s` : '';
  console.log(`✓ ${id}: speech ${params.speech} dB, pause ${params.pause} dB, ratio ${params.ratio}, under ${follows.join(', ')}${window}`);
}
process.exit(bad ? 1 : 0);
