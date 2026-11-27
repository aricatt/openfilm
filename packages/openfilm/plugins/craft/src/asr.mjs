// @ts-check
/**
 * craft's ASR client: speech to text through the same OpenAI-compatible chat endpoint as the vision
 * reads, but the recognition model (mimo-v2.5-asr) — audio goes as base64 input_audio in a chat message,
 * there is no transcriptions endpoint. wav/mp3 only, 10 MB of base64 at most: craft feeds it wav
 * decoded by ffmpeg, so whatever the project holds (m4a, a video's own sound) is read the same.
 *
 * The model is configured apart from the reading one: CRAFT_ASR_MODEL in the environment or
 * `asrModel` in ~/.config/craft/llm.json, `mimo-v2.5-asr` when neither says.
 */
import { spawnSync } from 'node:child_process';

/** @param {{ baseUrl: string, apiKey: string, model: string, asrModel?: string }} config */
export const asrModel = (config) => process.env.CRAFT_ASR_MODEL || config.asrModel || 'mimo-v2.5-asr';

/**
 * The file's sound as wav bytes: 16 kHz mono pcm_s16le, small and what recognition wants.
 * @param {string} file @returns {Buffer | null} null when ffmpeg cannot read it
 */
export function wavOf(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'wav', '-'],
    { encoding: 'buffer', timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 && r.stdout?.length ? r.stdout : null;
}

/**
 * Recognize speech in wav bytes. Returns the raw message content — what the model says, text and
 * whatever timing it carries (the docs say nothing of word times; `hearRaw` keeps the whole response
 * so a caller can see what there is).
 * @param {{ baseUrl: string, apiKey: string }} config
 * @param {Buffer} wav
 * @param {{ language?: string, model?: string, timeoutMs?: number }} [o]
 */
export async function hearRaw(config, wav, { language = 'zh', model, timeoutMs = 120_000 } = {}) {
  const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: model ?? 'mimo-v2.5-asr',
      messages: [
        { role: 'user', content: [
          { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}` } },
        ] },
      ],
      asr_options: { language },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`ASR ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

/** The recognition's text, or null when nothing was heard. */
export async function hearText(config, wav, o = {}) {
  const data = await hearRaw(config, wav, o);
  const content = data.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim() ? content.trim() : null;
}
