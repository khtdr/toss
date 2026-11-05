import { describe, expect, it } from 'vitest';
import { MAX_TEXT_LENGTH, frameToText, textToFrame } from '../src/index.js';
import { noise, seeded } from './helpers.js';

const QR_ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;

describe('frameToText', () => {
  it('starts with the marker, then base45', () => {
    expect(frameToText(Uint8Array.of(0x41, 0x42))).toBe('TBB8');
  });

  it('stays in the QR alphanumeric set', () => {
    expect(frameToText(noise(5000))).toMatch(QR_ALPHANUMERIC);
  });

  it('never starts or ends with whitespace, whatever the frame holds', () => {
    for (let value = 0; value < 65536; value++) {
      const pair = Uint8Array.of(value >> 8, value & 0xff);
      for (const text of [frameToText(pair), frameToText(pair.subarray(0, 1))]) {
        if (text !== text.trim()) expect.fail(`text for ${value} has outer whitespace`);
      }
    }
  });
});

describe('textToFrame', () => {
  it('round-trips frames of every length around a group boundary', () => {
    for (let length = 0; length < 40; length++) {
      const frame = noise(length, length + 1);
      expect(textToFrame(frameToText(frame))).toEqual({ ok: true, frame });
    }
  });

  it.each([
    ['nothing', ''],
    ['a URL', 'https://example.com'],
    ['bare base45 with no marker', 'BB8'],
    ['a lower-case marker', 'tBB8'],
    ['a leading space', ' TBB8'],
  ])('says %s is not a toss frame', (_, text) => {
    expect(textToFrame(text)).toEqual({ ok: false, reason: 'not-toss' });
  });

  it.each([
    ['a bad length', 'TA'],
    ['a value over 16 bits', 'TGGW'],
    ['a value over 8 bits', 'TV5'],
    ['lower case', 'Tbb8'],
    ['text that merely starts with T', 'Thanks for scanning!'],
  ])('rejects %s', (_, text) => {
    expect(textToFrame(text)).toEqual({ ok: false, reason: 'bad-base45' });
  });

  it('accepts the longest text a symbol can hold', () => {
    const longest = `T${'0'.repeat(MAX_TEXT_LENGTH - 1)}`;
    expect(longest).toHaveLength(MAX_TEXT_LENGTH);
    expect(textToFrame(longest)).toEqual({ ok: true, frame: new Uint8Array(2863) });
  });

  it('rejects anything longer than any symbol can hold', () => {
    const text = `T${'0'.repeat(MAX_TEXT_LENGTH)}`;
    expect(textToFrame(text)).toEqual({ ok: false, reason: 'too-long' });
  });

  it('survives arbitrary text without throwing', () => {
    const random = seeded(7);
    for (let i = 0; i < 20_000; i++) {
      const length = Math.floor(random() * 40);
      const body = Array.from({ length }, () =>
        String.fromCharCode(Math.floor(random() * 0x10000)),
      ).join('');
      expect(textToFrame(`T${body}`).ok).toBe(length === 0);
    }
  });
});
