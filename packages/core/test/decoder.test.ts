import { deflateSync, inflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { Decoder } from '../src/decoder.js';
import { Encoder } from '../src/encoder.js';
import { encodeData, encodeHeader, hashPayload } from '../src/frame.js';
import type { HeaderFields } from '../src/frame.js';
import { ascii, noise, reseal, run } from './helpers.js';

const options = { maxFrameBytes: 100, mime: 'text/plain', kind: 'demo', compress: false };
const SESSION_OFFSET = 1;

declare const performance: { now(): number };

function sessionOf(header: Uint8Array): number {
  return new DataView(header.buffer, header.byteOffset).getUint32(SESSION_OFFSET);
}

/** Builds a hand-made transfer, for senders the Encoder would refuse to be. */
function forge(body: Uint8Array, overrides: Partial<HeaderFields>, frameCount = 1) {
  const header = encodeHeader({
    compression: 0,
    redundancy: 0,
    frameCount,
    bodySize: body.length,
    payloadSize: body.length,
    payloadHash: hashPayload(body),
    mime: 'text/plain',
    kind: 'demo',
    ...overrides,
  });
  const size = Math.ceil(body.length / frameCount);
  const frames = Array.from({ length: frameCount }, (_, i) =>
    encodeData(sessionOf(header), i, body.subarray(i * size, (i + 1) * size)),
  );
  return { header, frames };
}

function headerAndBlocks(encoder: Encoder) {
  const frames = Array.from({ length: encoder.cycleLength }, (_, t) => encoder.frameAt(t));
  const header = frames.find((f) => f[0] === 0x10)!;
  const seen = new Map<string, Uint8Array>();
  for (const f of frames) if (f[0] === 0x11) seen.set(f.subarray(5, 9).join(), f);
  return { header, blocks: [...seen.values()] };
}

describe('Decoder states', () => {
  it('starts out searching with unknown progress', () => {
    const decoder = new Decoder();
    const result = decoder.push(new Uint8Array(20));
    expect(result).toMatchObject({
      state: 'searching',
      outcome: 'rejected',
      reason: 'bad-crc',
      progress: { received: 0, total: null },
      done: false,
    });
  });

  it('reports metadata as soon as it locks', () => {
    const { header } = headerAndBlocks(new Encoder(noise(300), options));
    const result = new Decoder().push(header);
    expect(result).toMatchObject({
      state: 'locked',
      outcome: 'header',
      meta: { mime: 'text/plain', kind: 'demo', payloadSize: 300 },
    });
    expect(result.progress.total).toBeGreaterThan(1);
  });

  it('completes and returns the payload', () => {
    const payload = noise(300);
    const { result } = run(new Encoder(payload, options));
    expect(result.done).toBe(true);
    expect(result.state).toBe('done');
    expect(result.payload).toEqual(payload);
    expect(result.progress.received).toBe(result.progress.total);
  });

  it('completes an empty payload from the header alone', () => {
    const { result, slots } = run(new Encoder(new Uint8Array(), options));
    expect(slots).toBe(1);
    expect(result.done).toBe(true);
    expect(result.payload).toEqual(new Uint8Array());
    expect(result.progress).toEqual({ received: 0, total: 0 });
  });

  it('counts each block once', () => {
    const { header, blocks } = headerAndBlocks(new Encoder(noise(300), options));
    const decoder = new Decoder();
    decoder.push(header);
    expect(decoder.push(blocks[0]!).outcome).toBe('block');
    const again = decoder.push(blocks[0]!);
    expect(again.outcome).toBe('duplicate');
    expect(again.progress.received).toBe(1);
    expect(decoder.push(header).outcome).toBe('duplicate');
  });

  it('returns the same result after finishing', () => {
    const encoder = new Encoder(noise(300), options);
    const decoder = new Decoder();
    const { result } = run(encoder, { decoder });
    expect(decoder.push(encoder.frameAt(1))).toBe(result);
    expect(decoder.push(new Uint8Array(3))).toBe(result);
  });

  it('keeps no reference to the pushed buffer', () => {
    const payload = noise(300);
    const encoder = new Encoder(payload, options);
    const { header, blocks } = headerAndBlocks(encoder);
    const decoder = new Decoder();
    for (const block of blocks) {
      decoder.push(block);
      block.fill(0);
    }
    expect(decoder.push(header).payload).toEqual(payload);
  });

  it('keeps no reference to a buffer pushed after locking', () => {
    const payload = noise(300);
    const { header, blocks } = headerAndBlocks(new Encoder(payload, options));
    const decoder = new Decoder();
    decoder.push(header);
    let last;
    for (const block of blocks) {
      last = decoder.push(block);
      block.fill(0);
    }
    expect(last?.payload).toEqual(payload);
  });

  it('starts over after reset', () => {
    const decoder = new Decoder();
    const first = new Encoder(noise(300, 1), options);
    run(first, { decoder });
    decoder.reset();
    expect(decoder.state).toBe('searching');
    const payload = noise(300, 2);
    expect(run(new Encoder(payload, options), { decoder }).result.payload).toEqual(payload);
  });
});

describe('joining before the header', () => {
  it('uses blocks that arrived first', () => {
    const payload = noise(300);
    const { header, blocks } = headerAndBlocks(new Encoder(payload, options));
    const decoder = new Decoder();
    for (const block of blocks) {
      expect(decoder.push(block)).toMatchObject({ outcome: 'pending', state: 'searching' });
    }
    expect(decoder.push(header).payload).toEqual(payload);
  });

  it('counts held blocks in progress', () => {
    const { blocks } = headerAndBlocks(new Encoder(noise(300), options));
    const decoder = new Decoder();
    decoder.push(blocks[0]!);
    expect(decoder.push(blocks[1]!).progress).toEqual({ received: 2, total: null });
    expect(decoder.push(blocks[1]!).outcome).toBe('duplicate');
  });

  it('drops held blocks that do not fit the header', () => {
    const body = noise(100);
    const { header, frames } = forge(body, {}, 2);
    const decoder = new Decoder();
    const session = sessionOf(header);
    decoder.push(encodeData(session, 1, noise(7)));
    decoder.push(encodeData(session, 9, noise(50)));
    expect(decoder.push(header).progress).toEqual({ received: 0, total: 2 });
    decoder.push(frames[0]!);
    expect(decoder.push(frames[1]!).payload).toEqual(body);
  });

  it('drops blocks held for other sessions on lock', () => {
    const a = headerAndBlocks(new Encoder(noise(300, 1), options));
    const b = headerAndBlocks(new Encoder(noise(300, 2), options));
    const decoder = new Decoder();
    decoder.push(a.blocks[0]!);
    expect(decoder.push(b.header).progress.received).toBe(0);
  });

  it('caps pending frames, and recovers when the header arrives', () => {
    const payload = noise(300);
    const encoder = new Encoder(payload, options);
    const { blocks } = headerAndBlocks(encoder);
    const decoder = new Decoder({ maxPendingFrames: 2 });
    decoder.push(blocks[0]!);
    decoder.push(blocks[1]!);
    expect(decoder.push(blocks[2]!)).toMatchObject({ outcome: 'ignored', reason: 'pending-full' });
    expect(run(encoder, { decoder }).result.payload).toEqual(payload);
  });

  it('caps pending bytes', () => {
    const { blocks } = headerAndBlocks(new Encoder(noise(300), options));
    const decoder = new Decoder({ maxPendingBytes: blocks[0]!.length });
    decoder.push(blocks[0]!);
    expect(decoder.push(blocks[1]!).reason).toBe('pending-full');
  });

  it('refuses indices beyond the frame cap while pending', () => {
    const decoder = new Decoder({ maxFrameCount: 4 });
    expect(decoder.push(encodeData(1, 4, noise(5))).reason).toBe('bad-index');
  });
});

describe('sessions', () => {
  it('stays with the first header and counts the other sender', () => {
    const a = headerAndBlocks(new Encoder(noise(300, 1), options));
    const b = headerAndBlocks(new Encoder(noise(300, 2), options));
    const decoder = new Decoder();
    decoder.push(a.header);
    expect(decoder.push(b.header)).toMatchObject({ outcome: 'ignored', reason: 'other-session' });
    const result = decoder.push(b.blocks[0]!);
    expect(result).toMatchObject({ reason: 'other-session', otherSessionFrames: 2 });
    expect(result.progress.received).toBe(0);
  });

  it('keeps progress when a sender restarts with the same data', () => {
    const payload = noise(300);
    const before = new Encoder(payload, options);
    const after = new Encoder(payload, options);
    const decoder = new Decoder();
    decoder.push(before.frameAt(0));
    decoder.push(before.frameAt(1));
    expect(decoder.push(after.frameAt(1)).outcome).toBe('duplicate');
  });
});

describe('untrusted input', () => {
  it('rejects data frames that break the header', () => {
    const { header } = forge(noise(100), {}, 2);
    const session = sessionOf(header);
    const decoder = new Decoder();
    decoder.push(header);
    expect(decoder.push(encodeData(session, 2, noise(50))).reason).toBe('bad-index');
    expect(decoder.push(encodeData(session, 0, noise(49))).reason).toBe('bad-block-length');
    expect(decoder.push(encodeData(session, 0, noise(51))).reason).toBe('bad-block-length');
  });

  it('checks the shorter last block exactly', () => {
    const body = noise(99);
    const { header, frames } = forge(body, {}, 2);
    const session = sessionOf(header);
    const decoder = new Decoder();
    decoder.push(header);
    expect(decoder.push(encodeData(session, 1, noise(50))).reason).toBe('bad-block-length');
    expect(frames[1]!.length).toBe(13 + 49);
    expect(decoder.push(frames[1]!).outcome).toBe('block');
  });

  it('enforces the payload cap before storing anything', () => {
    const { header } = headerAndBlocks(new Encoder(noise(300), options));
    const result = new Decoder({ maxPayloadBytes: 299 }).push(header);
    expect(result).toMatchObject({
      state: 'searching',
      outcome: 'rejected',
      reason: 'payload-too-large',
    });
  });

  it('applies the payload cap to the declared size of a compressed transfer', () => {
    const { header } = forge(noise(100), { compression: 1, payloadSize: 1_000_000 });
    expect(new Decoder({ maxPayloadBytes: 999_999 }).push(header).reason).toBe('payload-too-large');
  });

  it('survives a header claiming the largest sizes the format allows', () => {
    const { header } = forge(noise(100), {
      bodySize: 0xffffffff,
      payloadSize: 0xffffffff,
      frameCount: 0xffffffff,
    });
    expect(new Decoder().push(header).reason).toBe('payload-too-large');
  });

  it('enforces the frame count cap', () => {
    const { header } = headerAndBlocks(new Encoder(noise(300), options));
    expect(new Decoder({ maxFrameCount: 2 }).push(header).reason).toBe('too-many-frames');
  });

  it('enforces maxFrameBytes when set', () => {
    const { header } = headerAndBlocks(new Encoder(noise(300), options));
    expect(new Decoder({ maxFrameBytes: 20 }).push(header).reason).toBe('too-long');
  });

  it('refuses compression and redundancy it does not know', () => {
    const body = noise(100);
    const compression = forge(body, { compression: 2, payloadSize: 200 }).header;
    const redundancy = forge(body, { redundancy: 1 }).header;
    expect(new Decoder().push(compression).reason).toBe('unsupported-compression');
    expect(new Decoder().push(redundancy).reason).toBe('unsupported-redundancy');
  });

  it('ignores reserved frame types', () => {
    const frame = encodeData(1, 0, noise(5));
    frame[0] = 0x1f;
    expect(new Decoder().push(reseal(frame))).toMatchObject({
      outcome: 'ignored',
      reason: 'unknown-type',
    });
  });

  it('fails when the hash does not match, and stays failed', () => {
    const body = noise(100);
    const { header, frames } = forge(body, { payloadHash: new Uint8Array(16) });
    const decoder = new Decoder();
    decoder.push(header);
    const result = decoder.push(frames[0]!);
    expect(result).toMatchObject({ state: 'failed', error: 'hash-mismatch', done: false });
    expect(result.payload).toBeUndefined();
    expect(decoder.push(header)).toBe(result);
  });

  it('keeps the first copy of a conflicting block, so the hash catches it', () => {
    const body = noise(100);
    const { header, frames } = forge(body, {}, 2);
    const decoder = new Decoder();
    decoder.push(header);
    decoder.push(encodeData(sessionOf(header), 0, noise(50, 9)));
    expect(decoder.push(frames[0]!).outcome).toBe('duplicate');
    expect(decoder.push(frames[1]!).error).toBe('hash-mismatch');
  });
});

describe('compression', () => {
  const text = ascii('{"color":"red"},'.repeat(500));

  it('round-trips a compressed payload', () => {
    const { result } = run(new Encoder(text, { ...options, compress: true }));
    expect(result.payload).toEqual(text);
    expect(result.meta?.payloadSize).toBe(text.length);
  });

  it('fails on a body that will not inflate', () => {
    const body = new Uint8Array(50).fill(0xff);
    const { header, frames } = forge(body, {
      compression: 1,
      payloadSize: 500,
      payloadHash: hashPayload(text),
    });
    const decoder = new Decoder();
    decoder.push(header);
    expect(decoder.push(frames[0]!).error).toBe('decompress-failed');
  });

  it('stops a decompression bomb at the declared size', () => {
    const bomb = deflateSync(new Uint8Array(50_000_000));
    const payloadSize = bomb.length + 1000;
    const { header, frames } = forge(bomb, { compression: 1, payloadSize });
    const decoder = new Decoder({ maxPayloadBytes: payloadSize });
    decoder.push(header);
    expect(decoder.push(frames[0]!)).toMatchObject({ state: 'failed', error: 'size-mismatch' });
  });

  it('stops the work of a bomb, not just its output', () => {
    const bomb = deflateSync(new Uint8Array(100_000_000));
    const { header, frames } = forge(bomb, { compression: 1, payloadSize: bomb.length + 1000 });

    const fullStart = performance.now();
    inflateSync(bomb);
    const full = performance.now() - fullStart;

    const decoder = new Decoder();
    decoder.push(header);
    const start = performance.now();
    expect(decoder.push(frames[0]!).error).toBe('size-mismatch');
    expect(performance.now() - start).toBeLessThan(full / 5);
  });

  it('rejects a stream with bytes past the declared size, even if the hash matches', () => {
    const payload = text.subarray(0, 1000);
    const stream = deflateSync(text);
    expect(stream.length).toBeLessThan(payload.length);
    const { header, frames } = forge(stream, {
      compression: 1,
      payloadSize: payload.length,
      payloadHash: hashPayload(payload),
    });
    const decoder = new Decoder();
    decoder.push(header);
    expect(decoder.push(frames[0]!).error).toBe('size-mismatch');
  });

  it('rejects a stream shorter than the declared size', () => {
    const stream = deflateSync(text);
    const { header, frames } = forge(stream, { compression: 1, payloadSize: text.length + 1 });
    const decoder = new Decoder();
    decoder.push(header);
    expect(decoder.push(frames[0]!).error).toBe('size-mismatch');
  });
});
