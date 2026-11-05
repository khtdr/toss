import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/crc32.js';
import { Encoder } from '../src/encoder.js';
import { DATA_OVERHEAD, HEADER_OVERHEAD, encodeHeader, hashPayload, parseFrame } from '../src/frame.js';
import type { HeaderFields } from '../src/frame.js';
import { ascii, fromHex, noise, reseal } from './helpers.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function fields(overrides: Partial<HeaderFields> = {}): HeaderFields {
  return {
    compression: 0,
    redundancy: 0,
    frameCount: 2,
    bodySize: 100,
    payloadSize: 100,
    payloadHash: new Uint8Array(16),
    mime: 'text/plain',
    kind: 'demo',
    ...overrides,
  };
}

const reasonFor = (frame: Uint8Array) => {
  const parsed = parseFrame(frame);
  return parsed.ok ? 'ok' : parsed.reason;
};

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
  });
  it('is zero for no input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('worked example (docs/protocol.md section 12)', () => {
  const payload = ascii('toss across the air gap. '.repeat(4));
  const encoder = new Encoder(payload, {
    maxFrameBytes: 64,
    mime: 'text/plain',
    kind: 'demo',
    compress: false,
  });
  const text = '746f7373206163726f73732074686520616972206761702e20'.repeat(2);

  it('derives the documented sizes', () => {
    expect(encoder.frameCount).toBe(2);
    expect(encoder.sessionId).toBe(0xdc808247);
    expect(hex(hashPayload(payload))).toBe('e44a178d56cce2e43fcaf9a7ffe990dd');
  });

  it('produces the documented header', () => {
    expect(hex(encoder.frameAt(0))).toBe(
      '10dc808247' +
        '0000' +
        '00000002' +
        '00000064' +
        '00000064' +
        'e44a178d56cce2e43fcaf9a7ffe990dd' +
        '0a746578742f706c61696e' +
        '0464656d6f' +
        '5b4c2c32',
    );
  });

  it('produces the documented data frames', () => {
    expect(hex(encoder.frameAt(1))).toBe(`11dc80824700000000${text}1565dbad`);
    expect(hex(encoder.frameAt(2))).toBe(`11dc80824700000001${text}df5b283e`);
  });

  it('parses the documented bytes', () => {
    const parsed = parseFrame(fromHex(`11dc80824700000001${text}df5b283e`));
    expect(parsed).toMatchObject({ ok: true, frame: { type: 'data', index: 1 } });
  });
});

describe('parseFrame', () => {
  it('round-trips a header', () => {
    const parsed = parseFrame(encodeHeader(fields()));
    expect(parsed).toMatchObject({
      ok: true,
      frame: { type: 'header', frameCount: 2, mime: 'text/plain', kind: 'demo' },
    });
  });

  it('accepts empty mime and kind', () => {
    const frame = encodeHeader(fields({ mime: '', kind: '' }));
    expect(frame.length).toBe(HEADER_OVERHEAD);
    expect(reasonFor(frame)).toBe('ok');
  });

  it('rejects short, long, and corrupt frames', () => {
    expect(reasonFor(new Uint8Array(DATA_OVERHEAD))).toBe('too-short');
    const frame = encodeHeader(fields());
    expect(parseFrame(frame, frame.length - 1)).toEqual({ ok: false, reason: 'too-long' });
    const flipped = frame.slice();
    flipped[10]! ^= 1;
    expect(reasonFor(flipped)).toBe('bad-crc');
  });

  it('detects every single-bit flip in a header', () => {
    const frame = encodeHeader(fields());
    for (let bit = 0; bit < frame.length * 8; bit++) {
      const flipped = frame.slice();
      flipped[bit >> 3]! ^= 1 << (bit & 7);
      expect(reasonFor(flipped)).toBe('bad-crc');
    }
  });

  it('tells a newer protocol apart from noise', () => {
    const frame = encodeHeader(fields());
    frame[0] = 0x20;
    expect(reasonFor(reseal(frame))).toBe('unsupported-version');
    frame[0] = 0x00;
    expect(reasonFor(reseal(frame))).toBe('unsupported-version');
  });

  it('reports reserved frame types', () => {
    const frame = encodeHeader(fields());
    frame[0] = 0x12;
    expect(reasonFor(reseal(frame))).toBe('unknown-type');
  });

  it('rejects a session ID that does not match the content', () => {
    const frame = encodeHeader(fields());
    frame[1]! ^= 0xff;
    expect(reasonFor(reseal(frame))).toBe('bad-session-id');
  });

  it('rejects label lengths that overrun the frame', () => {
    const frame = encodeHeader(fields());
    for (const mimeLen of [0, 9, 11, 255]) {
      const edited = frame.slice();
      edited[35] = mimeLen;
      expect(reasonFor(reseal(edited))).toBe('malformed-header');
    }
    const kindLen = frame.slice();
    kindLen[46] = 200;
    expect(reasonFor(reseal(kindLen))).toBe('malformed-header');
  });

  it('rejects a header too short to hold its fixed fields', () => {
    const frame = reseal(encodeHeader(fields()).slice(0, 20));
    expect(reasonFor(frame)).toBe('malformed-header');
  });

  it('rejects non-ASCII labels', () => {
    for (const bad of ['café', 'tab\there', 'line\nbreak', '\u007f']) {
      const frame = encodeHeader(fields({ mime: bad }));
      expect(reasonFor(frame)).toBe('malformed-header');
    }
  });

  it.each<[string, Partial<HeaderFields>]>([
    ['uncompressed sizes differ', { bodySize: 99 }],
    ['compressed body as large as payload', { compression: 1 }],
    ['compressed and empty', { compression: 1, bodySize: 0, frameCount: 0 }],
    ['empty body with frames', { bodySize: 0, payloadSize: 0, frameCount: 1 }],
    ['body with no frames', { frameCount: 0 }],
    ['more frames than bytes', { frameCount: 101 }],
    ['last block would be empty', { bodySize: 10, payloadSize: 10, frameCount: 7 }],
  ])('rejects inconsistent sizes: %s', (_, overrides) => {
    expect(reasonFor(encodeHeader(fields(overrides)))).toBe('malformed-header');
  });

  it('survives reading a frame from an offset buffer', () => {
    const frame = encodeHeader(fields());
    const padded = new Uint8Array(frame.length + 7);
    padded.set(frame, 5);
    expect(reasonFor(padded.subarray(5, 5 + frame.length))).toBe('ok');
  });

  it('never throws on noise', () => {
    for (let i = 0; i < 2000; i++) {
      expect(() => parseFrame(noise(i % 300, i))).not.toThrow();
    }
  });
});
