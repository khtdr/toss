import { decodeBase45, encodeBase45 } from './base45.js';
import { MAX_TEXT_LENGTH } from './capacity.js';

/**
 * Marks a toss frame. It also keeps the text from starting with a space, which
 * base45 would otherwise do for about 1 session in 45. See docs/qr.md.
 */
const PREFIX = 'T';

export type TextError = 'not-toss' | 'too-long' | 'bad-base45';

export type TextResult = { ok: true; frame: Uint8Array } | { ok: false; reason: TextError };

/** Turns a frame into the text a QR symbol carries. */
export function frameToText(frame: Uint8Array): string {
  return PREFIX + encodeBase45(frame);
}

/**
 * Reads a frame from scanned text, which is untrusted and may be any QR code in
 * view. Never throws. The frame's CRC is checked later, by `Decoder.push`.
 */
export function textToFrame(text: string): TextResult {
  if (!text.startsWith(PREFIX)) return { ok: false, reason: 'not-toss' };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, reason: 'too-long' };
  const frame = decodeBase45(text.slice(PREFIX.length));
  return frame ? { ok: true, frame } : { ok: false, reason: 'bad-base45' };
}
