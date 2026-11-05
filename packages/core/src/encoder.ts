import { deflateSync } from 'fflate';
import {
  COMPRESSION_DEFLATE,
  COMPRESSION_NONE,
  DATA_OVERHEAD,
  MAX_LABEL_BYTES,
  MAX_U32,
  MIN_FRAME_BYTES,
  REDUNDANCY_PLAIN,
  blockSizeFor,
  encodeData,
  encodeHeader,
  hashPayload,
  isPrintableAscii,
} from './frame.js';
import { HEADER_SLOT, buildCycle } from './schedule.js';

export interface EncoderOptions {
  /** The largest frame the carrier can move, in bytes. */
  maxFrameBytes: number;
  /** Printable ASCII, at most 255 characters. */
  mime: string;
  /** App-defined label. Printable ASCII, at most 255 characters. */
  kind: string;
  /** Compress when that makes the body smaller. Defaults to true. */
  compress?: boolean;
}

function checkLabel(name: string, value: string): void {
  if (value.length > MAX_LABEL_BYTES || !isPrintableAscii(value)) {
    throw new RangeError(`${name} must be printable ASCII, at most ${MAX_LABEL_BYTES} characters`);
  }
}

function chooseBody(payload: Uint8Array, compress: boolean): [Uint8Array, number] {
  if (compress && payload.length > 0) {
    const deflated = deflateSync(payload, { level: 9 });
    if (deflated.length < payload.length) return [deflated, COMPRESSION_DEFLATE];
  }
  return [payload.slice(), COMPRESSION_NONE];
}

/** Turns a payload into an endless, deterministic sequence of frames. */
export class Encoder {
  readonly sessionId: number;
  readonly frameCount: number;
  readonly compressed: boolean;

  private readonly body: Uint8Array;
  private readonly blockSize: number;
  private readonly header: Uint8Array;
  private readonly cycle: Int32Array;
  private position = 0;

  constructor(payload: Uint8Array, options: EncoderOptions) {
    const { maxFrameBytes, mime, kind, compress = true } = options;
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < MIN_FRAME_BYTES) {
      throw new RangeError(`maxFrameBytes must be an integer of at least ${MIN_FRAME_BYTES}`);
    }
    if (payload.length > MAX_U32) throw new RangeError('payload is too large');
    checkLabel('mime', mime);
    checkLabel('kind', kind);

    const [body, compression] = chooseBody(payload, compress);
    const frameCount = Math.ceil(body.length / (maxFrameBytes - DATA_OVERHEAD));

    this.header = encodeHeader({
      compression,
      redundancy: REDUNDANCY_PLAIN,
      frameCount,
      bodySize: body.length,
      payloadSize: payload.length,
      payloadHash: hashPayload(payload),
      mime,
      kind,
    });
    if (this.header.length > maxFrameBytes) {
      throw new RangeError(
        `header needs ${this.header.length} bytes, which exceeds maxFrameBytes (${maxFrameBytes})`,
      );
    }

    this.body = body;
    this.blockSize = frameCount > 0 ? blockSizeFor(body.length, frameCount) : 0;
    this.cycle = buildCycle(frameCount);
    this.frameCount = frameCount;
    this.compressed = compression !== COMPRESSION_NONE;
    this.sessionId = new DataView(this.header.buffer).getUint32(1);
  }

  /** The number of frames before the sequence repeats. */
  get cycleLength(): number {
    return this.cycle.length;
  }

  /** Returns the next frame. Never runs out. */
  nextFrame(): Uint8Array {
    const frame = this.frameAt(this.position);
    this.position = (this.position + 1) % this.cycle.length;
    return frame;
  }

  /** Returns the frame at position `t`. Depends only on `t`. */
  frameAt(t: number): Uint8Array {
    const slot = this.cycle[t % this.cycle.length]!;
    if (slot === HEADER_SLOT) return this.header.slice();
    const start = slot * this.blockSize;
    const block = this.body.subarray(start, start + this.blockSize);
    return encodeData(this.sessionId, slot, block);
  }
}
