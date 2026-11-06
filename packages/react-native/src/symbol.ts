import { QUIET_ZONE_MODULES } from 'toss-qr';
import type { QrMatrix } from 'toss-qr';

/** One QR symbol, ready to draw. */
export interface SymbolFrame {
  /** SVG path of the dark modules, in module units, offset by the quiet zone. */
  path: string;
  /** Modules per side, quiet zone included. */
  modules: number;
}

/** Something that holds the symbol to show now, and says when it changes. */
export interface SymbolSource {
  subscribe(listener: () => void): () => void;
  getSymbol(): SymbolFrame;
}

/** One rectangle per horizontal run of dark modules. */
export function matrixToPath({ size, modules }: QrMatrix): string {
  let path = '';
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!modules[row * size + col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && modules[row * size + col]) col++;
      const x = start + QUIET_ZONE_MODULES;
      const y = row + QUIET_ZONE_MODULES;
      path += `M${x} ${y}h${col - start}v1h-${col - start}z`;
    }
  }
  return path;
}

/**
 * The largest side, in layout units, that fits `maxSide` and gives every module
 * a whole number of pixels. Blurred module edges cost scans. Returns 0 if the
 * space is too small for one pixel per module.
 */
export function crispSide(maxSide: number, modules: number, pixelRatio: number): number {
  const pixelsPerModule = Math.floor((maxSide * pixelRatio) / modules);
  return (pixelsPerModule * modules) / pixelRatio;
}
