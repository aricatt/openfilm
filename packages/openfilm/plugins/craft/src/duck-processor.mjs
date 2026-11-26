// @ts-check
/**
 * The ducking processor: a clip's gain ridden per cell of the film, as the curve worked out for it says
 * (duck-curve.mjs). Pure JavaScript, nothing of Node's or a browser's — the same file can be loaded into the
 * preview's AudioWorklet and into the export's Node. It is registered with the sound engine on import
 * (`defineProcessor`, src/sound-engine.mjs), in whichever realm loads it.
 *
 * The step's settings:
 *   gains    the curve: linear gain per cell of GRID seconds of the film (duck-curve.mjs), as a plain array
 *   at       the film second the clip's sound starts at (its placement on the timeline)
 *
 * The processor sees the clip's own sound from its first frame; the film second of frame i is
 * `at + i / rate`, so the curve — written on the film's time — is read there.
 */
import { defineProcessor } from '../../../src/sound-engine.mjs';
import { GRID } from './duck-curve.mjs';

/** @param {{ gains?: number[], at?: number }} step @param {number} rate */
function makeDuck(step, rate) {
  const gains = Array.isArray(step.gains) ? Float32Array.from(step.gains) : null;
  if (!gains?.length) throw new Error('craft-duck: the step wants its gains, an array per 10 ms of the film');
  const at = typeof step.at === 'number' && isFinite(step.at) ? step.at : 0;
  const per = rate * GRID;
  /* frames of this clip's sound taken so far */
  let n = 0;
  return {
    /** @param {Float32Array} inL @param {Float32Array} inR @param {Float32Array} outL @param {Float32Array} outR */
    process(inL, inR, outL, outR) {
      for (let i = 0; i < inL.length; i++) {
        /* the film second of this frame, its cell of the curve; before the clip's placement and past the
           curve's end the gain is full — the curve only covers what the analysis saw */
        const cell = Math.floor((at + (n + i) / rate) / GRID);
        const g = cell >= 0 && cell < gains.length ? gains[cell] : 1;
        /* the cell's gain shared evenly across its frames: the curve's own smoothing (attack, release) is
           much finer than a cell, so no step is heard */
        outL[i] = inL[i] * g;
        outR[i] = inR[i] * g;
      }
      n += inL.length;
    },
  };
}

defineProcessor('craft-duck', /** @param {never} step @param {number} rate */ (step, rate) => makeDuck(step, rate));

export { makeDuck };
