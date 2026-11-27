#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft captions`: word-timed captions from sound.
 *
 *   openfilm craft captions transcribe <media> [out.vtt]   recognize the speech (the configured asr),
 *                                                          time it by the sound, write the vtt
 *   openfilm craft captions align <media> <text-file> [out.vtt]   the text is known (a transcript,
 *                                                          a script): align it to the sound, write
 *                                                          the vtt — no recognition needed
 *
 * Every line's characters are timed as inline timestamps (the WebVTT karaoke form): players that know
 * them highlight word by word, players that don't show the line whole. Without a word-time source
 * the timing is the even spread over where the sound says speech is — steady speech reads right.
 *
 * Exit status: 0 written, 1 the media or the recognition failed, 2 a wrong command.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { llmConfig } from '../src/llm.mjs';
import { wavOf, hearText, asrModel } from '../src/asr.mjs';
import { alignText } from '../src/caption-align.mjs';

const HELP = `openfilm craft captions — word-timed captions from sound

  transcribe <media> [out.vtt]        recognize the speech, write captions with word times
  align <media> <text-file> [out.vtt] the text known, align it to the sound — no recognition

  out.vtt defaults to <media>.vtt beside the media. Word times are inline timestamps in the
  cues — valid WebVTT everywhere, karaoke where it is known.
`;

function fail(what, code = 1) {
  console.error(`✗ ${what}`);
  process.exit(code);
}

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h') || !words.length) {
  console.log(HELP);
  process.exit(words.length ? 0 : 2);
}

const [mode, media, third, fourth] = words;
if (!media || !existsSync(media)) fail(`no such media file: ${media ?? '(none given)'}`, 2);
if (!['transcribe', 'align'].includes(mode)) fail(`unknown mode: ${mode} — transcribe or align`, 2);

const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', media], { encoding: 'utf8' });
const duration = parseFloat(probe.stdout);
if (!Number.isFinite(duration)) fail(`ffprobe reads no duration of ${media}`);

let text;
let out;
if (mode === 'align') {
  if (!third || !existsSync(third)) fail(`no such text file: ${third ?? '(none given)'}`, 2);
  text = readFileSync(third, 'utf8').trim();
  out = fourth;
} else {
  const config = llmConfig();
  if (!config) fail('transcribe wants the model configured: `openfilm craft llm-config` — or CRAFT_LLM_BASE_URL / CRAFT_LLM_API_KEY', 2);
  const wav = wavOf(media);
  if (!wav) fail(`ffmpeg reads no sound of ${media}`);
  console.log(`recognizing ${duration.toFixed(1)}s of sound (${asrModel(config)})…`);
  try {
    text = await hearText(config, wav, { model: asrModel(config) });
  } catch (e) {
    fail(`the recognition failed: ${/** @type {Error} */ (e).message}`);
  }
  if (!text) fail('nothing was heard — silence, or speech the model does not read');
  console.log(`heard: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);
  out = third;
}
out ??= media.replace(/\.[^.]+$/, '') + '.vtt';

const aligned = alignText(media, duration, text);
if (!aligned) fail(`no speech found in ${media} — the silence detector heard nothing but quiet`);
writeFileSync(out, aligned.vtt);
console.log(`✓ ${out}: ${aligned.cues.length} lines over ${aligned.stretches.length} stretches of speech, every character timed`);
for (const cue of aligned.cues.slice(0, 5)) {
  console.log(`  ${(cue.startMs / 1000).toFixed(1)}–${(cue.endMs / 1000).toFixed(1)}s  ${cue.text}`);
}
if (aligned.cues.length > 5) console.log(`  … ${aligned.cues.length - 5} more`);
