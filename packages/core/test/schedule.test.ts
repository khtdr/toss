import { describe, expect, it } from 'vitest';
import { HEADER_SLOT, buildCycle } from '../src/schedule.js';

const SIZES = [1, 2, 3, 4, 5, 7, 8, 9, 10, 16, 17, 31, 32, 33, 100, 128, 512, 1000];

const isPrime = (x: number) => {
  for (let d = 2; d * d <= x; d++) if (x % d === 0) return false;
  return x > 1;
};

describe('buildCycle', () => {
  it('emits only headers for an empty transfer', () => {
    expect(Array.from(buildCycle(0))).toEqual([HEADER_SLOT]);
  });

  it.each(SIZES)('n=%i has a prime length of at least 11', (n) => {
    const { length } = buildCycle(n);
    expect(isPrime(length)).toBe(true);
    expect(length).toBeGreaterThanOrEqual(11);
  });

  it.each(SIZES)('n=%i starts with a header and holds every block', (n) => {
    const cycle = Array.from(buildCycle(n));
    expect(cycle[0]).toBe(HEADER_SLOT);
    const blocks = new Set(cycle.filter((s) => s !== HEADER_SLOT));
    expect(blocks.size).toBe(n);
  });

  it.each(SIZES.filter((n) => n >= 8))('n=%i shows each block once, in order', (n) => {
    const blocks = Array.from(buildCycle(n)).filter((s) => s !== HEADER_SLOT);
    expect(blocks).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it('matches the documented small-transfer pattern', () => {
    expect(Array.from(buildCycle(2))).toEqual([-1, 0, 1, -1, 0, 1, -1, 0, 1, -1, 0]);
  });

  it.each(SIZES.filter((n) => n >= 8))('n=%i spaces headers evenly', (n) => {
    const cycle = Array.from(buildCycle(n));
    const slots = cycle.flatMap((s, i) => (s === HEADER_SLOT ? [i] : []));
    const gaps = slots.map((slot, i) => (slots[i + 1] ?? slots[0]! + cycle.length) - slot);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(18);
  });

  it.each(SIZES)('n=%i reaches every slot under any capture period up to 10', (n) => {
    const { length } = buildCycle(n);
    for (let k = 2; k <= 10; k++) {
      const seen = new Set<number>();
      for (let i = 0; i < length; i++) seen.add((i * k) % length);
      expect(seen.size).toBe(length);
    }
  });
});
