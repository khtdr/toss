import { describe, expect, it } from 'vitest';
import { Encoder } from '../src/encoder.js';
import { parseFrame } from '../src/frame.js';
import { ascii, noise } from './helpers.js';

const options = { maxFrameBytes: 100, mime: 'application/json', kind: 'theme' };

describe('Encoder', () => {
  it('is deterministic', () => {
    const payload = noise(1000);
    const a = new Encoder(payload, options);
    const b = new Encoder(payload, options);
    expect(a.sessionId).toBe(b.sessionId);
    for (let t = 0; t < 40; t++) expect(a.nextFrame()).toEqual(b.frameAt(t));
  });

  it('loops forever without changing', () => {
    const encoder = new Encoder(noise(500), options);
    const first = Array.from({ length: encoder.cycleLength }, () => encoder.nextFrame());
    const second = Array.from({ length: encoder.cycleLength }, () => encoder.nextFrame());
    expect(second).toEqual(first);
  });

  it('never exceeds maxFrameBytes', () => {
    const encoder = new Encoder(noise(5000), options);
    for (let t = 0; t < encoder.cycleLength; t++) {
      expect(encoder.frameAt(t).length).toBeLessThanOrEqual(options.maxFrameBytes);
    }
  });

  it('spreads the body evenly across frames', () => {
    const encoder = new Encoder(noise(100), { ...options, maxFrameBytes: 64, compress: false });
    const sizes = new Set<number>();
    for (let t = 0; t < encoder.cycleLength; t++) {
      const parsed = parseFrame(encoder.frameAt(t));
      if (parsed.ok && parsed.frame.type === 'data') sizes.add(parsed.frame.block.length);
    }
    expect(Array.from(sizes)).toEqual([50]);
  });

  it('compresses by default when that helps', () => {
    const payload = ascii('{"color":"red"},'.repeat(200));
    const on = new Encoder(payload, options);
    const off = new Encoder(payload, { ...options, compress: false });
    expect(on.compressed).toBe(true);
    expect(off.compressed).toBe(false);
    expect(on.frameCount).toBeLessThan(off.frameCount);
    expect(on.sessionId).not.toBe(off.sessionId);
  });

  it('keeps the original when compression does not help', () => {
    expect(new Encoder(noise(1000), options).compressed).toBe(false);
  });

  it('is unaffected by later changes to the payload', () => {
    const payload = noise(300);
    const encoder = new Encoder(payload, options);
    const before = encoder.frameAt(1);
    payload.fill(0);
    expect(encoder.frameAt(1)).toEqual(before);
  });

  it('hands out frames that callers can safely change', () => {
    const encoder = new Encoder(noise(300), options);
    const header = encoder.frameAt(0);
    const copy = header.slice();
    header.fill(0);
    expect(encoder.frameAt(0)).toEqual(copy);
  });

  it('gives different data different sessions', () => {
    expect(new Encoder(noise(100, 1), options).sessionId).not.toBe(
      new Encoder(noise(100, 2), options).sessionId,
    );
  });

  it.each([13, 0, -1, 1.5, Number.NaN])('rejects maxFrameBytes of %d', (maxFrameBytes) => {
    expect(() => new Encoder(noise(10), { ...options, maxFrameBytes })).toThrow(RangeError);
  });

  it('rejects a header that cannot fit in one frame', () => {
    expect(() => new Encoder(noise(10), { ...options, maxFrameBytes: 50 })).toThrow(/header needs/);
  });

  it('rejects bad labels', () => {
    expect(() => new Encoder(noise(10), { ...options, kind: 'thème' })).toThrow(RangeError);
    expect(() => new Encoder(noise(10), { ...options, mime: 'x'.repeat(256) })).toThrow(RangeError);
  });
});
