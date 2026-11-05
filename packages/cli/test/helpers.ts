import { deflateSync } from 'node:zlib';

/** Deterministic bytes that won't compress. */
export function noise(length: number, seed = 1): Uint8Array {
  const random = seeded(seed);
  return Uint8Array.from({ length }, () => Math.floor(random() * 256));
}

/** mulberry32: a small seeded generator returning values in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export function shuffled<T>(items: T[], seed: number): T[] {
  const random = seeded(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

export function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 6; // RGBA
  return chunk('IHDR', data);
}

/** Assembles a PNG from raw chunks, valid or not. */
export function rawPng(...chunks: Buffer[]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, ...chunks, chunk('IEND', new Uint8Array())]);
}

export function idat(raw: Uint8Array): Buffer {
  return chunk('IDAT', deflateSync(raw));
}

/** Flips a bit in a data frame's block and reseals it, so its CRC still passes. */
export function tamper(frame: Uint8Array): Uint8Array {
  const result = frame.slice();
  const end = result.length - 4;
  result[end - 1]! ^= 1;
  new DataView(result.buffer).setUint32(end, crc32(result.subarray(0, end)));
  return result;
}
