// @ts-check
/**
 * craft edit's tests: the translation of compound operations (pure), and the command end to end — a film written,
 * an edit applied, the journal kept, the undo putting the film back.
 * Run with the rest: `node --test` here or pnpm test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateOps, lengthsNeeded } from './edit-ops.mjs';
import { filmHtml, readFilmFile } from '../../../src/film-doc.mjs';

const BIN = fileURLToPath(new URL('../bin/edit.mjs', import.meta.url));

/** a film value: a voice-over on track 0 (sounds), a video on track 1 (pictures), music beside the voice */
const filmValue = () => ({
  stage: { w: 1920, h: 1080 },
  tracks: [
    { clips: [
      { src: 'voice.wav', id: 'vo-1', at: 0, time: [0, 10] },
      { src: 'music.mp3', id: 'mu-1', at: 0, time: [0, 30] },
    ] },
    { clips: [
      { src: 'a.mp4', id: 'a-1', at: 0, time: [0, 5] },
      { src: 'b.mp4', id: 'b-1', at: 5, time: [0, 5] },
    ] },
  ],
});

test('trim becomes start/end props in source seconds', () => {
  const ops = translateOps(filmValue(), [{ op: 'trim', clip: 'vo-1', from: 0.3, to: 4.1 }]);
  assert.deepEqual(ops, [{ op: 'props', edits: [
    { clip: 'vo-1', prop: 'start', value: 0.3 },
    { clip: 'vo-1', prop: 'end', value: 4.1 },
  ] }]);
  /* to null: the end comes off */
  const open = translateOps(filmValue(), [{ op: 'trim', clip: 'vo-1', from: 0.3, to: null }]);
  assert.deepEqual(/** @type {never} */ (open)[0].edits[1], { clip: 'vo-1', prop: 'end', value: null });
  assert.throws(() => translateOps(filmValue(), [{ op: 'trim', clip: 'vo-1', from: 4, to: 2 }]), /after from/);
  assert.throws(() => translateOps(filmValue(), [{ op: 'trim', clip: 'gone', from: 0, to: 1 }]), /not in the film/);
});

test('fade becomes the fade prop; 0,0 takes it off', () => {
  const ops = translateOps(filmValue(), [{ op: 'fade', clip: 'mu-1', in: 0.3, out: 1.6 }]);
  assert.deepEqual(ops, [{ op: 'props', edits: [{ clip: 'mu-1', prop: 'fade', value: [0.3, 1.6] }] }]);
  const off = translateOps(filmValue(), [{ op: 'fade', clip: 'mu-1', in: 0, out: 0 }]);
  assert.deepEqual(/** @type {never} */ (off)[0].edits[0].value, null);
});

test('attr writes a data attribute, keeping the others; null takes it off', () => {
  const value = filmValue();
  value.tracks[0].clips[1].attrs = { 'data-craft-duck': '{}' };
  const ops = translateOps(value, [{ op: 'attr', clip: 'mu-1', name: 'data-x', value: '1' }]);
  assert.deepEqual(ops, [{ op: 'fields', clip: 'mu-1', fields: { attrs: { 'data-craft-duck': '{}', 'data-x': '1' } } }]);
  const off = translateOps(value, [{ op: 'attr', clip: 'mu-1', name: 'data-craft-duck', value: null }]);
  assert.deepEqual(/** @type {never} */ (off)[0].fields, { attrs: null });
  assert.throws(() => translateOps(value, [{ op: 'attr', clip: 'mu-1', name: 'onclick', value: 'x' }]), /cannot be set/);
});

test('replace refuses another kind of file and resets the trim unless kept', () => {
  const ops = translateOps(filmValue(), [{ op: 'replace', clip: 'a-1', src: 'c.mp4' }]);
  assert.deepEqual(ops, [{ op: 'fields', clip: 'a-1', fields: { src: 'c.mp4', start: null, end: null, time: null } }]);
  const kept = translateOps(filmValue(), [{ op: 'replace', clip: 'a-1', src: 'c.mp4', keep: 'time' }]);
  assert.deepEqual(/** @type {never} */ (kept)[0].fields, { src: 'c.mp4' });
  assert.throws(() => translateOps(filmValue(), [{ op: 'replace', clip: 'a-1', src: 'c.wav' }]), /same kind/);
});

test('shift moves every clip at or after from, a clip starting exactly at from moves too', () => {
  const ops = translateOps(filmValue(), [{ op: 'shift', from: 5, by: 1.5 }]);
  assert.deepEqual(ops, [{ op: 'props', edits: [{ clip: 'b-1', prop: 'at', value: 6.5 }] }]);
  /* negative: earlier; before the film's start is refused */
  assert.throws(() => translateOps(filmValue(), [{ op: 'shift', from: 5, by: -6 }]), /before the film/);
  assert.throws(() => translateOps(filmValue(), [{ op: 'shift', from: 99, by: 1 }]), /nothing starts/);
});

test('shift with extend stretches the clip across from', () => {
  /* a-1 plays 0–5, from 2: it stretches by 1.5 (its end 5 → 6.5 in source seconds, speed 1) and b-1 moves */
  const ops = translateOps(filmValue(), [{ op: 'shift', from: 2, by: 1.5, extend: 'a-1' }]);
  const edits = /** @type {never} */ (ops)[0].edits;
  assert.ok(edits.some((e) => e.clip === 'a-1' && e.prop === 'end' && Math.abs(e.value - 6.5) < 1e-9), JSON.stringify(edits));
  assert.ok(edits.some((e) => e.clip === 'b-1' && e.prop === 'at' && e.value === 6.5), JSON.stringify(edits));
  /* the clip has to play across from */
  assert.throws(() => translateOps(filmValue(), [{ op: 'shift', from: 7, by: 1.5, extend: 'a-1' }]), /across 7/);
});

test('ripple stretches the clip and moves what starts at or after its end', () => {
  /* a-1 plays 0–5; b-1 starts at 5 — exactly its end — and moves */
  const ops = translateOps(filmValue(), [{ op: 'ripple', clip: 'a-1', by: -0.5 }]);
  const edits = /** @type {never} */ (ops)[0].edits;
  assert.ok(edits.some((e) => e.clip === 'a-1' && e.prop === 'end' && Math.abs(e.value - 4.5) < 1e-9), JSON.stringify(edits));
  assert.ok(edits.some((e) => e.clip === 'b-1' && e.prop === 'at' && e.value === 4.5), JSON.stringify(edits));
  /* clips nowhere near the end stay */
  assert.ok(!edits.some((e) => e.clip === 'vo-1'));
});

test('ripple on a clip with no trim end writes one, the file probed', () => {
  const value = filmValue();
  delete value.tracks[1].clips[0].time;
  const need = lengthsNeeded(value, [{ op: 'ripple', clip: 'a-1', by: 1 }]);
  assert.deepEqual(need, ['a.mp4']);
  /* without the probe it is an error that says what to do */
  assert.throws(() => translateOps(value, [{ op: 'ripple', clip: 'a-1', by: 1 }]), /cannot be told/);
  const ops = translateOps(value, [{ op: 'ripple', clip: 'a-1', by: 1 }], { lengths: { 'a.mp4': 8 } });
  const edits = /** @type {never} */ (ops)[0].edits;
  /* the file is 8 s; it played 0–8, now 0–9 of it — past the file, but the length said is what the edit trusts */
  assert.ok(edits.some((e) => e.clip === 'a-1' && e.prop === 'end' && Math.abs(e.value - 9) < 1e-9), JSON.stringify(edits));
});

test('Studio operations pass through untouched; unknown operations are refused', () => {
  const move = { op: 'move', clip: 'a-1', at: 8.2 };
  assert.deepEqual(translateOps(filmValue(), [move]), [move]);
  assert.throws(() => translateOps(filmValue(), [{ op: 'explode', clip: 'a-1' }]), /unknown operation/);
});

test('an edit end to end: written, journaled, undone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-edit-'));
  try {
    writeFileSync(join(dir, 'film.html'), filmHtml(filmValue()));
    const before = readFileSync(join(dir, 'film.html'), 'utf8');
    const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: 'utf8' });

    /* an edit: move b-1 and fade the music */
    const edit = run([JSON.stringify([
      { op: 'move', clip: 'b-1', at: 8.2 },
      { op: 'fade', clip: 'mu-1', in: 0.3, out: 1.6 },
    ]), '--why', 'test edit']);
    assert.equal(edit.status, 0, edit.stderr);
    const after = readFileSync(join(dir, 'film.html'), 'utf8');
    assert.notEqual(after, before);
    const value = readFilmFile(after).value;
    const b1 = value.tracks[1].clips.find((c) => c.id === 'b-1');
    assert.equal(b1.at, 8.2);
    /* the journal kept it */
    assert.ok(existsSync(join(dir, '.film', 'craft-edit', 'log.jsonl')));
    const log = run(['--log']);
    assert.equal(log.status, 0);
    assert.ok(log.stdout.includes('test edit'), log.stdout);

    /* a wrong edit writes nothing */
    const bad = run([JSON.stringify([{ op: 'move', clip: 'gone', at: 1 }])]);
    assert.equal(bad.status, 1);
    assert.equal(readFileSync(join(dir, 'film.html'), 'utf8'), after);

    /* undo puts the film back, byte for byte */
    const undo = run(['--undo']);
    assert.equal(undo.status, 0, undo.stderr);
    assert.equal(readFileSync(join(dir, 'film.html'), 'utf8'), before);

    /* nothing left to undo */
    const again = run(['--undo']);
    assert.ok(again.stdout.includes('nothing to undo'));

    /* undo is refused when the film changed since the edit */
    run([JSON.stringify([{ op: 'move', clip: 'b-1', at: 9 }])]);
    writeFileSync(join(dir, 'film.html'), readFileSync(join(dir, 'film.html'), 'utf8') + '\n<!-- touched -->');
    const refused = run(['--undo']);
    assert.equal(refused.status, 1);
    assert.ok(refused.stderr.includes('--force'), refused.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dry-run writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-edit-dry-'));
  try {
    writeFileSync(join(dir, 'film.html'), filmHtml(filmValue()));
    const before = readFileSync(join(dir, 'film.html'), 'utf8');
    const run = spawnSync(process.execPath, [BIN, JSON.stringify([{ op: 'move', clip: 'b-1', at: 7 }]), '--dry-run'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(dir, 'film.html'), 'utf8'), before);
    assert.ok(!existsSync(join(dir, '.film', 'craft-edit', 'log.jsonl')), 'nothing journaled');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
