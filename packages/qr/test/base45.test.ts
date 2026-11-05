import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from '../src/base45.js';
import { noise } from './helpers.js';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe('base45', () => {
  // The examples in RFC 9285, section 4.
  it.each([
    ['AB', 'BB8'],
    ['Hello!!', '%69 VD92EX0'],
    ['base-45', 'UJCLQE7W581'],
    ['ietf!', 'QED8WEX0'],
  ])('matches the RFC for %s', (plain, encoded) => {
    expect(encodeBase45(ascii(plain))).toBe(encoded);
    expect(decodeBase45(encoded)).toEqual(ascii(plain));
  });

  it('handles empty input', () => {
    expect(encodeBase45(new Uint8Array())).toBe('');
    expect(decodeBase45('')).toEqual(new Uint8Array());
  });

  it('round-trips every 1-byte value', () => {
    for (let value = 0; value < 256; value++) {
      const bytes = Uint8Array.of(value);
      const text = encodeBase45(bytes);
      expect(text).toHaveLength(2);
      expect(decodeBase45(text)).toEqual(bytes);
    }
  });

  it('round-trips every 2-byte value', () => {
    for (let value = 0; value < 65536; value++) {
      const bytes = Uint8Array.of(value >> 8, value & 0xff);
      const decoded = decodeBase45(encodeBase45(bytes));
      if (decoded === undefined || decoded[0] !== bytes[0] || decoded[1] !== bytes[1]) {
        expect.fail(`value ${value} came back as ${decoded}`);
      }
    }
  });

  it('round-trips lengths around a group boundary', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = noise(length, length + 1);
      const text = encodeBase45(bytes);
      expect(text).toHaveLength(Math.floor(length / 2) * 3 + (length % 2) * 2);
      expect(decodeBase45(text)).toEqual(bytes);
    }
  });

  it('accepts exactly the 3-character groups that fit in 2 bytes', () => {
    let accepted = 0;
    for (const a of ALPHABET) {
      for (const b of ALPHABET) {
        for (const c of ALPHABET) if (decodeBase45(a + b + c)) accepted++;
      }
    }
    expect(accepted).toBe(65536);
  });

  it('rejects the first values past each limit', () => {
    expect(decodeBase45('FGW')).toEqual(Uint8Array.of(0xff, 0xff));
    expect(decodeBase45('GGW')).toBeUndefined(); // 65536
    expect(decodeBase45('U5')).toEqual(Uint8Array.of(0xff));
    expect(decodeBase45('V5')).toBeUndefined(); // 256
  });

  it.each([
    ['a lone trailing character', 'A'],
    ['four characters', 'BB8A'],
    ['lower case', 'bb8'],
    ['a bad first character', '#B8'],
    ['a bad second character', 'B#8'],
    ['a bad third character', 'BB#'],
    ['an invalid character in a tail', 'B#'],
    ['non-ASCII text', 'BBé'],
    ['an emoji', '😀B'],
    ['a NUL', 'B\0B'],
  ])('rejects %s', (_, text) => {
    expect(decodeBase45(text)).toBeUndefined();
  });
});
