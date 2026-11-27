#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft music-fit`: the music cut to the story.
 *
 *   openfilm craft music-fit assets/music.m4a --end 14 --hits '[
 *     {"at": 0, "bar": 1},          from the film start, bar 1 at the cut
 *     {"at": 8, "bar": 5},          at second 8 cut again, bar 5 landing there
 *     {"at": 12, "tail": true} ]'   the music's own end as the film stops
 *
 * A hit says what lands where: bar (its downbeat on the cut, or on another second with "on"),
 * quiet (the music's quiet stretch), section n, src (a second of the file as it is), tail.
 * The pieces become audio clips through craft edit — one insert and one fade each — so the
 * whole fit is one undoable edit. Beats come from the file's .beats.json or are measured now.
 *
 *   --dry-run   the plan and the operations, nothing written
 *
 * Exit status: 0 done, 1 the plan or the edit failed, 2 a wrong command.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookProject } from '../../../src/plugin-look.mjs';
import { analyzeBeats } from '../src/beats.mjs';
import { planMusic } from '../src/music-fit.mjs';
import { writeFileSync } from 'node:fs';

const BIN = fileURLToPath(new URL('.', import.meta.url));

const HELP = `openfilm craft music-fit — the music cut to the story

  craft music-fit <music> --end <seconds> --hits '<json>' [--dry-run]

  hits: [{"at":0,"bar":1},{"at":8,"bar":5,"on":8.5},{"at":10,"quiet":true},{"at":12,"tail":true}]
  each hit one of: bar (downbeat lands at the cut, or at "on"), quiet / section n, src <s>, tail
`;

function fail(what, code = 1) {
  console.error(`✗ ${what}`);
  process.exit(code);
}

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h') || words.length < 2) {
  console.log(HELP);
  process.exit(words.length ? 0 : 2);
}

const music = words.find((w) => !w.startsWith('--') && !w.startsWith('[') && !/^\d/.test(w));
if (!music || !existsSync(music)) fail(`no such music file: ${music ?? '(none)'}`, 2);

const hitsAt = words.indexOf('--hits');
if (hitsAt < 0 || !words[hitsAt + 1]) fail('--hits: the cuts as JSON', 2);
let hits;
try {
  hits = JSON.parse(words[hitsAt + 1]);
} catch (e) {
  fail(`--hits does not read: ${/** @type {Error} */ (e).message}`, 2);
}

const endAt = words.indexOf('--end');
const end = endAt >= 0 ? Number(words[endAt + 1]) : NaN;
if (!Number.isFinite(end) || end <= 0) fail('--end: the film second the music stops', 2);

const root = lookProject([]);
if (!root) fail('not in a project (no film.html here or above)', 2);

/* the beats grid: the sibling cache, or measured now and cached for next time */
/* the beats grid: craft beats' cache beside the file (its name the extension swapped), or measured now */
const craftCache = music.replace(/\.[^.]+$/, '') + '.beats.json';
const cacheFile = existsSync(craftCache) ? craftCache : `${music}.beats.json`;
let beats;
if (existsSync(cacheFile)) {
  beats = JSON.parse(readFileSync(cacheFile, 'utf8'));
} else {
  console.log('measuring the music first (craft beats)…');
  beats = await analyzeBeats(music);
  writeFileSync(cacheFile, JSON.stringify({ file: music, ...beats }, null, 2));
}

let pieces;
try {
  pieces = planMusic(beats, hits, { end });
} catch (e) {
  fail(/** @type {Error} */ (e).message);
}

console.log(`${pieces.length} pieces:`);
for (const p of pieces) console.log(`  ${p.at}s → play ${p.from}–${p.to}s (${p.said})${p.fadeIn ? `, in ${p.fadeIn}` : ''}, out ${p.fadeOut}`);

/* the edit: each piece an insert plus its fades — one undoable craft edit */
const rel = relative(root, join(process.cwd(), music)).replace(/\\/g, '/');
const ops = [];
pieces.forEach((p, i) => {
  const id = `fit-${i + 1}`;
  ops.push({ op: 'insert', clip: { src: `${rel}#t=${p.from},${p.to}`, at: p.at, id } });
  ops.push({ op: 'fade', clip: id, in: p.fadeIn, out: p.fadeOut });
});

if (words.includes('--dry-run')) {
  console.log(`\n${JSON.stringify(ops, null, 1)}`);
  process.exit(0);
}

try {
  execFileSync(process.execPath, [join(BIN, 'edit.mjs'), JSON.stringify(ops)], { cwd: root, stdio: 'inherit' });
} catch {
  fail('the edit failed — the plan was fine, the writing was not');
}
console.log('✓ the music is fitted — one undo away: openfilm craft edit --undo');
