#!/usr/bin/env node
// @ts-check
/**
 * The craft workbench: a small server Studio starts (scripts.start), serving a page where the craft
 * plugin's work can be seen — ducking envelopes, beat grids, check reports, the film's health.
 *
 *   PORT               where to serve (host 127.0.0.1), given by Studio
 *   OPENFILM_PROJECT   the project's folder
 *
 * Analyses reuse the plugin's own modules (beats, duck) and its commands as they are (check, health,
 * run with node, the project as their working folder). Nothing here writes the project.
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const imp = (p) => import(pathToFileURL(p).href);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const CRAFT = resolve(HERE, '..');
const ROOT = process.env.OPENFILM_PROJECT;
const PORT = +process.env.PORT;

if (!ROOT || !PORT) {
  console.error('craft workbench: PORT and OPENFILM_PROJECT are given by Studio');
  process.exit(2);
}

/* ---------- helpers ---------- */

const MEDIA = ['.mp4', '.mov', '.webm', '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac', '.jpg', '.jpeg', '.png', '.webp'];
const SOUND = ['.mp4', '.mov', '.webm', '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'];

/** media files of the project, relative paths, shallow scan of the usual places */
function mediaFiles() {
  const out = [];
  const scan = (dir, depth) => {
    if (depth < 0) return;
    let entries;
    try {
      entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) scan(rel, depth - 1);
      else if (MEDIA.includes(extname(e.name).toLowerCase())) out.push(rel);
    }
  };
  scan('', 2);
  return out.sort();
}

/** run one of the craft commands in the project, never failing the request */
async function craft(bin, args, timeout = 120000) {
  try {
    const { stdout, stderr } = await run(process.execPath, [join(CRAFT, 'bin', bin), ...args], {
      cwd: ROOT,
      timeout,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? '', error: e.message };
  }
}

/** the film's clips, parsed the way the commands do */
async function filmClips() {
  const { readProjectFilm } = await import('../../../studio/server/film.mjs');
  const film = await readProjectFilm(ROOT);
  if (!film.value) return { error: film.problems?.[0] ?? 'film.html does not read', clips: [] };
  const clips = [];
  for (const track of film.value.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (clip.src !== undefined) clips.push(clip);
    }
  }
  return { clips, film: film.value };
}

/** a clip's file on disk and its source window: src="assets/m.m4a#t=2,20" */
function clipFile(clip) {
  const [path, frag] = String(clip.src).split('#');
  let from = 0, to = null;
  const m = frag?.match(/t=([\d.]+)(?:,([\d.]+))?/);
  if (m) {
    from = +m[1] || 0;
    if (m[2]) to = +m[2];
  }
  return { file: resolve(ROOT, path), path, from, to };
}

/* ---------- the apis ---------- */

async function apiOverview() {
  const health = await craft('health.mjs', []);
  const { clips, error } = await filmClips();
  const declarations = [];
  for (const c of clips) {
    const attrs = c.attrs ?? {};
    const craftAttrs = Object.keys(attrs).filter((k) => k.startsWith('data-craft-'));
    if (craftAttrs.length) {
      declarations.push({
        id: c.id ?? c.src,
        src: String(c.src).split('#')[0],
        at: c.at,
        attrs: Object.fromEntries(craftAttrs.map((k) => [k, attrs[k]])),
      });
    }
  }
  const files = mediaFiles();
  const videos = files.filter((f) => ['.mp4', '.mov', '.webm'].includes(extname(f).toLowerCase()));
  const music = files.filter((f) => ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'].includes(extname(f).toLowerCase()));
  return {
    project: ROOT,
    filmError: error,
    health: health.stdout.trim() || health.stderr.trim(),
    healthOk: health.ok,
    clips: clips.map((c) => ({ id: c.id ?? c.src, src: String(c.src).split('#')[0], at: c.at, len: c.len })),
    declarations,
    videos,
    music,
  };
}

async function apiBeats(file) {
  const { analyzeBeats } = await imp(join(CRAFT, 'src', 'beats.mjs'));
  const full = resolve(ROOT, file);
  if (!existsSync(full)) return { error: `no such file: ${file}` };
  const r = await analyzeBeats(full);
  return r;
}

/** the ducking picture: for each declaration the voice's power envelope and the music's gain envelope,
    sampled on one grid so the page can draw them together */
async function apiDuck() {
  const { duckParams, readDuck, duckCurve, GRID, dbGain } = await imp(join(CRAFT, 'src', 'duck-curve.mjs'));
  const { measurePowerCached } = await imp(join(CRAFT, 'src', 'duck-analyze.mjs'));
  const { clipKind } = await import('../../../src/film-doc.mjs');
  const { clips, error } = await filmClips();
  if (error) return { error };

  const sounding = clips.filter((c) => {
    const kind = clipKind(c.src);
    return (kind === 'sound' || kind === 'video') && !c.disabled && c.volume !== 0;
  });
  const ducking = sounding.filter((c) => c.attrs?.['data-craft-duck'] !== undefined);
  if (!ducking.length) return { declarations: [], note: 'no data-craft-duck in the film' };

  const cacheDir = join(ROOT, '.film', 'craft-duck');
  const out = [];
  for (const clip of ducking) {
    const raw = clip.attrs['data-craft-duck'];
    const parsed = readDuck(raw);
    if (parsed === undefined) {
      out.push({ id: clip.id ?? clip.src, error: 'declaration does not parse' });
      continue;
    }
    const params = duckParams(parsed);
    const rest = sounding.filter((c) => c !== clip && c.attrs?.['data-craft-duck'] === undefined
      && (params.under.length ? params.under.includes(c.id) : true));
    if (!rest.length) {
      out.push({ id: clip.id ?? clip.src, error: 'nothing to follow' });
      continue;
    }
    /* measure every followed clip's power and place it on the film's time */
    const placed = [];
    let end = 0;
    for (const c of rest) {
      const { file, from: f0, to } = clipFile(c);
      if (!existsSync(file)) continue;
      const all = await measurePowerCached(file, cacheDir);
      const a = Math.floor(f0 / GRID);
      const z = to != null ? Math.min(all.length, Math.ceil(to / GRID)) : all.length;
      const power = all.slice(Math.min(a, all.length), z);
      const at = clip.at ?? 0;
      placed.push({ id: c.id ?? c.src, at, power });
      end = Math.max(end, at + power.length * GRID);
    }
    const frames = Math.ceil(end / GRID) + 2;
    const combined = new Float64Array(frames);
    for (const p of placed) {
      const a = Math.round(p.at / GRID);
      for (let i = 0; i < p.power.length && a + i < frames; i++) combined[a + i] = Math.max(combined[a + i], p.power[i]);
    }
    const gains = duckCurve(combined, frames, params);
    /* downsample to ~600 points for the page: time, voice dB, gain dB */
    const step = Math.max(1, Math.floor(frames / 600));
    const times = [], voiceDb = [], gainDb = [];
    for (let i = 0; i < frames; i += step) {
      times.push(+(i * GRID).toFixed(2));
      voiceDb.push(combined[i] > 0 ? +(10 * Math.log10(combined[i])).toFixed(1) : -80);
      gainDb.push(+(20 * Math.log10(Math.max(gains[i], 1e-4))).toFixed(1));
    }
    out.push({
      id: clip.id ?? clip.src,
      follows: placed.map((p) => p.id),
      params: { speech: params.speech, pause: params.pause, ratio: params.ratio, threshold: params.threshold },
      times, voiceDb, gainDb,
      end: +end.toFixed(2),
    });
  }
  return { declarations: out };
}

async function apiCheck(video, vision) {
  const args = [video, '--json'];
  if (vision) args.push('--vision');
  const r = await craft('check.mjs', args, 300000);
  try {
    return { report: JSON.parse(r.stdout), ok: r.ok };
  } catch {
    return { error: 'check did not produce JSON', stdout: r.stdout.slice(0, 2000), stderr: r.stderr.slice(0, 1000), ok: r.ok };
  }
}

/* ---------- the server ---------- */

const page = readFileSync(join(HERE, 'index.html'));

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (type, body, code = 200) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  const json = (obj, code) => send('application/json', JSON.stringify(obj), code);
  try {
    if (url.pathname === '/') return send('text/html; charset=utf-8', page);
    if (url.pathname === '/api/overview') return json(await apiOverview());
    if (url.pathname === '/api/beats') return json(await apiBeats(url.searchParams.get('file')));
    if (url.pathname === '/api/duck') return json(await apiDuck());
    if (url.pathname === '/api/check') return json(await apiCheck(url.searchParams.get('video'), url.searchParams.get('vision') === '1'));
    send('text/plain', 'not found', 404);
  } catch (e) {
    json({ error: e.message }, 500);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`craft workbench on http://127.0.0.1:${PORT} for ${ROOT}`);
});
