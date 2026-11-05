import { Inflate } from 'fflate';

export type InflateError = 'decompress-failed' | 'size-mismatch';

const CHUNK_BYTES = 1024;

/**
 * Inflates raw DEFLATE that must produce exactly `size` bytes.
 *
 * Streams so a bomb stops at `size`. `inflateSync` with a capped output bounds
 * memory, but it keeps doing the work and truncates silently.
 */
export function inflateExactly(body: Uint8Array, size: number): Uint8Array | InflateError {
  const output = new Uint8Array(size);
  let written = 0;
  let overflowed = false;

  const inflater = new Inflate((chunk) => {
    if (written + chunk.length > size) {
      overflowed = true;
      return;
    }
    output.set(chunk, written);
    written += chunk.length;
  });

  try {
    for (let at = 0; at < body.length && !overflowed; at += CHUNK_BYTES) {
      const end = at + CHUNK_BYTES;
      inflater.push(body.subarray(at, end), end >= body.length);
    }
  } catch {
    return 'decompress-failed';
  }
  return overflowed || written !== size ? 'size-mismatch' : output;
}
