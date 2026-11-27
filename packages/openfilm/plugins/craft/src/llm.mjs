// @ts-check
/**
 * craft's LLM client: one OpenAI-compatible chat endpoint, configured once for the user — never in the
 * project, never in the repo. Configuration, first found wins:
 *
 *   env:  CRAFT_LLM_BASE_URL / CRAFT_LLM_API_KEY / CRAFT_LLM_MODEL
 *   file: ~/.config/craft/llm.json  { "baseUrl": …, "apiKey": …, "model": … }
 *
 * The file is the user's own (write it with `openfilm craft llm-config`); the key never enters film.html,
 * the journal, or anything committed. The model reads frames for the vision checks (密字/字不停) — that is
 * all craft asks of it; editing itself is deterministic and needs no model.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** @returns {{ baseUrl: string, apiKey: string, model: string } | null} */
export function llmConfig() {
  const env = {
    baseUrl: process.env.CRAFT_LLM_BASE_URL,
    apiKey: process.env.CRAFT_LLM_API_KEY,
    model: process.env.CRAFT_LLM_MODEL,
  };
  if (env.baseUrl && env.apiKey) return { baseUrl: env.baseUrl, apiKey: env.apiKey, model: env.model || 'mimo-v2.6-flash' };
  const file = join(homedir(), '.config', 'craft', 'llm.json');
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.baseUrl && data.apiKey) return { baseUrl: data.baseUrl, apiKey: data.apiKey, model: data.model || 'mimo-v2.6-flash' };
  } catch { /* a broken file is no configuration */ }
  return null;
}

/** Write the user's configuration file (0600-ish — the user's own directory, nothing world-readable here). */
export function writeLlmConfig(/** @type {{ baseUrl: string, apiKey: string, model: string }} */ config) {
  const dir = join(homedir(), '.config', 'craft');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'llm.json');
  writeFileSync(file, JSON.stringify({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }, null, 2) + '\n');
  return file;
}

/**
 * One chat completion. These models reason (reasoning_content) and spend tokens on it: max_tokens has to
 * cover the reasoning plus the answer. Returns the message's content text.
 * @param {{ baseUrl: string, apiKey: string, model: string }} config
 * @param {{ role: string, content: unknown }[]} messages
 * @param {{ maxTokens?: number, timeoutMs?: number }} [o]
 */
export async function chat(config, messages, { maxTokens = 2000, timeoutMs = 60_000, reasoning = 'none' } = {}) {
  /* reasoning off by default: what craft asks is reading, not thinking — the same model spends 4 tokens
     answering instead of hundreds reasoning, when the endpoint honours it (a harmlessness when not) */
  const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens, ...(reasoning ? { reasoning_effort: reasoning } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('the model answered nothing (its reasoning may have spent the tokens — a larger max_tokens, or a shorter ask)');
  return content;
}

/**
 * One image read: the frame as a data URL, the ask in words. Returns the content text.
 * @param {{ baseUrl: string, apiKey: string, model: string }} config
 * @param {Buffer} png the frame's bytes
 * @param {string} ask
 * @param {{ maxTokens?: number }} [o]
 */
export async function seeImage(config, png, ask, { maxTokens = 2000 } = {}) {
  return chat(config, [
    { role: 'user', content: [
      { type: 'text', text: ask },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
    ] },
  ], { maxTokens });
}
