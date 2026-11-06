import { Encoder } from 'toss-core';
import { frameToText, maxFrameBytes } from 'toss-qr';
import { describe, expect, it } from 'vitest';
import { parseKind, runKind, sendOptions, testPayload, verifyPayload } from '../src/run';
import type { RunConfig } from '../src/run';
import { ScanLog } from '../src/scan-log';

const config: RunConfig = {
  version: 10,
  errorCorrection: 'M',
  fps: 10,
  payloadBytes: 4000,
  payloadType: 'noise',
};

function encoderFor(run: RunConfig): Encoder {
  const { mime, kind } = sendOptions(run);
  return new Encoder(testPayload(run.payloadBytes, run.payloadType), { maxFrameBytes: maxFrameBytes(run), mime, kind });
}

/** Scans a looping sender every `period` slots, 100 ms per slot. */
function capture(period: number, drop: (t: number) => boolean = () => false, limit = 5000) {
  const encoder = encoderFor(config);
  const log = new ScanLog();
  for (let t = 3; t < limit && !log.finished; t += period) {
    if (drop(t)) continue;
    const text = frameToText(encoder.frameAt(t));
    log.push(text, text, t * 100);
  }
  return log;
}

describe('run labels', () => {
  it('round-trips a config through the kind', () => {
    const { payloadBytes: _, ...rest } = config;
    expect(parseKind(runKind(config))).toEqual(rest);
  });

  it('ignores a kind from something else', () => {
    expect(parseKind('theme')).toBeUndefined();
  });

  it('is deterministic and incompressible enough', () => {
    expect(testPayload(64, 'noise')).toEqual(testPayload(64, 'noise'));
    expect(new Set(testPayload(4096, 'noise')).size).toBeGreaterThan(200);
  });
});

describe('JSON payloads', () => {
  const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

  it('are valid JSON of exactly the size asked for', () => {
    for (const length of [2, 300, 5000, 5001]) {
      const payload = testPayload(length, 'json');
      expect(payload).toHaveLength(length);
      expect(Array.isArray(JSON.parse(text(payload)))).toBe(true);
    }
  });

  it('compress, so a run needs far fewer frames than noise', () => {
    const json = { ...config, payloadBytes: 20_000, payloadType: 'json' as const };
    const noise = { ...json, payloadType: 'noise' as const };
    expect(encoderFor(json).frameCount).toBeLessThan(encoderFor(noise).frameCount / 2);
  });

  it('verify against their own type only', () => {
    const kind = runKind({ ...config, payloadType: 'json' });
    expect(verifyPayload(kind, testPayload(500, 'json'))).toBe(true);
    expect(verifyPayload(kind, testPayload(500, 'noise'))).toBe(false);
  });
});

describe('ScanLog', () => {
  it('finishes a clean run and verifies the payload', () => {
    const summary = capture(1).summary();
    expect(summary).toMatchObject({
      run: runKind(config),
      status: 'done',
      verified: true,
      repeatedBlocks: 0,
      displayValueDiffers: 0,
    });
    expect(summary.captured).toBeCloseTo(1, 1);
    expect(summary.scansPerSecond).toBeCloseTo(10, 0);
    expect(summary.steps[0]).toEqual([1, expect.any(Number)]);
    expect(summary.msTo.all).toBe(summary.elapsedMs);
  });

  it('shows phase lock as one dominant step, and the capture share', () => {
    const summary = capture(3).summary();
    expect(summary.status).toBe('done');
    expect(summary.captured).toBeCloseTo(1 / 3, 1);
    const [top, next] = summary.steps;
    expect(top![0]).toBe(3);
    expect(top![1]).toBeGreaterThan((next?.[1] ?? 0) * 3);
  });

  it('shows a slow tail when one block keeps being missed', () => {
    const encoder = encoderFor(config);
    const cycles = encoder.cycleLength * 3;
    const isBlockFive = (t: number) => {
      const frame = encoder.frameAt(t);
      return frame[0] === 0x11 && frame[8] === 5;
    };
    const summary = capture(1, (t) => t < cycles && isBlockFive(t)).summary();
    expect(summary.status).toBe('done');
    expect(summary.repeatedBlocks).toBeGreaterThan(0);
    expect(summary.msTo.ninety!).toBeLessThan(encoder.cycleLength * 100);
    expect(summary.msTo.all!).toBeGreaterThan(cycles * 100 - 1000);
    expect(summary.longestStallMs).toBeGreaterThan(cycles * 100 - 2 * encoder.cycleLength * 100);
  });

  it('keeps timing from before the first header', () => {
    // Slot 0 and the mid-cycle slot are headers. Skip them for two cycles.
    const encoder = encoderFor(config);
    const summary = capture(1, (t) => t < encoder.cycleLength * 2 && encoder.frameAt(t)[0] === 0x10).summary();
    expect(summary.status).toBe('done');
    expect(summary.msTo.half!).toBeLessThan(summary.msTo.header!);
    expect(summary.msTo.first).toBe(0);
  });

  it('counts a scanner repeating one symbol as scans, not changes', () => {
    const log = new ScanLog();
    const text = frameToText(encoderFor(config).frameAt(1));
    for (let i = 0; i < 5; i++) log.push(text, text, i * 10);
    expect(log.summary()).toMatchObject({ scans: 5, changes: 1, repeatedBlocks: 0 });
  });

  it('reports other QR codes and bad frames', () => {
    const log = new ScanLog();
    log.push('https://example.com', 'https://example.com', 0);
    log.push('T', 'T', 1);
    expect(log.summary().rejected).toEqual({ 'not-toss': 1, 'too-short': 1 });
  });

  it('counts text the scanner reformatted', () => {
    const log = new ScanLog();
    const text = frameToText(encoderFor(config).frameAt(1));
    log.push(text, text.trim() + ' ', 0);
    expect(log.summary().displayValueDiffers).toBe(1);
  });

  it('reports an incomplete run without a rate', () => {
    const summary = capture(1, () => false, 8).summary();
    expect(summary).toMatchObject({ status: 'incomplete', payloadBytesPerSecond: null, verified: null });
    expect(summary.msTo.all).toBeNull();
  });
});
