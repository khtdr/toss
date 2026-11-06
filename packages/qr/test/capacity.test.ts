import vendored from '../src/vendor/qrcode.js';
import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_LENGTH,
  MAX_VERSION,
  MIN_VERSION,
  frameToText,
  isErrorCorrection,
  maxFrameBytes,
  smallestVersion,
  textCapacity,
} from '../src/index.js';
import type { ErrorCorrection, QrConfig } from '../src/index.js';

const qrcode = vendored as unknown as (
  version: number,
  level: string,
) => { addData(text: string, mode: 'Alphanumeric'): void; make(): void };

const LEVELS: ErrorCorrection[] = ['L', 'M', 'Q', 'H'];
const VERSIONS = Array.from({ length: MAX_VERSION }, (_, i) => i + MIN_VERSION);
const CONFIGS: QrConfig[] = LEVELS.flatMap((errorCorrection) =>
  VERSIONS.map((version) => ({ version, errorCorrection })),
);

function fits(chars: number, { version, errorCorrection }: QrConfig): boolean {
  const qr = qrcode(version, errorCorrection);
  qr.addData('A'.repeat(chars), 'Alphanumeric');
  try {
    qr.make();
    return true;
  } catch {
    return false;
  }
}

describe('textCapacity', () => {
  it.each([
    [1, 'L', 25],
    [1, 'H', 10],
    [40, 'L', 4296],
    [40, 'M', 3391],
    [40, 'Q', 2420],
    [40, 'H', 1852],
  ] as const)('gives the published capacity of version %i-%s', (version, errorCorrection, chars) => {
    expect(textCapacity({ version, errorCorrection })).toBe(chars);
  });

  it.each(LEVELS)('matches what the QR library can fit at level %s', (errorCorrection) => {
    for (const version of VERSIONS) {
      const config = { version, errorCorrection };
      const capacity = textCapacity(config);
      expect(fits(capacity, config), `v${version} at capacity`).toBe(true);
      expect(fits(capacity + 1, config), `v${version} past capacity`).toBe(false);
    }
  }, 30_000);

  it('grows with version and shrinks with error correction', () => {
    for (const errorCorrection of LEVELS) {
      for (const version of VERSIONS.slice(1)) {
        expect(textCapacity({ version, errorCorrection })).toBeGreaterThan(
          textCapacity({ version: version - 1, errorCorrection }),
        );
      }
    }
    for (const version of VERSIONS) {
      const [l, m, q, h] = LEVELS.map((errorCorrection) =>
        textCapacity({ version, errorCorrection }),
      );
      expect(l).toBeGreaterThan(m!);
      expect(m).toBeGreaterThan(q!);
      expect(q).toBeGreaterThan(h!);
    }
  });

  it('never exceeds MAX_TEXT_LENGTH, and reaches it', () => {
    const largest = Math.max(...CONFIGS.map(textCapacity));
    expect(largest).toBe(MAX_TEXT_LENGTH);
  });

  it.each([0, 41, -1, 1.5, Number.NaN])('rejects version %s', (version) => {
    expect(() => textCapacity({ version, errorCorrection: 'M' })).toThrow(RangeError);
  });

  it.each(['X', 'l', '', 'toString'])('rejects level %j', (level) => {
    const config = { version: 1, errorCorrection: level as ErrorCorrection };
    expect(() => textCapacity(config)).toThrow(RangeError);
    expect(isErrorCorrection(level)).toBe(false);
  });
});

describe('maxFrameBytes', () => {
  it.each([
    [40, 'L', 2863], // 4295 characters: 1431 groups and a 2-character tail
    [40, 'M', 2260], // 3390 characters: 1130 whole groups
    [40, 'Q', 1612], // 2419 characters: 806 groups and a wasted character
    [40, 'H', 1234],
  ] as const)('handles each remainder at version %i-%s', (version, errorCorrection, bytes) => {
    expect(maxFrameBytes({ version, errorCorrection })).toBe(bytes);
  });

  it('is the exact limit for every symbol, once the frame is text', () => {
    for (const config of CONFIGS) {
      const bytes = maxFrameBytes(config);
      const capacity = textCapacity(config);
      expect(frameToText(new Uint8Array(bytes)).length).toBeLessThanOrEqual(capacity);
      expect(frameToText(new Uint8Array(bytes + 1)).length).toBeGreaterThan(capacity);
    }
  });
});

describe('smallestVersion', () => {
  it('picks the first symbol that holds the frame', () => {
    for (const { version, errorCorrection } of CONFIGS) {
      const bytes = maxFrameBytes({ version, errorCorrection });
      expect(smallestVersion(bytes, errorCorrection)).toBeLessThanOrEqual(version);
      if (version > MIN_VERSION) {
        const below = maxFrameBytes({ version: version - 1, errorCorrection });
        expect(smallestVersion(below + 1, errorCorrection)).toBe(version);
      }
    }
  });

  it('gives version 1 to the smallest frames', () => {
    expect(smallestVersion(1, 'H')).toBe(1);
  });

  it('gives 700-byte frames version 22 at level M', () => {
    expect(smallestVersion(700, 'M')).toBe(22);
  });

  it('throws when no symbol is big enough', () => {
    expect(() => smallestVersion(1235, 'H')).toThrow(RangeError);
    expect(() => smallestVersion(Number.NaN, 'H')).toThrow(RangeError);
  });
});
