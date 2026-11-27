// @ts-check
/**
 * Mosaic: boxes of a video pixelated (or blurred) away — faces, plates, watermarks, whatever should
 * not ship. Boxes are [x, y, w, h] in 0–1 of the picture from its top left, ADu's shape, so what the
 * privacy audit finds can be covered through the same door. Post-process on a rendered video with
 * ffmpeg's pixelize; nothing here touches the render pipeline.
 */

/**
 * The ffmpeg filter graph pixelating each box, each in its own time window.
 * @param {{ x: number, y: number, w: number, h: number, from?: number, to?: number }[]} boxes
 *   0–1 of the picture; from/to seconds, the whole video when left out
 * @param {{ width: number, height: number }} dim pixels
 * @param {{ size?: number }} [o] mosaic block size in pixels of the source (bigger blocks, heavier cover)
 * @returns {string} the -filter_complex graph, [vout] its last video pad
 */
export function mosaicGraph(boxes, dim, { size = 24 } = {}) {
  const parts = [];
  let input = '0:v';
  boxes.forEach((b, i) => {
    const px = Math.round(b.x * dim.width), py = Math.round(b.y * dim.height);
    const pw = Math.max(2, Math.round(b.w * dim.width)), ph = Math.max(2, Math.round(b.h * dim.height));
    const last = i === boxes.length - 1;
    const out = last ? 'vout' : `v${i}`;
    const enable = b.from != null || b.to != null
      ? `:enable='between(t,${(b.from ?? 0).toFixed(3)},${(b.to ?? 1e9).toFixed(3)})'`
      : '';
    parts.push(
      `[${input}]split=2[m${i}a][m${i}b]`,
      `[m${i}b]crop=${pw}:${ph}:${px}:${py},pixelize=width=${size}:height=${size}:mode=avg[m${i}p]`,
      `[m${i}a][m${i}p]overlay=${px}:${py}${enable}[${out}]`,
    );
    input = out;
  });
  return parts.join(';');
}

/**
 * Boxes parsed from cli words: `x,y,w,h` 0–1, or `x,y,w,h@from-to` with a time window.
 * @param {string[]} words @returns {{ x: number, y: number, w: number, h: number, from?: number, to?: number }[]}
 */
export function parseBoxes(words) {
  return words.map((word) => {
    const [geom, window] = word.split('@');
    const nums = geom.split(',').map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) throw new Error(`box does not read: ${word} — x,y,w,h in 0–1 of the picture`);
    const [x, y, w, h] = nums;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) throw new Error(`box out of the picture: ${word}`);
    const box = { x, y, w, h };
    if (window) {
      const [a, b] = window.split('-').map(Number);
      if (Number.isFinite(a)) box.from = a;
      if (Number.isFinite(b)) box.to = b;
    }
    return box;
  });
}
