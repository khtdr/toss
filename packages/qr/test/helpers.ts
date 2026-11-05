import jsQRModule from 'jsqr';
import { QUIET_ZONE_MODULES } from '../src/index.js';
import type { QrMatrix } from '../src/index.js';

// The types describe an ES default export, but at runtime this is the function.
const jsQR = jsQRModule as unknown as typeof jsQRModule.default;

/** mulberry32: a small seeded generator returning values in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Deterministic bytes that won't compress. */
export function noise(length: number, seed = 1): Uint8Array {
  const random = seeded(seed);
  return Uint8Array.from({ length }, () => Math.floor(random() * 256));
}

export function shuffled<T>(items: T[], seed: number): T[] {
  const random = seeded(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Reads a matrix the way a camera would: as pixels, with an unrelated decoder. */
export function scan({ size, modules }: QrMatrix, scale = 3, quiet = QUIET_ZONE_MODULES) {
  const width = (size + 2 * quiet) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(0xff);
  for (let y = 0; y < size * scale; y++) {
    for (let x = 0; x < size * scale; x++) {
      if (!modules[Math.floor(y / scale) * size + Math.floor(x / scale)]) continue;
      const pixel = ((y + quiet * scale) * width + x + quiet * scale) * 4;
      pixels[pixel] = pixels[pixel + 1] = pixels[pixel + 2] = 0;
    }
  }
  return jsQR(pixels, width, width);
}
