#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft edit`: the film changed by what it is (clips, times, tracks), not by text patches — every edit
 * checked whole before anything is written, said as what it changed, and kept so it can be taken back.
 *
 *   openfilm craft edit '<op or [ops]>' [--why "…"] [--dry-run]
 *   openfilm craft edit --undo [--force]        take the last edit back (refused when the film changed since)
 *   openfilm craft edit --log                   the edits kept
 *
 * The operations are craft's own compound ones (trim, fade, attr, replace, shift, ripple — src/edit-ops.mjs) plus
 * every operation Studio knows (set, move, insert, remove, split, props, fields, track, track-layout, reorder,
 * captions, uncaptions, keyframes, stage), passed through as they are. All of a list is written or none of it:
 * the film Studio would write is read back as a film first, and a film.html that does not read is never written
 * over. Written as Studio writes (studio/server/film.mjs editProjectFilm): over the text it was read as.
 *
 * Exit status: 0 done, 1 the edit failed (nothing written), 2 not a project or a wrong command.
 */
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { lookProject } from '../../../src/plugin-look.mjs';
import { editProjectFilm, readProjectFilm } from '../../../studio/server/film.mjs';
import { readFilm, readFilmFile } from '../../../src/film-doc.mjs';
import { translateOps, lengthsNeeded } from '../src/edit-ops.mjs';
import { recordEdit, undoEdit, dropSnapshot, readLog, hashOf } from '../src/edit-journal.mjs';

const HELP = `openfilm craft edit — the film changed by what it is, kept so it can be taken back

  openfilm craft edit '<op>' | '[<op>, …]' [--why "…"] [--dry-run]
  openfilm craft edit --undo [--force]
  openfilm craft edit --log

craft operations:
  {"op":"trim","clip":"vo-1","from":0.3,"to":4.1}        the part of its file a clip plays (source seconds)
  {"op":"fade","clip":"m1","in":0.3,"out":1.6}           its fades in seconds (0 takes one off)
  {"op":"attr","clip":"m1","name":"data-craft-duck","value":"{…}"}   an attribute (null takes it off)
  {"op":"replace","clip":"sfx-1","src":"assets/whoosh.wav"}          another file, the same kind ("keep":"time" keeps the trim)
  {"op":"shift","from":42,"by":1.5,"extend":"s07"}       everything from 42 s on later by 1.5 s; "extend": the clip
                                                       across 42 s plays that much longer (by > 0 only)
  {"op":"ripple","clip":"s05","by":-0.5}                 the clip that much shorter at its end (longer when by > 0);
                                                       what starts at or after its end moves by as much
Studio operations pass through as they are:
  {"op":"move","clip":"vo-1","at":8.2,"track":2}         a clip to a film second (and a track)
  {"op":"insert","clip":{"src":"assets/a.mp4#t=0,4","at":3},"track":1}
  {"op":"remove","clip":"x"}        {"op":"split","clip":"x","at":12,"time":[0,12],"restTime":[12,24]}
  {"op":"props","edits":[{"clip":"x","prop":"volume","value":0.8}]}   at start end volume speed box overrides link fade motion track
  {"op":"fields","clip":"x","fields":{…}}   {"op":"track","track":1,"field":"muted","value":true}
  {"op":"reorder","from":2,"to":0}   {"op":"stage","w":1080,"h":1920}   {"op":"keyframes","set":{"name":"body"}}
  {"op":"captions","at":0,"captions":{"src":"caps.vtt"}}   {"op":"uncaptions","src":"caps.vtt"}

--dry-run: the operations worked out and the film checked, nothing written.
Exit status: 0 done, 1 the edit failed (nothing written), 2 not a project or a wrong command.`;

function fail(/** @type {string} */ what, /** @type {number} */ code = 1) {
  console.error(`✗ ${what}`);
  process.exit(code);
}

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const root = lookProject([]);
if (!root) fail('not in a project (no film.html here or above)', 2);
const filmPath = join(root, 'film.html');

/* ---- --log ---- */
if (words[0] === '--log') {
  const log = readLog(root);
  if (!log.length) { console.log('no edits kept'); process.exit(0); }
  for (const e of log) {
    console.log(`#${e.seq}  ${e.at}${e.why ? `  — ${e.why}` : ''}`);
    for (const op of e.ops) console.log(`    ${JSON.stringify(op)}`);
  }
  console.log(`${log.length} edit${log.length === 1 ? '' : 's'} kept — \`openfilm craft edit --undo\` takes the last back`);
  process.exit(0);
}

/* ---- --undo ---- */
if (words[0] === '--undo') {
  const force = words.includes('--force');
  if (!existsSync(filmPath)) fail('there is no film.html', 2);
  const currentText = readFileSync(filmPath, 'utf8');
  let done;
  try {
    done = undoEdit(root, currentText, { force });
  } catch (e) {
    fail(/** @type {Error} */ (e).message);
  }
  if (!done) { console.log('nothing to undo'); process.exit(0); }
  const { entry, text } = done;
  /* the snapshot read back as a film before it is written — a broken snapshot never replaces a good film */
  const check = readFilmFile(text);
  if (!check.doc) fail(`the edit's snapshot does not read as a film: ${check.problems[0] ?? ''}`);
  console.log(`taking back #${entry.seq}  ${entry.at}${entry.why ? `  — ${entry.why}` : ''}`);
  for (const op of entry.ops) console.log(`    ${JSON.stringify(op)}`);
  writeFileSync(filmPath, text);
  dropSnapshot(root, entry.before);
  console.log(`✓ undone — the film is what it was before that edit`);
  process.exit(0);
}

/* ---- an edit ---- */
const json = words.find((w) => !w.startsWith('--'));
if (!json) fail('name the operations: openfilm craft edit \'<op or [ops]>\' (--help says them)', 2);
const dryRun = words.includes('--dry-run');
const whyAt = words.indexOf('--why');
const why = whyAt >= 0 ? words[whyAt + 1] ?? null : null;

let ops;
try {
  ops = JSON.parse(json);
  if (!Array.isArray(ops)) ops = [ops];
} catch (e) {
  fail(`the operations do not read as JSON: ${/** @type {Error} */ (e).message}`, 2);
}

/* read, translate, write — again when the film changed under the edit (the operations were worked out from the
   film as it was), up to three times */
let attempt = 0;
for (;;) {
  attempt++;
  const film = await readProjectFilm(root);
  if (!film.value) fail(`film.html does not read: ${film.problems[0] ?? ''}`);

  /* probe the lengths ripple/shift need (once: the files do not change between attempts) */
  const lengths = /** @type {Record<string, number>} */ ({});
  const probeSrcs = lengthsNeeded(film.value, ops);
  if (probeSrcs.length) {
    const { mediaFacts } = await import('../../../src/host.mjs');
    for (const src of probeSrcs) {
      const facts = await mediaFacts(join(root, src)).catch(() => null);
      if (facts?.duration) lengths[src] = facts.duration;
    }
  }

  let studioOps;
  try {
    studioOps = translateOps(film.value, ops, { lengths });
  } catch (e) {
    fail(/** @type {Error} */ (e).message);
  }

  if (dryRun) {
    console.log('the operations Studio would write:');
    for (const op of studioOps) console.log(`  ${JSON.stringify(op)}`);
    const { applyOps } = await import('../../../studio/server/ops.mjs');
    try {
      const clone = structuredClone(film.value);
      applyOps(clone, studioOps);
      const check = readFilm(clone);
      if (!check.doc) fail(`the film it would leave does not read: ${check.problems[0] ?? ''}`);
      console.log('✓ the film it leaves reads — nothing written (--dry-run)');
    } catch (e) {
      fail(`the operations do not apply: ${/** @type {Error} */ (e).message}`);
    }
    process.exit(0);
  }

  const before = readFileSync(filmPath, 'utf8');
  try {
    const done = await editProjectFilm(root, film.rev, studioOps);
    if (done.rebased && attempt < 3) continue; /* the film changed under us: work the operations out again on the newer film */
    recordEdit(root, { why, ops, before, after: done.text });
    console.log(`✓ written — ${studioOps.length} operation${studioOps.length === 1 ? '' : 's'}${why ? ` — ${why}` : ''}`);
    console.log('  `openfilm craft edit --undo` takes it back; --log says the edits kept');
    process.exit(0);
  } catch (e) {
    const err = /** @type {Error & { kind?: string }} */ (e);
    if (err.kind === 'conflict' && attempt < 3) continue;
    fail(err.message);
  }
}
