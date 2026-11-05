import { describe, expect, it } from 'vitest';
import { Decoder } from '../src/decoder.js';
import { Encoder } from '../src/encoder.js';
import {
  ascii,
  bursty,
  chain,
  duplicating,
  everyKth,
  lossy,
  noise,
  reordering,
  run,
  seeded,
} from './helpers.js';

const options = { maxFrameBytes: 120, mime: 'application/octet-stream', kind: 'blob' };

/** Frame counts around the small-transfer boundary, and a few larger ones. */
const SIZES = [0, 1, 106, 107, 108, 500, 750, 800, 851, 5000, 40_000];
const SEEDS = [1, 2, 3, 4, 5];

const cases = SIZES.flatMap((size) => SEEDS.map((seed) => [size, seed] as const));

function expectDelivered(size: number, seed: number, build: (random: () => number) => Parameters<typeof run>[1]) {
  const payload = noise(size, seed);
  const encoder = new Encoder(payload, options);
  const { result } = run(encoder, build(seeded(seed * 7919 + size)));
  expect(result.state).toBe('done');
  expect(result.payload).toEqual(payload);
}

describe('transfer over a simulated channel', () => {
  it.each(SIZES)('clean channel, %i bytes', (size) => {
    expectDelivered(size, 1, () => ({}));
  });

  it.each(cases)('30%% loss, %i bytes, seed %i', (size, seed) => {
    expectDelivered(size, seed, (r) => ({ channel: lossy(0.3, r) }));
  });

  it.each(cases)('70%% loss, %i bytes, seed %i', (size, seed) => {
    expectDelivered(size, seed, (r) => ({ channel: lossy(0.7, r) }));
  });

  it.each(cases)('duplicates, %i bytes, seed %i', (size, seed) => {
    expectDelivered(size, seed, (r) => ({ channel: duplicating(0.5, r) }));
  });

  it.each(cases)('reordering, %i bytes, seed %i', (size, seed) => {
    expectDelivered(size, seed, (r) => ({ channel: reordering(40, r) }));
  });

  it.each(cases)('joining mid-loop, %i bytes, seed %i', (size, seed) => {
    expectDelivered(size, seed, (r) => ({ joinAt: Math.floor(r() * 1000) }));
  });

  it.each(cases)('bursts of loss, %i bytes, seed %i', (size, seed) => {
    expectDelivered(size, seed, (r) => ({ channel: bursty(0.3, 6, r) }));
  });

  it.each(cases)('all at once, %i bytes, seed %i', (size, seed) => {
    expectDelivered(size, seed, (r) => ({
      joinAt: Math.floor(r() * 1000),
      channel: chain(bursty(0.2, 4, r), lossy(0.2, r), duplicating(0.3, r), reordering(25, r)),
    }));
  });

  it('joins at every position in the cycle', () => {
    const payload = noise(2000);
    const encoder = new Encoder(payload, options);
    for (let joinAt = 0; joinAt < encoder.cycleLength; joinAt++) {
      expect(run(encoder, { joinAt }).result.payload).toEqual(payload);
    }
  });

  it('finishes within one cycle plus one frame when nothing is lost', () => {
    const encoder = new Encoder(noise(2000), options);
    for (let joinAt = 0; joinAt < encoder.cycleLength; joinAt++) {
      expect(run(encoder, { joinAt }).slots).toBeLessThanOrEqual(encoder.cycleLength);
    }
  });

  it('compressed payloads survive the same channel', () => {
    const payload = ascii('{"key":"value"},'.repeat(1000));
    const r = seeded(11);
    const channel = chain(lossy(0.3, r), duplicating(0.3, r), reordering(20, r));
    const { result } = run(new Encoder(payload, options), { joinAt: 17, channel });
    expect(result.payload).toEqual(payload);
  });
});

describe('phase-locked cameras', () => {
  const ks = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  const sizes = [1, 107, 214, 321, 850, 5000, 14_000, 40_000];
  const periodic = sizes.flatMap((size) => ks.map((k) => [size, k] as const));

  it.each(periodic)('%i bytes, every %ith frame, from every phase', (size, k) => {
    const payload = noise(size);
    const encoder = new Encoder(payload, options);
    for (let offset = 0; offset < k; offset++) {
      const { result, slots } = run(encoder, { channel: everyKth(k, offset) });
      expect(result.payload).toEqual(payload);
      // Coprime to k, so k passes over the cycle reach every slot.
      expect(slots).toBeLessThanOrEqual(k * encoder.cycleLength);
    }
  });
});

describe('two senders in view', () => {
  it('delivers one of them intact when their frames interleave', () => {
    const a = noise(3000, 1);
    const b = noise(3000, 2);
    const encoders = [new Encoder(a, options), new Encoder(b, options)];
    const random = seeded(5);
    const decoder = new Decoder();
    for (let t = 0; t < 100_000; t++) {
      const encoder = encoders[random() < 0.5 ? 0 : 1]!;
      const result = decoder.push(encoder.frameAt(Math.floor(random() * 1000)));
      if (result.done) {
        expect([a, b]).toContainEqual(result.payload);
        expect(result.otherSessionFrames).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error('never finished');
  });

  it('never mixes frames from a sender of the same size', () => {
    const payload = noise(800, 3);
    const other = noise(800, 4);
    const mine = new Encoder(payload, options);
    const theirs = new Encoder(other, options);
    const decoder = new Decoder();
    decoder.push(mine.frameAt(0));
    for (let t = 0; t < mine.cycleLength; t++) {
      decoder.push(theirs.frameAt(t));
      const result = decoder.push(mine.frameAt(t));
      if (result.done) {
        expect(result.payload).toEqual(payload);
        return;
      }
    }
    throw new Error('never finished');
  });
});

describe('hostile channel', () => {
  it('never throws, and never accepts a bad payload, under random corruption', () => {
    const payload = noise(3000);
    const encoder = new Encoder(payload, options);
    const random = seeded(99);
    const decoder = new Decoder();
    for (let t = 0; t < 50_000; t++) {
      const frame = encoder.frameAt(t);
      if (random() < 0.5) frame[Math.floor(random() * frame.length)]! ^= 1 << Math.floor(random() * 8);
      const result = decoder.push(random() < 0.1 ? noise(Math.floor(random() * 200), t) : frame);
      if (result.done) {
        expect(result.payload).toEqual(payload);
        return;
      }
    }
    throw new Error('never finished');
  });
});
