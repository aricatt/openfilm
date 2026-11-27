// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEdit, undoEdit } from './edit-journal.mjs';

test('media-aware undo: files the edit wrote are put back, files it made are taken away', () => {
  const root = mkdtempSync(join(tmpdir(), 'craft-journal-'));
  try {
    mkdirSync(join(root, 'caps'), { recursive: true });
    writeFileSync(join(root, 'caps', 'a.vtt'), 'WEBVTT\n\noriginal');
    const before = '<film>before</film>';
    const after = '<film>after</film>';
    recordEdit(root, { why: 'test', ops: [], before, after, files: ['caps/a.vtt', 'caps/new.vtt'] });
    writeFileSync(join(root, 'caps', 'a.vtt'), 'WEBVTT\n\nedited');
    writeFileSync(join(root, 'caps', 'new.vtt'), 'WEBVTT\n\nmade by the edit');
    const undone = undoEdit(root, after);
    assert.ok(undone, 'taken back');
    assert.equal(readFileSync(join(root, 'caps', 'a.vtt'), 'utf8'), 'WEBVTT\n\noriginal', 'a.vtt restored');
    assert.ok(!existsSync(join(root, 'caps', 'new.vtt')), 'new.vtt taken away');
    assert.equal(undone.text, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
