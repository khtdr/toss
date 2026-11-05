import { describe, expect, it } from 'vitest';
import {
  QUIET_ZONE_MODULES,
  frameToText,
  maxFrameBytes,
  textCapacity,
  textToFrame,
  textToMatrix,
} from '../src/index.js';
import type { ErrorCorrection, QrConfig } from '../src/index.js';
import { noise, scan } from './helpers.js';

const config: QrConfig = { version: 5, errorCorrection: 'M' };

/** `qrencode -v 1 -l M -m 0 TOSS`, which shares no code with this package. */
const QRENCODE_TOSS = `
XXXXXXX.XXX.X.XXXXXXX
X.....X...XX..X.....X
X.XXX.X..XX...X.XXX.X
X.XXX.X.XX.X..X.XXX.X
X.XXX.X.XX..X.X.XXX.X
X.....X.XX.X..X.....X
XXXXXXX.X.X.X.XXXXXXX
........XXXXX........
X...X.XXXX.X.XXXXX..X
XX.X...X.X.XX..X....X
.XXXX.XXXX.X..XXXXX..
.X.X....X.X..XX.XX.XX
X.XX..XXX...XXX..XXXX
........X.X.XXX...X.X
XXXXXXX.X...XX...X.X.
X.....X..XXXX..X.X..X
X.XXX.X.XXXX..XXX.XXX
X.XXX.X..X.XX..X.X.XX
X.XXX.X...XX..XXXXX..
X.....X..XX..XX.X.X.X
XXXXXXX.XXX.XXX...XXX
`.trim();

describe('textToMatrix', () => {
  // jsQR also reads mirrored symbols, so scanning alone can't catch a transposed
  // matrix. A phone's scanner might not.
  it('matches another encoder, module for module', () => {
    const { size, modules } = textToMatrix('TOSS', { version: 1, errorCorrection: 'M' });
    const rows = Array.from({ length: size }, (_, row) =>
      Array.from(modules.subarray(row * size, (row + 1) * size), (m) => (m ? 'X' : '.')).join(''),
    );
    expect(rows.join('\n')).toBe(QRENCODE_TOSS);
  });

  it.each([1, 2, 10, 22, 40])('draws version %i at its standard size', (version) => {
    const matrix = textToMatrix('T', { version, errorCorrection: 'M' });
    expect(matrix.size).toBe(17 + 4 * version);
    expect(matrix.modules).toHaveLength(matrix.size ** 2);
  });

  it('holds only 0 and 1', () => {
    const { modules } = textToMatrix('TOSS', config);
    expect(new Set(modules)).toEqual(new Set([0, 1]));
  });

  it('is deterministic', () => {
    expect(textToMatrix('TOSS', config)).toEqual(textToMatrix('TOSS', config));
  });

  it('draws short and long text at the same size', () => {
    const long = 'A'.repeat(textCapacity(config));
    expect(textToMatrix('T', config).size).toBe(textToMatrix(long, config).size);
  });

  it('uses alphanumeric mode, and only that', () => {
    const code = scan(textToMatrix('TOSS 123', config));
    expect(code?.chunks.map((chunk) => chunk.type)).toEqual(['alphanumeric']);
  });

  it('carries every alphanumeric character intact', () => {
    const text = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    expect(scan(textToMatrix(text, { version: 6, errorCorrection: 'M' }))?.data).toBe(text);
  });

  it('keeps leading, trailing, and repeated spaces', () => {
    const text = '  A  B  ';
    expect(scan(textToMatrix(text, config))?.data).toBe(text);
  });

  it('throws when the text exceeds the symbol', () => {
    const text = 'A'.repeat(textCapacity(config) + 1);
    expect(() => textToMatrix(text, config)).toThrow(RangeError);
  });

  it('throws on characters a QR alphanumeric segment cannot hold', () => {
    expect(() => textToMatrix('toss', config)).toThrow();
  });

  it('throws on a bad config', () => {
    expect(() => textToMatrix('T', { version: 41, errorCorrection: 'M' })).toThrow(RangeError);
  });

  it('exports the quiet zone the standard requires', () => {
    expect(QUIET_ZONE_MODULES).toBe(4);
  });
});

describe('a frame through a symbol', () => {
  it.each(['L', 'M', 'Q', 'H'] as ErrorCorrection[])('fills version 20 at level %s', (level) => {
    const symbol = { version: 20, errorCorrection: level };
    const frame = noise(maxFrameBytes(symbol));
    const code = scan(textToMatrix(frameToText(frame), symbol));
    expect(textToFrame(code?.data ?? '')).toEqual({ ok: true, frame });
  });

  it('survives damage within what error correction can repair', () => {
    const symbol: QrConfig = { version: 10, errorCorrection: 'H' };
    const frame = noise(100);
    const matrix = textToMatrix(frameToText(frame), symbol);
    const { size, modules } = matrix;
    // A block clear of the finder patterns.
    for (let row = 20; row < 28; row++) {
      for (let col = 20; col < 28; col++) modules[row * size + col]! ^= 1;
    }
    expect(textToFrame(scan(matrix)?.data ?? '')).toEqual({ ok: true, frame });
  });
});
