import { Decoder, Encoder } from 'toss-core';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE,
  SittingClock,
  effortOf,
  estimateFrames,
  formatDuration,
  formatRange,
  passSeconds,
  planTransfer,
} from '../src/lib/estimate';
import type { Link } from '../src/lib/estimate';

const link: Link = { fps: 10, blockBytes: 1314 };

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function noise(length: number, seed = 1): Uint8Array {
  const next = random(seed);
  return Uint8Array.from({ length }, () => Math.floor(next() * 256));
}

/** Runs a real encoder and decoder through a lossy loop, returning when each block arrived. */
function simulate(frames: number, capture: number, seed: number) {
  const blockBytes = 200;
  const encoder = new Encoder(noise(frames * blockBytes, seed), {
    maxFrameBytes: blockBytes + 13,
    mime: 'a/b',
    kind: 'c',
    compress: false,
  });
  const decoder = new Decoder();
  const next = random(seed + 1);
  const missingAt: number[] = [];
  for (let t = 0; ; t++) {
    if (next() < capture) {
      const result = decoder.push(encoder.frameAt(t));
      if (result.done) return { seconds: t / link.fps, missingAt };
      missingAt[t] = frames - (result.progress.total === null ? 0 : result.progress.received);
    } else {
      missingAt[t] = missingAt[t - 1] ?? frames;
    }
  }
}

describe('estimateFrames', () => {
  it('matches the 1 MB noise run on real phones, 4 min 15 s over 798 frames', () => {
    const { low, high } = estimateFrames(798, link);
    expect(low).toBeLessThanOrEqual(255);
    expect(high).toBeGreaterThanOrEqual(255);
    expect(high).toBeLessThan(6 * 60);
  });

  it('matches the 50 KB noise runs, 8.3-12.0 s over 39 frames', () => {
    const { low, high } = estimateFrames(39, link);
    expect(low).toBeLessThan(12);
    expect(high).toBeGreaterThan(8.3);
  });

  it.each([20, 50, 400, 1500])('puts the median simulated run of %i frames inside the range', (frames) => {
    const { low, high } = estimateFrames(frames, link);
    const runs = Array.from({ length: 41 }, (_, seed) => simulate(frames, CAPTURE.likely, seed + 1).seconds);
    const median = runs.sort((a, b) => a - b)[20]!;
    expect(median).toBeGreaterThanOrEqual(low);
    expect(median).toBeLessThanOrEqual(high);
  });

  it('takes no time for an empty file', () => {
    expect(estimateFrames(0, link)).toEqual({ low: 0, high: 0 });
  });

  it('never promises less than one pass', () => {
    expect(estimateFrames(1, link).low).toBe(passSeconds(1, link));
  });
});

describe('planTransfer', () => {
  it('counts every frame for a file that will not compress, and skips compressing it', () => {
    const plan = planTransfer(noise(1024 * 1024), link);
    expect(plan.compress).toBe(false);
    expect(plan.frames).toBe(Math.ceil((1024 * 1024) / link.blockBytes));
  });

  it('expects fewer frames from compressible data', () => {
    const text = new TextEncoder().encode('{"colour":"teal","size":14},'.repeat(40_000));
    const plan = planTransfer(text, link);
    expect(plan.compress).toBe(true);
    expect(plan.frames).toBeLessThan(text.length / link.blockBytes / 5);
  });

  it('samples across a large file, so a compressible start does not mislead it', () => {
    const bytes = noise(4 * 1024 * 1024);
    bytes.fill(0, 0, 64 * 1024);
    const plan = planTransfer(bytes, link);
    expect(plan.frames).toBeGreaterThan((bytes.length / link.blockBytes) * 0.6);
  });

  it('gives the same answer every time, or a resumed transfer would be a new session', () => {
    const bytes = noise(600 * 1024);
    expect(planTransfer(bytes, link)).toEqual(planTransfer(bytes, link));
  });

  it('copes with an empty file', () => {
    expect(planTransfer(new Uint8Array(0), link)).toMatchObject({ frames: 0, compress: false });
  });

  it('estimates close to what the real encoder needs', () => {
    const half = noise(512 * 1024);
    const bytes = new Uint8Array(1024 * 1024);
    bytes.set(half);
    const plan = planTransfer(bytes, link);
    const real = new Encoder(bytes, { maxFrameBytes: link.blockBytes + 13, mime: 'a/b', kind: 'c' }).frameCount;
    expect(plan.frames / real).toBeGreaterThan(0.7);
    expect(plan.frames / real).toBeLessThan(1.3);
  });
});

describe('SittingClock', () => {
  it('uses the usual rate until it has something to go on', () => {
    const clock = new SittingClock();
    clock.start(0, 100);
    expect(clock.captureRate(1000, 90, 10)).toBe(CAPTURE.likely);
    expect(clock.captureRate(60_000, 100, 10)).toBe(CAPTURE.likely);
  });

  it('measures the rate during the first pass', () => {
    const clock = new SittingClock();
    clock.start(0, 100);
    expect(clock.captureRate(5000, 75, 10)).toBeCloseTo(0.5);
  });

  it('measures the rate over later passes', () => {
    const clock = new SittingClock();
    clock.start(0, 100);
    expect(clock.captureRate(20_000, 25, 10)).toBeCloseTo(0.5);
  });

  it('stays within sensible bounds', () => {
    const clock = new SittingClock();
    clock.start(0, 100);
    expect(clock.captureRate(4000, 1, 100)).toBe(0.97);
    expect(clock.captureRate(100_000, 99, 10)).toBe(0.3);
  });

  it.each([0.25, 0.5, 0.75])('predicts the time left in a simulated run, %s of the way through', (share) => {
    const frames = 800;
    const errors: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { seconds, missingAt } = simulate(frames, CAPTURE.likely, seed);
      const clock = new SittingClock();
      clock.start(0, frames);
      const at = seconds * share;
      const missing = missingAt[Math.floor(at * link.fps)]!;
      const predicted = clock.secondsLeft(at * 1000, missing, frames, link);
      errors.push(predicted / (seconds - at));
    }
    errors.sort((a, b) => a - b);
    const median = errors[10]!;
    expect(median).toBeGreaterThan(0.6);
    expect(median).toBeLessThan(1.6);
  });

  it('has nothing left when nothing is missing', () => {
    const clock = new SittingClock();
    clock.start(0, 10);
    expect(clock.secondsLeft(5000, 0, 10, link)).toBe(0);
  });
});

describe('formatting', () => {
  it.each([
    [3, '5 sec'],
    [42, '45 sec'],
    [61, '2 min'],
    [3540, '59 min'],
    [3600, '1 hr'],
    [4300, '1 hr 20 min'],
  ])('shows %i seconds as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });

  it('gives a range, or one figure if both ends round the same', () => {
    expect(formatRange({ low: 240, high: 340 })).toBe('4 min to 6 min');
    expect(formatRange({ low: 200, high: 230 })).toBe('about 4 min');
    expect(formatRange({ low: 1, high: 2 })).toBe('a few seconds');
  });

  it('warns about arms in proportion', () => {
    expect(effortOf({ low: 1, high: 10 })).toBe('quick');
    expect(effortOf({ low: 1, high: 60 })).toBe('steady');
    expect(effortOf(estimateFrames(798, link))).toBe('sore-arm');
    expect(effortOf(estimateFrames(8000, link))).toBe('marathon');
  });
});
