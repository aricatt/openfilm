#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft llm-config <base-url> <api-key> [model]`: write the model configuration craft's vision
 * checks read (~/.config/craft/llm.json — the user's own, never the project's, never committed).
 * Without arguments: say what is configured (the key partly hidden).
 *
 * Exit status: 0 written or read, 2 a wrong command.
 */
import { llmConfig, writeLlmConfig } from '../src/llm.mjs';

const words = process.argv.slice(2).filter((w) => !w.startsWith('--'));
if (!words.length) {
  const config = llmConfig();
  if (!config) {
    console.log('nothing configured — `openfilm craft llm-config <base-url> <api-key> [model]`, or CRAFT_LLM_BASE_URL / CRAFT_LLM_API_KEY in the environment');
    process.exit(2);
  }
  console.log(`${config.baseUrl} · ${config.model} · key ${config.apiKey.slice(0, 6)}…${config.apiKey.slice(-4)}`);
  process.exit(0);
}
if (words.length < 2) {
  console.error('✗ `openfilm craft llm-config <base-url> <api-key> [model]`');
  process.exit(2);
}
const file = writeLlmConfig({ baseUrl: words[0], apiKey: words[1], model: words[2] ?? 'mimo-v2.6-flash' });
console.log(`✓ written to ${file} — the key is nowhere in the project`);
