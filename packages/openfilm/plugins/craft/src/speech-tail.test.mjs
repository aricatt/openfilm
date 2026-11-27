import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monoSamples, speechEndIn, tailCorrected } from './speech-tail.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'craft-tail-'));

/** tone for `on` seconds then silence to `total`: speech ends at `on` */
function toneThenQuiet(file, on, total) {
  execFileSync('ffmpeg', ['-y', '-v', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=250:duration=${on}`,
    '-f', 'lavfi', '-i', `anullsrc=r=16000:cl=mono:duration=${total - on}`,
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', file]);
}

test('monoSamples decodes 16k mono', async () => {
  const f = join(dir, 'a.wav');
  toneThenQuiet(f, 1, 2);
  const x = await monoSamples(f);
  assert.ok(x instanceof Float32Array);
  assert.ok(Math.abs(x.length / 16000 - 2) < 0.1, `≈2s, got ${x.length / 16000}`);
});

test('speechEndIn finds where the tone stops', async () => {
  const f = join(dir, 'b.wav');
  toneThenQuiet(f, 1.5, 3);
  const x = await monoSamples(f);
  const end = speechEndIn(x, 0);
  assert.ok(Math.abs(end - 1.5) < 0.1, `end ≈1.5, got ${end}`);
});

test('speechEndIn: nothing loud after from is from itself', async () => {
  const f = join(dir, 'c.wav');
  toneThenQuiet(f, 1, 3);
  const x = await monoSamples(f);
  assert.equal(speechEndIn(x, 2), 2, 'scanning from inside the quiet finds nothing');
});

test('tailCorrected extends past the estimate when speech runs longer', async () => {
  const f = join(dir, 'd.wav');
  toneThenQuiet(f, 2, 4);
  const x = await monoSamples(f);
  /* estimate says the line ends at 1.7 but speech runs to 2.0: the tail would be cut */
  const r = tailCorrected(x, 1.7, 1.0);
  assert.ok(r.end >= 2.0, `end ≥2.0, got ${r.end}`);
  assert.ok(r.cutEarly > 0.1, `cutEarly shows the loss, got ${r.cutEarly}`);
});

test('tailCorrected: speech done before the estimate keeps the estimate + margin', async () => {
  const f = join(dir, 'e.wav');
  toneThenQuiet(f, 1, 4);
  const x = await monoSamples(f);
  const r = tailCorrected(x, 2.0, 0.5);
  assert.ok(Math.abs(r.end - (2.0 + 0.14)) < 0.01, `end = estimate+0.14, got ${r.end}`);
  assert.equal(r.cutEarly, 0);
});
