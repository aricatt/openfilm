#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft beats <audio>`: the beat grid of a song, to cut and animate on its beats — BPM, every beat, each
 * bar's downbeat (4/4), each bar's loudness, sections where the level changes, accents (drops, the band back in),
 * where to come in and where a loop can close.
 *
 * A file inside a project gets <name>.beats.json beside it (made once, again when the file changes), which a page
 * can read when it gets ready:  fetch('assets/music/song.beats.json').then(r => r.json())
 *
 * Exit status: 0 done, 1 the file could not be analysed, 2 a wrong command.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { analyzeBeats, beatsSummary, BEATS_VERSION } from '../src/beats.mjs';

const HELP = `openfilm craft beats <audio> [--json] [--out <file>]

  The beat grid of a song: BPM, every beat, each bar's downbeat, loudness per bar (all, bass, highs), sections,
  accents, the entry past a fade-in, and a loop span when there is one. Times are seconds of the file; bars count
  from 1.

  Inside a project the JSON is written beside the file as <name>.beats.json (once, again when the file changes);
  elsewhere nothing is written unless --out says where.

  --json         print the whole JSON instead of the summary
  --out <file>   write the JSON there`;

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h') || !words.length) {
  console.log(HELP);
  process.exit(words.length ? 0 : 2);
}

let file = null, out = null, asJson = false;
for (let i = 0; i < words.length; i++) {
  const a = words[i];
  if (a === '--json') { asJson = true; continue; }
  if (a === '--out') { out = words[++i]; continue; }
  if (a.startsWith('--out=')) { out = a.slice(6); continue; }
  if (a.startsWith('--')) { console.error(`✗ no option ${a}`); process.exit(2); }
  if (file) { console.error('✗ one sound at a time'); process.exit(2); }
  file = a;
}
if (!file) { console.log(HELP); process.exit(2); }
const path = resolve(file);
if (!existsSync(path) || !statSync(path).isFile()) {
  console.error(`✗ ${file}: no such file`);
  process.exit(2);
}

/** The nearest folder up with a film.html. */
const projectOf = (/** @type {string} */ from) => {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'film.html'))) return dir;
    if (dir === dirname(dir)) return null;
  }
};

const root = projectOf(dirname(path));
const inside = root ? path === root || path.startsWith(root + sep) : false;
const target = out ? resolve(out) : inside ? join(dirname(path), `${basename(path, extname(path))}.beats.json`) : null;
const st = statSync(path), source = { bytes: st.size, mtimeMs: Math.round(st.mtimeMs) };

let result = null;
if (target && existsSync(target)) {
  try {
    const old = JSON.parse(readFileSync(target, 'utf8'));
    if (old?.v === BEATS_VERSION && old.source?.bytes === source.bytes && old.source?.mtimeMs === source.mtimeMs) result = old;
  } catch { /* unreadable: made again */ }
}
if (!result) {
  try {
    result = { ...(await analyzeBeats(path)) };
  } catch (e) {
    console.error(`✗ ${/** @type {Error} */ (e).message}`);
    process.exit(1);
  }
  const shownFile = inside && root ? relative(root, path).split(sep).join('/') : basename(path);
  result = { v: result.v, file: shownFile, source, ...result };
  if (target) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(result) + '\n');
  }
}

if (asJson) {
  console.log(JSON.stringify(result, null, 1));
} else {
  const lines = beatsSummary(result);
  if (target) {
    const where = inside && root ? relative(root, target).split(sep).join('/') : target;
    lines.push(`→ ${where}${inside ? `   (a page: fetch('${where}'))` : ''}`);
  }
  console.log(lines.join('\n'));
}
