// @ts-check
/**
 * The privacy audit: frames read by the model, the names no one consented to expose found by the
 * deterministic rules (audit-names), the covers they need as mosaic boxes. Vision does what it is
 * good at (reading every text with its place), the rules do what they are good at (whose it is).
 */
import { exposedNames } from './audit-names.mjs';

/** The ask: every text with its box, however small — privacy hides in the small print. */
export const AUDIT_ASK = `Read every piece of text visible in this image, however small — comments, nicknames, counts, buttons, watermarks.
Answer with JSON only, no other text: an array, one entry per piece: {"s": the text exactly as written, "box": [x, y, w, h]}.
box is the piece's rectangle as 0-1 shares of the image from its top left. No text: [].`;

/**
 * The covers a read frame needs: every block whose text exposes someone's name, its box a touch padded.
 * @param {{ s: string, box: number[] }[]} blocks @param {string[]} own
 * @returns {{ x: number, y: number, w: number, h: number, name: string, kind: string }[]}
 */
export function coversOf(blocks, own = []) {
  const out = [];
  for (const b of blocks) {
    if (!b?.s?.trim() || !Array.isArray(b.box) || b.box.length !== 4) continue;
    const exposed = exposedNames(b.s, own);
    if (!exposed.length) continue;
    const [x, y, w, h] = b.box;
    out.push({
      x: Math.max(0, x - w * 0.05), y: Math.max(0, y - h * 0.3),
      w: Math.min(1 - x, w * 1.1), h: Math.min(1 - y, h * 1.6),
      name: exposed[0].name, kind: exposed[0].kind,
    });
  }
  return out;
}

/**
 * The model's answer read hard: JSON only, boxes validated into range, everything else dropped.
 * @param {string} content @returns {{ s: string, box: number[] }[] | null} null when it does not read
 */
export function readAuditAnswer(content) {
  const m = /\[[\s\S]*\]/.exec(content);
  if (!m) return null;
  try {
    const data = JSON.parse(m[0]);
    if (!Array.isArray(data)) return null;
    return data.filter((b) => b && typeof b.s === 'string'
      && Array.isArray(b.box) && b.box.length === 4 && b.box.every((n) => Number.isFinite(n))
      && b.box[0] >= -0.01 && b.box[1] >= -0.01 && b.box[2] > 0 && b.box[3] > 0
      && b.box[0] + b.box[2] <= 1.05 && b.box[1] + b.box[3] <= 1.05)
      .map((b) => ({ s: b.s, box: b.box.map((n) => Math.min(1, Math.max(0, n))) }));
  } catch {
    return null;
  }
}
