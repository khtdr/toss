import jsQRModule from 'jsqr';
import type { SymbolFrame } from '../src/symbol.js';

// The CommonJS default arrives as the function itself, whatever the types say.
const jsQR = jsQRModule as unknown as typeof jsQRModule.default;

const PIXELS_PER_MODULE = 3;

/** Paints a path the way a renderer would, so this tests what's really drawn. */
export function rasterize({ path, modules }: SymbolFrame) {
  const side = modules * PIXELS_PER_MODULE;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [, x, y, width] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let row = 0; row < PIXELS_PER_MODULE; row++) {
      const top = Number(y) * PIXELS_PER_MODULE + row;
      const left = Number(x) * PIXELS_PER_MODULE;
      for (let col = 0; col < Number(width) * PIXELS_PER_MODULE; col++) {
        data.fill(0, (top * side + left + col) * 4, (top * side + left + col) * 4 + 3);
      }
    }
  }
  return { data, side };
}

/** Reads a symbol back as a phone's scanner would, returning its text. */
export function scan(symbol: SymbolFrame): string {
  const { data, side } = rasterize(symbol);
  const result = jsQR(data, side, side);
  if (!result) throw new Error('the symbol did not scan');
  return result.data;
}

/** Bytes that won't compress, so frame counts are predictable. */
export function noise(length: number, seed = 1): Uint8Array {
  let state = seed;
  return Uint8Array.from({ length }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  });
}

/** A small, repeatable random source for simulating loss. */
export function chance(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
