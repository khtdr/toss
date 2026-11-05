import { sha256 } from '@noble/hashes/sha2.js';
import { crc32 } from './crc32.js';

/** Wire format, version 1. See docs/protocol.md, sections 4-7. */
export const PROTOCOL_VERSION = 1;

export const TYPE_HEADER = 0;
export const TYPE_DATA = 1;

export const COMPRESSION_NONE = 0;
export const COMPRESSION_DEFLATE = 1;

export const REDUNDANCY_PLAIN = 0;

export const HASH_BYTES = 16;
export const CRC_BYTES = 4;
/** Fixed bytes in a data frame: version/type, session ID, index, CRC. */
export const DATA_OVERHEAD = 13;
/** Fixed bytes in a header frame, excluding `mime` and `kind`. */
export const HEADER_OVERHEAD = 41;
/** The smallest possible frame: a data frame carrying one byte. */
export const MIN_FRAME_BYTES = DATA_OVERHEAD + 1;
export const MAX_U32 = 0xffffffff;
export const MAX_LABEL_BYTES = 255;

const CONTENT_OFFSET = 5;
const MIME_LEN_OFFSET = 35;
const BLOCK_OFFSET = 9;

export interface HeaderFields {
  compression: number;
  redundancy: number;
  frameCount: number;
  bodySize: number;
  payloadSize: number;
  payloadHash: Uint8Array;
  mime: string;
  kind: string;
}

export interface HeaderFrame extends HeaderFields {
  type: 'header';
  sessionId: number;
}

export interface DataFrame {
  type: 'data';
  sessionId: number;
  index: number;
  /** A view into the pushed frame. Copy it to keep it. */
  block: Uint8Array;
}

export type FrameError =
  | 'too-short'
  | 'too-long'
  | 'bad-crc'
  | 'unsupported-version'
  | 'unknown-type'
  | 'malformed-header'
  | 'bad-session-id';

export type ParseResult =
  | { ok: true; frame: HeaderFrame | DataFrame }
  | { ok: false; reason: FrameError };

function fail(reason: FrameError): ParseResult {
  return { ok: false, reason };
}

export function hashPayload(payload: Uint8Array): Uint8Array {
  return sha256(payload).slice(0, HASH_BYTES);
}

/** Block size is derived from the header, so it never travels on the wire. */
export function blockSizeFor(bodySize: number, frameCount: number): number {
  return Math.ceil(bodySize / frameCount);
}

export function blockLength(index: number, bodySize: number, frameCount: number): number {
  const size = blockSizeFor(bodySize, frameCount);
  return Math.min(size, bodySize - index * size);
}

export function isPrintableAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

function firstByte(type: number): number {
  return (PROTOCOL_VERSION << 4) | type;
}

function sessionIdOf(content: Uint8Array): number {
  const digest = sha256(content);
  return new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0);
}

function seal(frame: Uint8Array): Uint8Array {
  const end = frame.length - CRC_BYTES;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
  view.setUint32(end, crc32(frame.subarray(0, end)));
  return frame;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
}

function readAscii(source: Uint8Array): string {
  let text = '';
  for (let i = 0; i < source.length; i++) text += String.fromCharCode(source[i]!);
  return text;
}

export function encodeHeader(fields: HeaderFields): Uint8Array {
  const { mime, kind } = fields;
  const frame = new Uint8Array(HEADER_OVERHEAD + mime.length + kind.length);
  const view = new DataView(frame.buffer);
  frame[0] = firstByte(TYPE_HEADER);
  frame[5] = fields.compression;
  frame[6] = fields.redundancy;
  view.setUint32(7, fields.frameCount);
  view.setUint32(11, fields.bodySize);
  view.setUint32(15, fields.payloadSize);
  frame.set(fields.payloadHash, 19);
  frame[MIME_LEN_OFFSET] = mime.length;
  writeAscii(frame, MIME_LEN_OFFSET + 1, mime);
  const kindLenOffset = MIME_LEN_OFFSET + 1 + mime.length;
  frame[kindLenOffset] = kind.length;
  writeAscii(frame, kindLenOffset + 1, kind);
  const contentEnd = frame.length - CRC_BYTES;
  view.setUint32(1, sessionIdOf(frame.subarray(CONTENT_OFFSET, contentEnd)));
  return seal(frame);
}

export function encodeData(sessionId: number, index: number, block: Uint8Array): Uint8Array {
  const frame = new Uint8Array(DATA_OVERHEAD + block.length);
  const view = new DataView(frame.buffer);
  frame[0] = firstByte(TYPE_DATA);
  view.setUint32(1, sessionId);
  view.setUint32(5, index);
  frame.set(block, BLOCK_OFFSET);
  return seal(frame);
}

function sizesAreConsistent(h: HeaderFields): boolean {
  const { compression, bodySize, payloadSize, frameCount } = h;
  if (compression === COMPRESSION_NONE) {
    if (bodySize !== payloadSize) return false;
  } else if (bodySize === 0 || bodySize >= payloadSize) {
    return false;
  }
  if (bodySize === 0) return frameCount === 0;
  if (frameCount < 1 || frameCount > bodySize) return false;
  return (frameCount - 1) * blockSizeFor(bodySize, frameCount) < bodySize;
}

function parseHeader(frame: Uint8Array, view: DataView): ParseResult {
  const contentEnd = frame.length - CRC_BYTES;
  if (frame.length < HEADER_OVERHEAD) return fail('malformed-header');

  const mimeLen = frame[MIME_LEN_OFFSET]!;
  const kindLenOffset = MIME_LEN_OFFSET + 1 + mimeLen;
  if (kindLenOffset >= contentEnd) return fail('malformed-header');
  const kindLen = frame[kindLenOffset]!;
  if (kindLenOffset + 1 + kindLen !== contentEnd) return fail('malformed-header');

  const mime = readAscii(frame.subarray(MIME_LEN_OFFSET + 1, kindLenOffset));
  const kind = readAscii(frame.subarray(kindLenOffset + 1, contentEnd));
  if (!isPrintableAscii(mime) || !isPrintableAscii(kind)) return fail('malformed-header');

  const header: HeaderFrame = {
    type: 'header',
    sessionId: view.getUint32(1),
    compression: frame[5]!,
    redundancy: frame[6]!,
    frameCount: view.getUint32(7),
    bodySize: view.getUint32(11),
    payloadSize: view.getUint32(15),
    payloadHash: frame.slice(19, 19 + HASH_BYTES),
    mime,
    kind,
  };
  if (!sizesAreConsistent(header)) return fail('malformed-header');
  if (sessionIdOf(frame.subarray(CONTENT_OFFSET, contentEnd)) !== header.sessionId) {
    return fail('bad-session-id');
  }
  return { ok: true, frame: header };
}

/** Runs the frame-level checks in docs/protocol.md section 9. Never throws. */
export function parseFrame(frame: Uint8Array, maxFrameBytes?: number): ParseResult {
  if (frame.length < MIN_FRAME_BYTES) return fail('too-short');
  if (maxFrameBytes !== undefined && frame.length > maxFrameBytes) return fail('too-long');

  const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
  const end = frame.length - CRC_BYTES;
  if (view.getUint32(end) !== crc32(frame.subarray(0, end))) return fail('bad-crc');

  const version = frame[0]! >> 4;
  const type = frame[0]! & 0x0f;
  if (version !== PROTOCOL_VERSION) return fail('unsupported-version');

  if (type === TYPE_HEADER) return parseHeader(frame, view);
  if (type === TYPE_DATA) {
    return {
      ok: true,
      frame: {
        type: 'data',
        sessionId: view.getUint32(1),
        index: view.getUint32(5),
        block: frame.subarray(BLOCK_OFFSET, end),
      },
    };
  }
  return fail('unknown-type');
}
