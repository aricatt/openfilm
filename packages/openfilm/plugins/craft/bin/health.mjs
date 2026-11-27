#!/usr/bin/env node
// @ts-check
/**
 * `openfilm craft health`: what in the project keeps the film from drawing, read from its files —
 * no browser. Run it before a render or a preview: a broken project said in words, not a browser's silence.
 *
 * Exit status: 0 nothing found, 1 problems found, 2 not a project.
 */
import { lookProject } from '../../../src/plugin-look.mjs';
import { healthOf } from '../src/health.mjs';

const root = lookProject([]);
if (!root) { console.error('✗ not in a project (no film.html here or above)'); process.exit(2); }
const problems = healthOf(root);
if (!problems.length) {
  console.log('✓ the film can draw — film.html reads, every page on the timeline is there, every script runs');
  process.exit(0);
}
for (const p of problems) console.log(`✗ ${p}`);
process.exit(1);
