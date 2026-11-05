import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inflateExactly } from '../src/inflate.js';
import { noise } from './helpers.js';

/** One uncompressed DEFLATE block, so tests control the exact output. */
function stored(data: Uint8Array, final: boolean): Uint8Array {
  const block = new Uint8Array(5 + data.length);
  block[0] = final ? 1 : 0;
  block[1] = data.length & 0xff;
  block[2] = data.length >> 8;
  block[3] = ~data.length & 0xff;
  block[4] = (~data.length >> 8) & 0xff;
  block.set(data, 5);
  return block;
}

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('inflateExactly', () => {
  it('inflates a stream of exactly the right size', () => {
    const data = noise(5000);
    expect(inflateExactly(deflateSync(data), data.length)).toEqual(data);
  });

  it('reads stored blocks across chunk boundaries', () => {
    const a = noise(3000, 1);
    const b = noise(3000, 2);
    expect(inflateExactly(join(stored(a, false), stored(b, true)), 6000)).toEqual(join(a, b));
  });

  it('rejects a stream that fills the buffer exactly, then keeps going', () => {
    // 5 + 1019 bytes is one input chunk, so the first block lands on its own.
    const first = noise(1019, 1);
    const extra = noise(100, 2);
    const stream = join(stored(first, false), stored(extra, true));
    expect(inflateExactly(stream, first.length)).toBe('size-mismatch');
  });

  it('rejects a stream that falls short', () => {
    expect(inflateExactly(stored(noise(100), true), 101)).toBe('size-mismatch');
  });

  it('rejects a stream that never terminates', () => {
    const data = noise(100);
    expect(inflateExactly(stored(data, false), data.length)).toBe('decompress-failed');
  });

  it('rejects a stream cut off partway', () => {
    const data = noise(100);
    expect(inflateExactly(stored(data, true).subarray(0, 50), data.length)).toBe('decompress-failed');
  });

  it('rejects garbage', () => {
    expect(inflateExactly(new Uint8Array(50).fill(0xff), 100)).toBe('decompress-failed');
  });
});
