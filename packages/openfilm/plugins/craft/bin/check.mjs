#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft check <video>`: a rendered film's motion read — measured on the film as rendered, small grey
 * frames ten a second, rather than guessed from a few of them.
 *
 *   openfilm craft check out.mp4 [--footage] [--json]
 *
 * Findings, each a stretch of the film:
 *   hold    the picture barely changes for seconds (a breath or a sway still counts as held — fine when meant:
 *           an end card, a held frame)
 *   drift   it moves, but so slowly it reads as still
 *   move    one pan or push that never lands
 *   scroll  the picture moving mostly up or down for seconds
 *
 * `!` a finding worth changing, `~` a note. `--footage`: the picture moves by itself (vlog footage), so one long
 * move or a scroll is no finding. `--json`: the findings as JSON (and the steps, for a tool of your own).
 *
 * What it does not read (yet): whether words are dense or never settle, whether a number said is in the picture —
 * those want a vision pass; lines said over a still picture want the film's captions. The render itself is yours
 * to make first: openfilm render, then this.
 *
 * Exit status: 0 read (findings or none), 1 the video could not be read, 2 a wrong command.
 */
import { existsSync } from 'node:fs';
import { greyFrames } from '../src/check-frames.mjs';
import { motionOf, CHECK_FPS, HOLD_BAD } from '../src/check-motion.mjs';
import { deadLines, DEAD_LIMIT } from '../src/check-dead.mjs';
import { blendsOf } from '../src/check-blend.mjs';
import { readVtt } from '../../../src/captions.mjs';
import { readFileSync } from 'node:fs';

const HELP = `openfilm craft check <video> [--footage] [--json]

  A rendered film's motion read on small grey frames ${CHECK_FPS} a second:
    hold    the picture barely changes for seconds (past ${HOLD_BAD} s is a finding)
    drift   it moves, but so slowly it reads as still
    move    one pan or push that never lands
    scroll  the picture moving mostly up or down for seconds

  --footage   the picture moves by itself (vlog footage): no long-move or scroll findings
  --lines <captions.vtt>   cross the film's caption lines with the stillness read: lines said over
                           a picture that does not move (死句), dead past 90% of the line
  --json      findings (and steps) as JSON

  Render first: openfilm render out.mp4 && openfilm craft check out.mp4`;

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h') || !words.length) {
  console.log(HELP);
  process.exit(words.length ? 0 : 2);
}

const file = words.find((w) => !w.startsWith('--'));
if (!file || !existsSync(file)) {
  console.error(`✗ ${file ?? 'the video'}: no such file — render first: openfilm render out.mp4`);
  process.exit(2);
}
const footage = words.includes('--footage');
const asJson = words.includes('--json');
const at = words.indexOf('--lines');
const linesFile = at >= 0 ? words[at + 1] : undefined;
if (at >= 0 && (!linesFile || !existsSync(linesFile))) {
  console.error(`✗ --lines: no such caption file — a WebVTT track of the film (its captions, on the film's time)`);
  process.exit(2);
}

let data;
try {
  data = await greyFrames(file);
} catch (e) {
  console.error(`✗ ${/** @type {Error} */ (e).message}`);
  process.exit(1);
}

const { frames, w, h, fps, duration } = data;
const result = motionOf({ frames, w, h, fps, footage });
const blends = blendsOf({ frames: frames.map((f) => (f instanceof Uint8Array ? f : new Uint8Array(f))), w, h, fps });
result.findings = [...result.findings, ...blends.findings].sort((x, y) => x.from - y.from);

let dead = null;
if (linesFile) {
  const vtt = readVtt(readFileSync(linesFile, 'utf8'));
  dead = deadLines({ steps: result.steps, fps, lines: vtt.cues });
}

if (asJson) {
  console.log(JSON.stringify({
    file, duration, fps, frames: frames.length,
    stillShare: Number(result.stillShare.toFixed(3)),
    findings: result.findings,
    steps: result.steps.map((s) => (Number.isFinite(s) ? Number(s.toFixed(3)) : null)),
    ...(dead ? { deadLines: { dead: dead.dead, share: Number(dead.share.toFixed(3)), over: dead.over, lines: dead.lines.map((l) => ({ ...l, share: Number(l.share.toFixed(3)) })) } } : {}),
  }, null, 2));
  process.exit(0);
}

const fmt = (/** @type {number} */ t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.round((t % 1) * 10)}`;
console.log(`${file} — ${fmt(duration)}, read at ${fps} fps (${frames.length} frames, ${w}×${h} grey)`);
if (!result.findings.length) {
  console.log(`✓ no motion findings — the picture keeps moving or rests where a rest reads as meant`);
} else {
  for (const f of result.findings) {
    console.log(`${f.level} ${f.check} ${fmt(f.from)}–${fmt(f.to)}: ${f.said}`);
  }
}
console.log(`still ${(result.stillShare * 100).toFixed(0)}% of the film${result.stillShare > 0.3 ? ' — much of it barely moves; whether that is right is the edit\'s to say' : ''}`);
