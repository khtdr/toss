import type { ErrorCorrection } from 'toss-qr';

export type PayloadType = 'noise' | 'json';

export interface RunConfig {
  version: number;
  errorCorrection: ErrorCorrection;
  fps: number;
  payloadBytes: number;
  payloadType: PayloadType;
}

const KIND = /^spike-v(\d+)-([LMQH])-(\d+)fps-(noise|json)$/;

/** Sent as the transfer's `kind`, so a receiver needs no settings of its own. */
export function runKind({ version, errorCorrection, fps, payloadType }: RunConfig): string {
  return `spike-v${version}-${errorCorrection}-${fps}fps-${payloadType}`;
}

export function parseKind(kind: string): Omit<RunConfig, 'payloadBytes'> | undefined {
  const match = KIND.exec(kind);
  if (!match) return undefined;
  const [, version, errorCorrection, fps, payloadType] = match;
  return {
    version: Number(version),
    errorCorrection: errorCorrection as ErrorCorrection,
    fps: Number(fps),
    payloadType: payloadType as PayloadType,
  };
}

/** What `useTossSend` needs for a run, beyond the bytes. */
export function sendOptions(config: RunConfig) {
  const { version, errorCorrection, fps, payloadType } = config;
  const mime = payloadType === 'json' ? 'application/json' : 'application/octet-stream';
  return { mime, kind: runKind(config), version, errorCorrection, fps };
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Deterministic bytes that won't compress, so frame counts are predictable. */
export function noisePayload(length: number): Uint8Array {
  const next = random(0x70737304);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = next() & 0xff;
  return bytes;
}

const WORDS = ['harbor', 'ember', 'slate', 'meadow', 'copper', 'tide', 'lantern', 'moss', 'quartz', 'willow', 'dune', 'fern'];

/** Valid JSON of exactly `length` bytes, shaped like app data, so it compresses like app data. */
export function jsonPayload(length: number): Uint8Array {
  const next = random(0x6a736f6e);
  const word = () => WORDS[next() % WORDS.length]!;
  const items: string[] = [];
  let size = 2;
  for (let id = 1; ; id++) {
    const item = JSON.stringify({
      id,
      name: `${word()} ${word()}`,
      color: `#${(next() & 0xffffff).toString(16).padStart(6, '0')}`,
      opacity: (next() % 100) / 100,
      enabled: next() % 2 === 0,
      updatedAt: 1_780_000_000 + (next() % 10_000_000),
      tags: [word(), word()],
    });
    if (size + item.length + 1 > length) break;
    items.push(item);
    size += item.length + 1;
  }
  const text = `[${items.join(',')}]`.padEnd(length, ' ');
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

export function testPayload(length: number, type: PayloadType): Uint8Array {
  return type === 'json' ? jsonPayload(length) : noisePayload(length);
}

/** Whether a received payload is what a sender of this `kind` should have sent. */
export function verifyPayload(kind: string, payload: Uint8Array): boolean {
  const expected = testPayload(payload.length, parseKind(kind)?.payloadType ?? 'noise');
  return payload.every((byte, i) => byte === expected[i]);
}
