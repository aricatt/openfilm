// @ts-check
/**
 * snap-cuts: cuts move to the nearest silence, never refused. Unit tests inject the silences;
 * the end-to-end one detects them in a real tone-and-gap file with ffmpeg.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapCuts, silencesNear, SNAP_REACH, BREATH } from './edit-snap.mjs';

const film = {
  tracks: [{ clips: [
    { id: 'vo', src: 'vo.mp3', at: 2, time: [10, 20], speed: 1 },
  ] }],
};

test('a trim start moves to the silence end less a breath, an end to the silence start plus one', async () => {
  const silences = async () => [[11.8, 12.4]];
  const ops = [{ op: 'trim', clip: 'vo', from: 12.1, to: 15 }];
  const said = await snapCuts('/x', ops, film, { silences });
  assert.equal(ops[0].from, 12.4 - BREATH, `start keeps a breath: ${ops[0].from}`);
  assert.ok(said.some((s) => s.includes('开头')), said.join());
  /* end: silence at 14.8-15.4 → end moves to 14.8 + BREATH */
  const ops2 = [{ op: 'trim', clip: 'vo', to: 15.1 }];
  const sil2 = async () => [[14.8, 15.4]];
  await snapCuts('/x', ops2, film, { silences: sil2 });
  assert.equal(ops2[0].to, 14.8 + BREATH);
});

test('a split moves to the middle of the silence, both windows with it', async () => {
  const silences = async () => [[14.9, 15.5]];
  /* film at=2, source window from=10: a cut at film second 7 is source second 15 */
  const ops = [{ op: 'split', clip: 'vo', at: 7, time: [10, 15], restTime: [15, 20] }];
  const said = await snapCuts('/x', ops, film, { silences });
  assert.equal(ops[0].at, 7.2, `middle of 14.9–15.5 is 15.2, film time: ${ops[0].at}`);
  assert.equal(ops[0].time[1], 15.2);
  assert.equal(ops[0].restTime[0], 15.2);
  assert.ok(said.some((s) => s.includes('静音')), said.join());
});

test('no silence near: said, and the cut stands', async () => {
  const silences = async () => [];
  const ops = [{ op: 'split', clip: 'vo', at: 7 }];
  const said = await snapCuts('/x', ops, film, { silences });
  assert.equal(ops[0].at, 7, 'untouched');
  assert.ok(said.some((s) => s.includes('没有静音')), said.join());
});

test('a cut already in silence is not moved; non-1 speed is left alone', async () => {
  const silences = async () => [[14.9, 15.5]];
  const ops = [{ op: 'split', clip: 'vo', at: 2 + (15.2 - 10) }];
  const said = await snapCuts('/x', ops, film, { silences });
  assert.equal(said.length, 0, 'already there: nothing said');
  const fast = { tracks: [{ clips: [{ id: 'vo', src: 'vo.mp3', at: 0, time: [0, 10], speed: 2 }] }] };
  const ops2 = [{ op: 'split', clip: 'vo', at: 5 }];
  const said2 = await snapCuts('/x', ops2, fast, { silences });
  assert.equal(ops2[0].at, 5, 'speed 2 untouched');
  assert.equal(said2.length, 0);
});

test('a cut beyond the reach stays', async () => {
  /* silence centered 1.5 s away — past SNAP_REACH */
  const silences = async () => [[16.4, 17.0]];
  const ops = [{ op: 'split', clip: 'vo', at: 7 }];
  const said = await snapCuts('/x', ops, film, { silences });
  assert.equal(ops[0].at, 7);
});

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('silencesNear end to end: gaps in a tone are found', { skip: !ffmpeg && 'ffmpeg not on the PATH' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-snap-'));
  try {
    const file = join(dir, 'vo.mp3');
    /* tone 0–2 s, silence 2–3 s, tone 3–6 s: silencedetect reads the gap */
    execFileSync('ffmpeg', ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1', file]);
    const found = await silencesNear(file, 1.5, 3);
    assert.ok(found.some(([a, b]) => a <= 2.3 && b >= 2.7), `the gap at 2–3 s found: ${JSON.stringify(found)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
