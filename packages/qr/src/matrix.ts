import { textCapacity } from './capacity.js';
import type { QrConfig } from './capacity.js';
import vendoredQrcode from './vendor/qrcode.js';

interface VendoredSymbol {
  addData(text: string, mode: 'Alphanumeric'): void;
  make(mask?: QrMask): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

const qrcode = vendoredQrcode as unknown as (version: number, level: string) => VendoredSymbol;

/** White modules a renderer must leave around the symbol, on every side. */
export const QUIET_ZONE_MODULES = 4;

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** Row by row: `modules[row * size + col]` is 1 for dark, 0 for light. */
  modules: Uint8Array;
}

/** One of the eight masks in the QR standard. Scanners read which one was used. */
export type QrMask = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface MatrixOptions extends QrConfig {
  /**
   * Uses this mask instead of searching for the best one. That's about seven
   * times faster on a phone, and made no measurable difference to scanning.
   */
  mask?: QrMask;
}

/**
 * Lays out text as a QR symbol of exactly `config.version`, so every frame in a
 * transfer draws at the same size however short it is. Throws if the text
 * doesn't fit or isn't in the alphanumeric set.
 *
 * Without a `mask` this is slow enough to matter, about 26 ms at version 20 in
 * Node. A plain loop repeats its frames, so render each one once and reuse it.
 */
export function textToMatrix(text: string, options: MatrixOptions): QrMatrix {
  const { mask } = options;
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    throw new RangeError(`${String(mask)} is not a QR mask`);
  }

  const capacity = textCapacity(options);
  if (text.length > capacity) {
    throw new RangeError(`${text.length} characters exceed the symbol's capacity of ${capacity}`);
  }

  const qr = qrcode(options.version, options.errorCorrection);
  qr.addData(text, 'Alphanumeric');
  qr.make(mask);

  const size = qr.getModuleCount();
  const modules = new Uint8Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) modules[row * size + col] = 1;
    }
  }
  return { size, modules };
}
