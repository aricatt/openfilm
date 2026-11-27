#!/usr/bin/env node
// craft roughcut — the narration cut on the timeline baked into a file of its own, so a template
// or a fresh read never brings the retakes and pauses back. `scan` lists what would bake;
// `bake` makes the files; `--apply` moreover replaces the pieces with the baked file as one clip.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { roughCutNarrations, bakeRoughCut } from '../src/roughcut.mjs';
import { readProjectFilm } from '../../../studio/server/film.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || !['scan', 'bake'].includes(cmd)) {
  console.log(`craft roughcut — the cut narration made a file of its own

  craft roughcut scan            the narrations the timeline keeps in pieces
  craft roughcut bake            bake them into assets/roughcut/ files
  craft roughcut bake --apply    and replace the pieces on the timeline with the baked file

The baked file is cached by its cut points: the same cut never bakes twice.`);
  process.exit(cmd ? 1 : 0);
}

const root = process.cwd();
const film = (await readProjectFilm(root)).value;
const narrations = roughCutNarrations(film);
if (!narrations.length) {
  console.log('no narration in pieces on the timeline — nothing to bake');
  process.exit(0);
}
console.log(`${narrations.length} narration(s) in pieces:`);
for (const n of narrations) {
  const kept = n.pieces.reduce((s, p) => s + (p.to - p.from) / p.speed, 0);
  console.log(`  ${n.src}: ${n.pieces.length} pieces, ${kept.toFixed(2)}s kept, at ${n.at}s`);
}
if (cmd === 'scan') process.exit(0);

const apply = args.includes('--apply');
for (const n of narrations) {
  const out = bakeRoughCut(root, n);
  console.log(`${out.reused ? '✓ (already baked)' : '✓ baked'} ${out.rel}: ${out.seconds}s`);
  if (apply) {
    /* one edit, undoable: drop the pieces, put the baked file where they started */
    const ops = JSON.stringify([
      ...n.clipIds.map((id) => ({ op: 'remove', clip: id })),
      { op: 'insert', clip: { src: out.rel, at: n.at, id: `${n.clipIds[0]}-baked` } },
    ]);
    /* the timeline written as every craft edit is: one journaled, undoable operation set */
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [new URL('./edit.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ops, '--why', `roughcut baked: ${n.src}`], { cwd: root, stdio: 'inherit' });
    console.log(`  timeline: ${n.clipIds.length} pieces → one clip of the baked file (undo: craft edit undo)`);
  }
}
