// @ts-check
/**
 * The craft edit journal: every edit `openfilm craft edit` writes is kept in `.film/craft-edit/` so it can be taken
 * back — without Studio running, without anything in film.html itself.
 *
 *   log.jsonl           one line a edit: { seq, at, why, ops, hash, before }
 *   undone.jsonl        the edits taken back, newest last
 *   snapshots/<seq>.html   the film.html text before that edit
 *
 * `hash` is the sha1 of film.html after the edit: an undo is refused when the film on disk is not what the edit
 * left (someone changed it since), unless forced. Snapshots prune with the log: an undo drops the snapshot it
 * restored.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'craft-edit';

/** @param {string} root the project folder @returns {string} the journal folder */
export const journalDir = (root) => join(root, '.film', DIR);

/** sha1 of a text, 16 hex chars — plenty for "is this still what the edit left". */
export const hashOf = (/** @type {string} */ text) => createHash('sha1').update(text).digest('hex').slice(0, 16);

/** The journal entries, oldest first. @returns {{ seq: number, at: string, why: string|null, ops: object[], hash: string, before: string }[]} */
export function readLog(root) {
  const file = join(journalDir(root), 'log.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Keep an edit: its snapshot (the film.html text before it) and a log line. Returns the entry's sequence number.
 * @param {string} root @param {{ why?: string | null, ops: object[], before: string, after: string }} edit
 */
export function recordEdit(root, { why = null, ops, before, after }) {
  const dir = journalDir(root);
  mkdirSync(join(dir, 'snapshots'), { recursive: true });
  const log = readLog(root);
  const seq = (log.length ? Math.max(...log.map((e) => e.seq)) : 0) + 1;
  writeFileSync(join(dir, 'snapshots', `${seq}.html`), before);
  const entry = { seq, at: new Date().toISOString(), why, ops, hash: hashOf(after), before: `snapshots/${seq}.html` };
  writeFileSync(join(dir, 'log.jsonl'), [...log.map((e) => JSON.stringify(e)), JSON.stringify(entry)].join('\n') + '\n');
  return seq;
}

/**
 * Take the last edit back. Refused when the film changed since it was written (its hash is not the edit's), unless
 * `force`. Returns the entry taken back, or null when there is nothing to undo. Throws with the reason when refused.
 * @param {string} root @param {string} currentText film.html as it is now @param {{ force?: boolean }} [o]
 */
export function undoEdit(root, currentText, { force = false } = {}) {
  const log = readLog(root);
  if (!log.length) return null;
  const entry = log[log.length - 1];
  const now = hashOf(currentText);
  if (!force && now !== entry.hash) {
    throw new Error(`the film changed since that edit — say --force to take it back anyway (what changed since is lost)`);
  }
  const dir = journalDir(root);
  const snapshot = join(dir, entry.before);
  if (!existsSync(snapshot)) throw new Error(`the edit's snapshot (${entry.before}) is gone — it cannot be taken back`);
  const text = readFileSync(snapshot, 'utf8');
  /* out of the log, into undone; the snapshot stays until the write of the film is certain — the caller removes it
     after the film is written (dropSnapshot) */
  writeFileSync(join(dir, 'log.jsonl'), log.slice(0, -1).map((e) => JSON.stringify(e)).join('\n') + (log.length > 1 ? '\n' : ''));
  const undone = join(dir, 'undone.jsonl');
  writeFileSync(undone, (existsSync(undone) ? readFileSync(undone, 'utf8') : '') + JSON.stringify({ ...entry, undoneAt: new Date().toISOString() }) + '\n');
  return { entry, text };
}

/** The snapshot of an undone edit is let go once the film is written. @param {string} root @param {string} before */
export function dropSnapshot(root, before) {
  try { rmSync(join(journalDir(root), before)); } catch { /* already gone */ }
}

/** How many edits the journal keeps, for `craft edit --log` to say. @param {string} root */
export function journalSummary(root) {
  const log = readLog(root);
  const dir = journalDir(root);
  const snapshots = existsSync(join(dir, 'snapshots')) ? readdirSync(join(dir, 'snapshots')).length : 0;
  return { edits: log.length, snapshots };
}
