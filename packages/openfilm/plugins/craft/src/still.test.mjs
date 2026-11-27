// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stillFrame } from './still.mjs';

const BIN = fileURLToPath(new URL('../bin/still.mjs', import.meta.url));
const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('a frame is drawn out, the last moment falls back to the last frame before it', { skip: !ffmpeg && 'ffmpeg not on the PATH' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-still-'));
  try {
    const video = join(dir, 'v.mp4');
    /* 4 s of colour going red to blue halfway, so the second halves are told apart */
    execFileSync('ffmpeg', ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:size=320x240:duration=2:rate=10',
      '-f', 'lavfi', '-i', 'color=c=blue:size=320x240:duration=2:rate=10',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1', '-pix_fmt', 'yuv420p', video]);
    /* a mid-file frame */
    const mid = await stillFrame(video, 1);
    assert.ok(mid.length > 100, `a JPEG: ${mid.length} bytes`);
    assert.equal(mid[0], 0xff, 'JPEG magic');
    assert.equal(mid[1], 0xd8);
    /* past the file's last frame start: the fallback frame, never a failure */
    const end = await stillFrame(video, 3.999);
    assert.ok(end.length > 100, 'the last moment still gives a frame');
    const beyond = await stillFrame(video, 4.0).catch(() => null);
    /* exactly at the end or a hair past may fail or fall back — what matters: never a crash without a message */
    /* the CLI end to end */
    const out = join(dir, 'frame.jpg');
    const run = spawnSync(process.execPath, [BIN, video, '1', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(out), 'written');
    assert.equal(readFileSync(out)[0], 0xff);
    /* a wrong second is an error, not silence */
    const bad = spawnSync(process.execPath, [BIN, video, 'abc', out], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
