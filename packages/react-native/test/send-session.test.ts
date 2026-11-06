import { Decoder } from 'toss-core';
import { maxFrameBytes, textToFrame } from 'toss-qr';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEND_SETTINGS, SendSession } from '../src/send-session.js';
import type { SendSessionOptions } from '../src/send-session.js';
import { noise, scan } from './helpers.js';

const options: SendSessionOptions = {
  version: 10,
  errorCorrection: 'M',
  fps: 10,
  mask: 0,
  mime: 'application/octet-stream',
  kind: 'test',
};

describe('SendSession', () => {
  it('defaults to the best setting measured', () => {
    expect(DEFAULT_SEND_SETTINGS).toEqual({ version: 30, errorCorrection: 'M', fps: 10, mask: 0 });
  });

  it('fills the symbol at the configured version', () => {
    const session = new SendSession(noise(5000), options);
    const blockBytes = maxFrameBytes(options) - 13;
    expect(session.frameCount).toBeGreaterThanOrEqual(Math.floor(5000 / blockBytes));
    expect(session.getSymbol().modules).toBe(57 + 8);
  });

  it('holds a symbol until its slot comes', () => {
    const session = new SendSession(noise(1000), options);
    const first = session.getSymbol();
    expect(session.advance(1000)).toBe(false);
    expect(session.advance(1099)).toBe(false);
    expect(session.getSymbol()).toBe(first);
    expect(session.advance(1100)).toBe(true);
    expect(session.getSymbol()).not.toBe(first);
  });

  it('tells subscribers about each new symbol, until they leave', () => {
    const session = new SendSession(noise(1000), options);
    let calls = 0;
    const leave = session.subscribe(() => calls++);
    session.advance(0);
    session.advance(100);
    expect(calls).toBe(1);
    leave();
    session.advance(200);
    expect(calls).toBe(1);
  });

  it('shows the same symbols whether or not they were prepared early', () => {
    const early = new SendSession(noise(3000), options);
    const late = new SendSession(noise(3000), options);
    early.advance(0);
    late.advance(0);
    for (let step = 1; step < 20; step++) {
      early.prepare();
      early.prepare();
      early.advance(step * 100);
      late.advance(step * 100);
      expect(early.getSymbol().path).toBe(late.getSymbol().path);
    }
  });

  it('delays the sequence when it falls behind, instead of dropping frames', () => {
    const session = new SendSession(noise(3000), options);
    const steady = new SendSession(noise(3000), options);
    session.advance(0);
    steady.advance(0);
    session.advance(100);
    steady.advance(100);

    session.advance(1000);
    steady.advance(200);

    expect(session.getSymbol().path).toBe(steady.getSymbol().path);
    expect(session.stats(1000).skippedSlots).toBe(8);
  });

  it('counts complete loops and the rate shown', () => {
    const session = new SendSession(noise(1000), options);
    session.advance(0);
    for (let step = 1; step <= session.cycleLength * 2; step++) session.advance(step * 100);
    const stats = session.stats(session.cycleLength * 200);
    expect(stats.loops).toBe(2);
    expect(stats.shownFps).toBeCloseTo(10, 0);
    expect(stats.skippedSlots).toBe(0);
  });

  it('holds its symbol while paused, and counts none of that time', () => {
    const session = new SendSession(noise(3000), options);
    session.advance(0);
    session.advance(100);
    session.pause(150);
    const held = session.getSymbol();

    expect(session.advance(60_000)).toBe(false);
    expect(session.getSymbol()).toBe(held);
    session.resume(60_150);

    expect(session.advance(60_199)).toBe(false);
    expect(session.advance(60_200)).toBe(true);
    const stats = session.stats(60_200);
    expect(stats.skippedSlots).toBe(0);
    expect(stats.shownFps).toBeCloseTo(15, 0);
  });

  it('freezes its rate while paused', () => {
    const session = new SendSession(noise(3000), options);
    session.advance(0);
    session.advance(1000);
    session.pause(1000);
    expect(session.stats(50_000).shownFps).toBe(session.stats(1000).shownFps);
  });

  it('still counts falling behind while running', () => {
    const session = new SendSession(noise(3000), options);
    session.advance(0);
    session.pause(100);
    session.resume(5000);
    // 1.1 s of running time is 11 slots, and only the last got a symbol.
    session.advance(6000);
    expect(session.stats(6000).skippedSlots).toBe(10);
  });

  it('can pause before the first tick, and ignores a stray resume', () => {
    const session = new SendSession(noise(3000), options);
    session.resume(10);
    session.pause(20);
    expect(session.advance(30)).toBe(false);
    session.resume(40);
    expect(session.advance(50)).toBe(false);
    expect(session.advance(150)).toBe(true);
  });

  it('reports no rate before the first tick', () => {
    expect(new SendSession(noise(10), options).stats(5000).shownFps).toBe(0);
  });

  it('draws symbols that scan back to the original payload', () => {
    const payload = noise(1500);
    const session = new SendSession(payload, options);
    const decoder = new Decoder();
    let result;
    session.advance(0);
    for (let step = 1; step <= session.cycleLength && !result?.done; step++) {
      const read = textToFrame(scan(session.getSymbol()));
      if (!read.ok) throw new Error(read.reason);
      result = decoder.push(read.frame);
      session.advance(step * 100);
    }
    expect(result?.payload).toEqual(payload);
  });

  it('compresses unless told not to', () => {
    const repetitive = new Uint8Array(20_000).fill(7);
    expect(new SendSession(repetitive, options).frameCount).toBe(1);
    expect(new SendSession(repetitive, { ...options, compress: false }).frameCount).toBeGreaterThan(90);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a frame rate of %s', (fps) => {
    expect(() => new SendSession(noise(10), { ...options, fps })).toThrow(RangeError);
  });

  it('rejects a mime type the protocol cannot carry', () => {
    expect(() => new SendSession(noise(10), { ...options, mime: 'café' })).toThrow(RangeError);
  });
});
