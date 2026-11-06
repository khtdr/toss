import { describe, expect, it } from 'vitest';
import { crispSide, matrixToPath } from '../src/symbol.js';

describe('matrixToPath', () => {
  it('draws one rectangle per run, offset by the quiet zone', () => {
    const modules = Uint8Array.from([1, 1, 0, 0, 0, 1, 1, 0, 1]);
    expect(matrixToPath({ size: 3, modules })).toBe(
      'M4 4h2v1h-2z' + 'M6 5h1v1h-1z' + 'M4 6h1v1h-1z' + 'M6 6h1v1h-1z',
    );
  });

  it('draws nothing for an empty matrix', () => {
    expect(matrixToPath({ size: 2, modules: new Uint8Array(4) })).toBe('');
  });
});

describe('crispSide', () => {
  it('gives every module a whole number of pixels', () => {
    const side = crispSide(360, 145, 3);
    expect(side * 3).toBe(7 * 145);
  });

  it('never exceeds the space available', () => {
    expect(crispSide(411.4, 145, 2.625)).toBeLessThanOrEqual(411.4);
  });

  it('returns 0 when a module would be smaller than a pixel', () => {
    expect(crispSide(100, 145, 1)).toBe(0);
  });
});
