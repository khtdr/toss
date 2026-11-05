import pngjs from 'pngjs';
import { describe, expect, it } from 'vitest';
import { maxFrameBytes, smallestVersion, textToMatrix } from 'toss-qr';
import type { ErrorCorrection } from 'toss-qr';
import { frameToPng, matrixToPng, scanPng } from '../src/qr-png.js';
import { idat, ihdr, noise, rawPng } from './helpers.js';

const { PNG } = pngjs;
const options = { version: 22, errorCorrection: 'M', scale: 4 } as const;

function blank(size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data.fill(0xff);
  return PNG.sync.write(png);
}

function roundTrip(frame: Uint8Array, render = options as Parameters<typeof frameToPng>[1]) {
  const scan = scanPng(frameToPng(frame, render));
  expect(scan.status).toBe('frame');
  return scan.status === 'frame' ? scan.frame : undefined;
}

describe('frame <-> PNG', () => {
  it('carries every byte value', () => {
    const frame = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(roundTrip(frame)).toEqual(frame);
  });

  it.each([1, 2, 17, 106, 107, 700])('preserves the exact length of %i bytes', (length) => {
    const frame = noise(length, length);
    expect(roundTrip(frame)).toEqual(frame);
  });

  it('keeps trailing zeros, which a padded carrier could lose', () => {
    const frame = new Uint8Array(64);
    frame[0] = 0x11;
    expect(roundTrip(frame)).toEqual(frame);
  });

  it.each(['L', 'M', 'Q', 'H'] as ErrorCorrection[])('fills a version 40 symbol at EC %s', (level) => {
    const render = { version: 40, errorCorrection: level, scale: 3 };
    const frame = noise(maxFrameBytes(render));
    expect(roundTrip(frame, render)).toEqual(frame);
  });

  it('refuses a frame beyond the capacity of its symbol', () => {
    expect(() => frameToPng(noise(maxFrameBytes(options) + 1), options)).toThrow(RangeError);
  });

  it('draws short and long frames at the same size', () => {
    const width = (frame: Uint8Array) => PNG.sync.read(frameToPng(frame, options)).width;
    expect(width(noise(14))).toBe(width(noise(maxFrameBytes(options))));
  });

  it.each([1, 2, 8])('scans at %i pixels per module', (scale) => {
    const frame = noise(120);
    expect(roundTrip(frame, { ...options, scale })).toEqual(frame);
  });

  it('leaves a quiet zone of four modules on every side', () => {
    const scale = 3;
    const png = PNG.sync.read(frameToPng(noise(40), { ...options, scale }));
    const margin = 4 * scale;
    let darkInMargin = 0;
    let dark = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        if (png.data[(y * png.width + x) * 4] !== 0) continue;
        dark++;
        const edge = Math.min(x, y, png.width - 1 - x, png.height - 1 - y);
        if (edge < margin) darkInMargin++;
      }
    }
    expect(dark).toBeGreaterThan(0);
    expect(darkInMargin).toBe(0);
  });

  it('survives damage within the error correction budget', () => {
    const frame = noise(300);
    const png = PNG.sync.read(
      frameToPng(frame, { version: smallestVersion(300, 'H'), errorCorrection: 'H', scale: 4 }),
    );
    // Scribble on a band through the middle, clear of the finder patterns.
    const top = Math.floor(png.height / 2);
    for (let y = top; y < top + 8; y++) {
      for (let x = 60; x < 120; x++) png.data.fill(0, (y * png.width + x) * 4, (y * png.width + x) * 4 + 3);
    }
    const scan = scanPng(PNG.sync.write(png));
    expect(scan).toEqual({ status: 'frame', frame });
  });
});

describe('untrusted PNGs', () => {
  it('reports an image with no QR code', () => {
    expect(scanPng(blank(64))).toEqual({ status: 'no-qr' });
  });

  it('reports a QR code from something else', () => {
    const matrix = textToMatrix('HTTP://EXAMPLE.COM', { version: 2, errorCorrection: 'M' });
    expect(scanPng(matrixToPng(matrix, 4))).toEqual({ status: 'unreadable', reason: 'not-toss' });
  });

  it.each([
    ['empty', new Uint8Array()],
    ['not a PNG', new TextEncoder().encode('definitely not a PNG file')],
    ['signature only', rawPng().subarray(0, 8)],
    ['no IHDR', rawPng()],
  ])('rejects %s', (_, bytes) => {
    expect(scanPng(bytes).status).toBe('unreadable');
  });

  it('rejects every truncation of a real PNG without throwing', () => {
    const png = frameToPng(noise(40), options);
    for (let length = 0; length < png.length; length += 37) {
      expect(['unreadable', 'no-qr']).toContain(scanPng(png.subarray(0, length)).status);
    }
  });

  it('rejects huge dimensions before decoding', () => {
    expect(scanPng(rawPng(ihdr(30000, 30000), idat(new Uint8Array(5))))).toEqual({
      status: 'unreadable',
      reason: 'image is too large',
    });
  });

  it('rejects dimensions whose product overflows 32 bits', () => {
    const scan = scanPng(rawPng(ihdr(0x10000, 0x10000), idat(new Uint8Array(5))));
    expect(scan).toEqual({ status: 'unreadable', reason: 'image is too large' });
  });

  it('rejects a second IHDR that would resize the image after the first passes', () => {
    const scan = scanPng(rawPng(ihdr(1, 1), ihdr(30000, 30000), idat(new Uint8Array(5))));
    expect(scan).toEqual({ status: 'unreadable', reason: 'more than one IHDR chunk' });
  });

  it('finds a hostile IHDR after IEND', () => {
    const tail = rawPng(ihdr(30000, 30000)).subarray(8);
    const scan = scanPng(Buffer.concat([rawPng(ihdr(1, 1), idat(new Uint8Array(5))), tail]));
    expect(scan).toEqual({ status: 'unreadable', reason: 'more than one IHDR chunk' });
  });

  it('finds a hostile IHDR behind other chunks', () => {
    const scan = scanPng(rawPng(ihdr(1, 1), idat(new Uint8Array(5)), ihdr(30000, 30000)));
    expect(scan).toEqual({ status: 'unreadable', reason: 'more than one IHDR chunk' });
  });

  it('does not inflate past the declared size', () => {
    const scan = scanPng(rawPng(ihdr(1, 1), idat(new Uint8Array(1 << 26))));
    expect(scan.status).not.toBe('frame');
  });

  it('reads a view into a larger buffer', () => {
    const frame = noise(50);
    const png = frameToPng(frame, options);
    const padded = new Uint8Array(png.length + 16);
    padded.set(png, 7);
    expect(scanPng(padded.subarray(7, 7 + png.length))).toEqual({ status: 'frame', frame });
  });
});
