import jsQR from 'jsqr';
import { QUIET_ZONE_MODULES, frameToText, textToFrame, textToMatrix } from 'toss-qr';
import type { QrMatrix } from 'toss-qr';
import { describe, expect, it } from 'vitest';
import { encoderFor } from '../src/prepare';
import { parseKind, runKind } from '../src/run';
import type { RunConfig } from '../src/run';

const config: RunConfig = {
  version: 30,
  errorCorrection: 'M',
  fps: 10,
  payloadBytes: 5000,
  renderer: 'skia',
  mask: 'fixed',
};

function scan({ size, modules }: QrMatrix): string | undefined {
  const scale = 3;
  const side = (size + 2 * QUIET_ZONE_MODULES) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const row = Math.floor(y / scale) - QUIET_ZONE_MODULES;
      const col = Math.floor(x / scale) - QUIET_ZONE_MODULES;
      const dark = row >= 0 && col >= 0 && row < size && col < size && modules[row * size + col];
      if (dark) pixels.fill(0, (y * side + x) * 4, (y * side + x) * 4 + 3);
    }
  }
  return jsQR(pixels, side, side)?.data;
}

describe('fixed mask symbols', () => {
  it('scan back to the same frames', () => {
    const encoder = encoderFor(config);
    for (let t = 0; t < encoder.cycleLength; t++) {
      const frame = encoder.frameAt(t);
      const read = textToFrame(scan(textToMatrix(frameToText(frame), { version: 30, errorCorrection: 'M', mask: 0 })) ?? '');
      expect(read).toEqual({ ok: true, frame });
    }
  });

  it('skip the search but hold the same text', () => {
    const text = frameToText(encoderFor(config).frameAt(0));
    const fixed = textToMatrix(text, { version: 30, errorCorrection: 'M', mask: 0 });
    const best = textToMatrix(text, { version: 30, errorCorrection: 'M' });
    expect(fixed.size).toBe(best.size);
    expect(fixed.modules).not.toEqual(best.modules);
    expect(scan(fixed)).toBe(scan(best));
  });

  it('are marked in the run name', () => {
    expect(runKind(config)).toBe('spike-v30-M-10fps-skia-fixed');
    expect(parseKind(runKind(config))).toMatchObject({ mask: 'fixed', renderer: 'skia' });
    expect(parseKind(runKind({ ...config, mask: 'best' }))).toMatchObject({ mask: 'best' });
  });
});
