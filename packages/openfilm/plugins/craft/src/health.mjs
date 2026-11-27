// @ts-check
/**
 * What in the project keeps the film from drawing, read from its files — no browser (ADu 2.0's film-health,
 * the structural half rewritten): film.html that cannot be read; a page on the timeline that is not there;
 * a page's script that cannot run. Read before a render or a preview, so a broken project is said in words
 * rather than as a browser's silence.
 *
 * What this does not read (yet): a page reading a parameter it does not declare — that wants the static
 * analysis of the page's film object (acorn), a deeper port.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, sep, dirname, normalize } from 'node:path';
import { readFilmFile } from '../../../src/film-doc.mjs';

const PAGE = /\.html?$/i;
const SCRIPT = /\.(?:m?js|cjs)$/i;

/** a project file's text (null: not there, outside the project, or too big) @param {string} root */
const reader = (root) => (/** @type {string} */ rel) => {
  const abs = resolve(root, rel), inside = relative(root, abs);
  if (!inside || inside.startsWith('..') || inside.split(sep).includes('..')) return null;
  try { return statSync(abs).size <= 4 * 1024 * 1024 ? readFileSync(abs, 'utf8') : null; } catch { return null; }
};

/** the script files a page pulls in (`<script src="…">`, project-relative ones only) */
export function scriptSources(/** @type {string} */ pageText) {
  const out = [];
  for (const m of pageText.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const src = m[1].split(/[?#]/)[0];
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && SCRIPT.test(src)) out.push(src);
  }
  return out;
}

/** a script body's syntax, checked by the parser that would run it — a problem in words, or null */
export function syntaxProblem(/** @type {string} */ text) {
  try {
    new Function(text);
    return null;
  } catch (error) {
    /* module syntax is no script syntax: imports taken away, exports unmarked, then read again —
       what is still broken is broken however it is run */
    if (!/^\s*(import|export)\b/m.test(text)) return error instanceof Error ? error.message : String(error);
    const bare = text
      .replace(/^\s*import\s[^;]*;?/gm, '')
      .replace(/^\s*export\s+default\s+/gm, '')
      .replace(/^\s*export\s+(?=(const|let|var|function|class|async))/gm, '')
      .replace(/^\s*export\s*\{[^}]*\}\s*;?/gm, '');
    try {
      new Function(bare);
      return null;
    } catch (again) {
      return again instanceof Error ? again.message : String(again);
    }
  }
}

/**
 * @param {string} root the project folder
 * @param {{ checkScript?: (text: string) => string | null }} [o]
 * @returns {string[]} what keeps the film from drawing, in the person's words; [] when nothing found
 */
export function healthOf(root, o = {}) {
  const check = o.checkScript ?? syntaxProblem;
  const file = join(root, 'film.html');
  if (!existsSync(file)) return ['film.html 不见了'];
  let film;
  try { film = readFilmFile(readFileSync(file, 'utf8')).value; } catch (error) { return [`film.html 读不出来：${error instanceof Error ? error.message : String(error)}`]; }
  if (!film) return ['film.html 读不出来'];
  const read = reader(root);
  /** @type {string[]} */ const out = [];
  const pages = [...new Set((film.tracks ?? []).flatMap((/** @type {any} */ t) => (t.clips ?? []).map((/** @type {any} */ c) => String(c.src ?? '').split(/[?#]/)[0]))
    .filter((src) => PAGE.test(src) && !/^[a-z][a-z0-9+.-]*:/i.test(src)))];
  for (const page of pages) {
    const text = read(page);
    if (text == null) { out.push(`时间线上的页面 ${page} 不见了`); continue; }
    if (!/window\.film\s*=/.test(text) && !scriptSources(text).length) {
      out.push(`页面 ${page} 没有设置 window.film，它在影片里是一片空白`);
      continue;
    }
    for (const src of scriptSources(text)) {
      const rel = normalize(join(dirname(page), src)).replace(/\\/g, '/');
      const script = read(rel);
      if (script == null) { out.push(`页面 ${page} 引用的脚本 ${src} 不见了`); continue; }
      const bad = check(script);
      if (bad) out.push(`${src} 的脚本运行不了：${bad}`);
    }
    for (const m of text.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const body = m[1].trim();
      if (!body) continue;
      const bad = check(body);
      if (bad) { out.push(`${page} 的内联脚本运行不了：${bad}`); break; }
    }
  }
  return out;
}
