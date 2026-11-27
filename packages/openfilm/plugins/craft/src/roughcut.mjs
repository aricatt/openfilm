// @ts-check
/**
 * The rough cut baked (ADu's adudir-roughcut-bake, re-implemented for the upstream film model):
 * a narration cut on the timeline is the same file in pieces (#t ranges) — a template or a fresh
 * read of the file afterwards brings every retake and pause back. Baking makes the kept pieces a
 * file of their own; the original stays.
 *
 * Where ADu read clip.time pairs, upstream carries the window in the src fragment (`#t=from,to`):
 * the scanning is rewritten, the baking is the same concat with a breath of fade at each join.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

/** where the baked narration is kept in the project */
export const BAKED_DIR = 'assets/roughcut';
const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi)$/i, AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i;
/** pieces laid end to end on the timeline (a rough cut closes its gaps); a hair of slack for rounding */
const JOIN_GAP = 0.06, SLACK = 0.011;
/** a short fade at each join, so no click where two pieces meet */
const JOIN_FADE = 0.012;

/** a src's file and its source window: `assets/vo.mp4#t=2,10` → { file, from: 2, to: 10 } */
export function srcWindow(src) {
  const [path, frag] = String(src ?? '').split('#');
  const m = frag?.match(/t=([\d.]+)(?:,([\d.]+))?/);
  if (!m) return null;
  return { file: path, from: +m[1] || 0, to: m[2] ? +m[2] : null };
}

/**
 * The narrations the timeline keeps as pieces of one file, in order: one track holding two or more
 * clips of the same media file, their windows of the file in order without overlap, laid end to end.
 * @param {{ tracks?: { clips?: object[] }[] }} film the film's value (readProjectFilm)
 * @returns {{ src: string, pieces: { from: number, to: number, speed: number }[], at: number, clipIds: string[] }[]}
 */
export function roughCutNarrations(film) {
  /** @type {Map<string, any>} */
  const found = new Map();
  for (const track of film.tracks ?? []) {
    /** @type {Map<string, any[]>} */
    const bySrc = new Map();
    for (const clip of track.clips ?? []) {
      /* upstream reads the fragment into time: src is the file, time the window — as ADu's model was */
      const file = String(clip.src ?? '').split(/[?#]/)[0];
      if (!file || (!VIDEO.test(file) && !AUDIO.test(file))) continue;
      if (!Array.isArray(clip.time) || clip.time.length !== 2) continue;
      if (clip.attrs?.['data-craft-ramp'] !== undefined) continue; // a speed curve has no narration audio
      bySrc.set(file, [...(bySrc.get(file) ?? []), { clip, w: { file, from: Number(clip.time[0]), to: Number(clip.time[1]) } }]);
    }
    for (const [src, items] of bySrc) {
      if (items.length < 2) continue;
      const sorted = [...items].sort((a, b) => (a.clip.at ?? 0) - (b.clip.at ?? 0));
      let ok = true;
      for (let i = 1; i < sorted.length && ok; i++) {
        const prev = sorted[i - 1], cur = sorted[i];
        const prevSpeed = prev.clip.speed && prev.clip.speed !== 1 ? prev.clip.speed : 1;
        const prevEnd = (prev.clip.at ?? 0) + (prev.w.to - prev.w.from) / prevSpeed;
        if (cur.w.from < prev.w.to - SLACK) ok = false; // the file read again: not a cut of one take
        const gap = (cur.clip.at ?? 0) - prevEnd;
        if (gap < -SLACK || gap > JOIN_GAP) ok = false; // not laid end to end
      }
      if (!ok) continue;
      const pieces = sorted.map(({ clip, w }) => ({
        from: w.from, to: w.to,
        speed: clip.speed && clip.speed !== 1 ? clip.speed : 1,
      }));
      if (!found.has(src)) found.set(src, { src, pieces, at: sorted[0].clip.at ?? 0, clipIds: sorted.map(({ clip }) => clip.id) });
    }
  }
  return [...found.values()];
}

/** atempo chained: 0.5–2 a step (ffmpeg's limit), the speed said as filters */
export function tempoChain(rate) {
  if (rate === 1) return '';
  const parts = [];
  let r = rate;
  while (r > 2) { parts.push('atempo=2'); r /= 2; }
  while (r < 0.5) { parts.push('atempo=0.5'); r /= 0.5; }
  parts.push(`atempo=${r}`);
  return parts.join(',');
}

/**
 * The narration's kept pieces made into one file, cached by content key: made again only when
 * the pieces or the file changed.
 * @param {string} root @param {{ src: string, pieces: { from: number, to: number, speed: number }[] }} narration
 * @returns {{ file: string, rel: string, seconds: number, reused: boolean }}
 */
export function bakeRoughCut(root, narration) {
  const abs = resolve(root, narration.src);
  if (!existsSync(abs)) throw new Error(`no such file: ${narration.src}`);
  const video = VIDEO.test(narration.src);
  const name = basename(narration.src, extname(narration.src));
  const dir = join(root, ...BAKED_DIR.split('/'));
  const base = join(dir, `${name}-cut${video ? '.mp4' : '.m4a'}`);
  const st = statSync(abs);
  const key = createHash('sha256').update(JSON.stringify({
    v: 1, src: narration.src, pieces: narration.pieces, size: st.size, mtime: Math.round(st.mtimeMs),
  })).digest('hex').slice(0, 24);
  const seconds = Math.round(narration.pieces.reduce((s, p) => s + (p.to - p.from) / p.speed, 0) * 1000) / 1000;
  const rel = [...BAKED_DIR.split('/'), basename(base)].join('/');
  if (existsSync(base) && existsSync(`${base}.json`)) {
    try {
      if (JSON.parse(readFileSync(`${base}.json`, 'utf8')).key === key) return { file: base, rel, seconds, reused: true };
    } catch { /* a broken record bakes again */ }
  }
  mkdirSync(dir, { recursive: true });

  const n = narration.pieces.length;
  const parts = narration.pieces.map((p, i) => {
    const rate = p.speed, d = (p.to - p.from) / rate, fade = Math.min(JOIN_FADE, d / 4);
    const tempo = tempoChain(rate);
    const retime = !tempo ? '' : `,${tempo},asetpts=N/SR/TB,apad,atrim=duration=${d.toFixed(4)}`;
    const a = `[0:a]aresample=first_pts=0,apad,atrim=start=${p.from}:end=${p.to},asetpts=PTS-STARTPTS${retime},afade=t=in:d=${fade.toFixed(4)},afade=t=out:st=${(d - fade).toFixed(4)}:d=${fade.toFixed(4)}[a${i}]`;
    if (!video) return a;
    const clock = rate === 1 ? 'setpts=PTS-STARTPTS' : `settb=AVTB,setpts=(PTS-STARTPTS)/${rate},tpad=stop_mode=clone:stop_duration=${d.toFixed(4)},trim=duration=${d.toFixed(4)}`;
    return `[0:v]trim=start=${p.from}:end=${p.to},${clock}[v${i}];${a}`;
  });
  const inputs = narration.pieces.map((_, i) => (video ? `[v${i}][a${i}]` : `[a${i}]`)).join('');
  const graph = `${parts.join(';')};${inputs}concat=n=${n}:v=${video ? 1 : 0}:a=1${video ? '[v][a]' : '[a]'}`;

  const tmp = join(dir, `.cut-${key}${extname(base)}`);
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', abs, '-filter_complex', graph,
    ...(video ? ['-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'] : []),
    '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', timeout: 600_000, windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg could not bake: ${(r.stderr ?? '').trim().split('\n').pop() ?? 'failed'}`);
  copyFileSync(tmp, base);
  writeFileSync(`${base}.json`, JSON.stringify({ key, src: narration.src, pieces: narration.pieces, seconds }));
  try { spawnSync('cmd', ['/c', 'del', tmp], { windowsHide: true }); } catch { /* a stray tmp is swept next time */ }
  return { file: base, rel, seconds, reused: false };
}
