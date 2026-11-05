import { Decoder } from '../src/decoder.js';
import type { PushResult } from '../src/decoder.js';
import type { Encoder } from '../src/encoder.js';
import { crc32 } from '../src/crc32.js';

export type Random = () => number;

/** Seeded so every failure is reproducible. */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Incompressible bytes. */
export function noise(size: number, seed = 1): Uint8Array {
  const random = seeded(seed);
  return Uint8Array.from({ length: size }, () => Math.floor(random() * 256));
}

export function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  return Uint8Array.from({ length: clean.length / 2 }, (_, i) =>
    parseInt(clean.slice(i * 2, i * 2 + 2), 16),
  );
}

/** Rewrites a frame's CRC so edits reach the checks behind it. */
export function reseal(frame: Uint8Array): Uint8Array {
  const out = frame.slice();
  const end = out.length - 4;
  new DataView(out.buffer).setUint32(end, crc32(out.subarray(0, end)));
  return out;
}

/** Takes a frame in, passes zero or more frames out. */
export type Channel = (frame: Uint8Array) => Uint8Array[];

export const lossy =
  (rate: number, random: Random): Channel =>
  (frame) =>
    random() < rate ? [] : [frame];

export const duplicating =
  (rate: number, random: Random): Channel =>
  (frame) =>
    random() < rate ? [frame, frame, frame] : [frame];

/** Holds frames in a window and releases them in random order. */
export function reordering(window: number, random: Random): Channel {
  const held: Uint8Array[] = [];
  return (frame) => {
    held.push(frame);
    if (held.length < window) return [];
    const [picked] = held.splice(Math.floor(random() * held.length), 1);
    return [picked!];
  };
}

/** Good and bad spells, like glare or a shaking hand. */
export function bursty(rate: number, meanBurst: number, random: Random): Channel {
  let bad = false;
  const leaveBad = 1 / meanBurst;
  const enterBad = rate / (1 - rate) / meanBurst;
  return (frame) => {
    bad = random() < (bad ? 1 - leaveBad : enterBad);
    return bad ? [] : [frame];
  };
}

/** A camera phase-locked to the display, catching every k-th frame. */
export function everyKth(k: number, offset = 0): Channel {
  let t = offset;
  return (frame) => (t++ % k === 0 ? [frame] : []);
}

export function chain(...channels: Channel[]): Channel {
  return (frame) =>
    channels.reduce<Uint8Array[]>((frames, channel) => frames.flatMap(channel), [frame]);
}

export interface RunOptions {
  channel?: Channel;
  /** Frames the sender shows before the receiver starts: joining mid-loop. */
  joinAt?: number;
  maxSlots?: number;
  decoder?: Decoder;
}

export interface RunResult {
  result: PushResult;
  slots: number;
}

/** Plays a sender through a channel into a decoder until it finishes. */
export function run(encoder: Encoder, options: RunOptions = {}): RunResult {
  const { channel = (f) => [f], joinAt = 0, maxSlots = 200_000, decoder = new Decoder() } = options;
  for (let slot = 0; slot < maxSlots; slot++) {
    for (const frame of channel(encoder.frameAt(joinAt + slot))) {
      const result = decoder.push(frame);
      if (result.state === 'done' || result.state === 'failed') return { result, slots: slot + 1 };
    }
  }
  throw new Error(`transfer did not finish in ${maxSlots} slots`);
}
