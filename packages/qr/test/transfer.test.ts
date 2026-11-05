import { Decoder, Encoder } from 'toss-core';
import { describe, expect, it } from 'vitest';
import {
  frameToText,
  maxFrameBytes,
  smallestVersion,
  textCapacity,
  textToFrame,
  textToMatrix,
} from '../src/index.js';
import type { QrConfig } from '../src/index.js';
import { noise, scan, seeded, shuffled } from './helpers.js';

const config: QrConfig = { version: 8, errorCorrection: 'M' };

function sender(payload: Uint8Array, symbol = config) {
  const encoder = new Encoder(payload, {
    maxFrameBytes: maxFrameBytes(symbol),
    mime: 'application/octet-stream',
    kind: 'test',
    compress: false,
  });
  return { encoder, cycle: Array.from({ length: encoder.cycleLength }, (_, t) => encoder.frameAt(t)) };
}

function receive(texts: string[]) {
  const decoder = new Decoder();
  let last;
  for (const text of texts) {
    const read = textToFrame(text);
    if (!read.ok) continue;
    last = decoder.push(read.frame);
    if (last.payload) break;
  }
  return last;
}

describe('core frames through the QR carrier', () => {
  const payload = noise(3000);

  it('delivers a payload through real symbols', () => {
    const { cycle } = sender(payload);
    const texts = cycle.map((frame) => scan(textToMatrix(frameToText(frame), config))?.data ?? '');
    expect(receive(texts)?.payload).toEqual(payload);
  });

  it('never overflows the symbol it was sized for', () => {
    for (const symbol of [config, { version: 4, errorCorrection: 'L' }] as QrConfig[]) {
      const { cycle } = sender(noise(500), symbol);
      for (const frame of cycle) {
        expect(frameToText(frame).length).toBeLessThanOrEqual(textCapacity(symbol));
      }
    }
  });

  it('draws the whole cycle at one size, header frames included', () => {
    const { cycle } = sender(noise(1000));
    const sizes = new Set(cycle.map((frame) => textToMatrix(frameToText(frame), config).size));
    expect(sizes).toEqual(new Set([17 + 4 * config.version]));
  });

  it('copes with loss, reordering, duplicates, and joining mid-loop', () => {
    const { encoder } = sender(payload);
    const random = seeded(3);
    const start = Math.floor(encoder.cycleLength / 2);
    const texts: string[] = [];
    for (let t = start; t < start + encoder.cycleLength * 6; t++) {
      if (random() < 0.3) continue;
      const text = frameToText(encoder.frameAt(t));
      texts.push(text);
      if (random() < 0.2) texts.push(text);
    }
    expect(receive(shuffled(texts, 4))?.payload).toEqual(payload);
  });

  it('ignores other QR codes in view', () => {
    const { cycle } = sender(payload);
    const texts = cycle.flatMap((frame) => ['https://example.com', frameToText(frame), 'T']);
    expect(receive(texts)?.payload).toEqual(payload);
  });

  it('leaves damaged text for the frame CRC to catch', () => {
    const text = frameToText(sender(payload).cycle[0]!);
    // Index 1 is the low digit of the first group, so this stays valid base45.
    const damaged = `T${text[1] === '0' ? '1' : '0'}${text.slice(2)}`;
    const read = textToFrame(damaged);
    if (!read.ok) expect.fail(read.reason);
    expect(new Decoder().push(read.frame)).toMatchObject({ outcome: 'rejected', reason: 'bad-crc' });
  });

  it('sizes a symbol from a chosen frame size', () => {
    const version = smallestVersion(300, 'Q');
    const symbol: QrConfig = { version, errorCorrection: 'Q' };
    expect(maxFrameBytes(symbol)).toBeGreaterThanOrEqual(300);
    expect(maxFrameBytes({ ...symbol, version: version - 1 })).toBeLessThan(300);
  });

  it('refuses a symbol too small for the header', () => {
    expect(() => sender(payload, { version: 1, errorCorrection: 'H' })).toThrow();
  });
});
