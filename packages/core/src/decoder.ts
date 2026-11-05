import {
  COMPRESSION_DEFLATE,
  COMPRESSION_NONE,
  REDUNDANCY_PLAIN,
  blockLength,
  blockSizeFor,
  hashPayload,
  parseFrame,
} from './frame.js';
import type { DataFrame, FrameError, HeaderFrame } from './frame.js';
import { inflateExactly } from './inflate.js';
import type { InflateError } from './inflate.js';

export interface DecoderOptions {
  /** Reject frames longer than this. Unset by default. */
  maxFrameBytes?: number;
  /** Largest accepted payload or body. Defaults to 16 MiB. */
  maxPayloadBytes?: number;
  /** Largest accepted frame count. Defaults to 65,536. */
  maxFrameCount?: number;
  /** Total block bytes held before a header arrives. Defaults to 256 KiB. */
  maxPendingBytes?: number;
  /** Total blocks held before a header arrives. Defaults to 256. */
  maxPendingFrames?: number;
}

export type DecoderState = 'searching' | 'locked' | 'done' | 'failed';

export type FrameOutcome =
  /** The header locked the decoder to its session. */
  | 'header'
  /** A new block for the locked session. */
  | 'block'
  /** A new block held until its header arrives. */
  | 'pending'
  /** Already had this frame. */
  | 'duplicate'
  /** Valid, but not used. See `reason`. */
  | 'ignored'
  /** Invalid or unacceptable. See `reason`. */
  | 'rejected';

export type FrameReason =
  | FrameError
  | 'unsupported-compression'
  | 'unsupported-redundancy'
  | 'payload-too-large'
  | 'too-many-frames'
  | 'bad-index'
  | 'bad-block-length'
  | 'other-session'
  | 'pending-full';

export type DecodeError = InflateError | 'hash-mismatch';

export interface Progress {
  received: number;
  /** Null until a header arrives. */
  total: number | null;
}

export interface TransferMeta {
  sessionId: number;
  mime: string;
  kind: string;
  payloadSize: number;
}

export interface PushResult {
  state: DecoderState;
  outcome: FrameOutcome;
  reason?: FrameReason;
  progress: Progress;
  done: boolean;
  /** Valid frames from sessions other than the locked one, so far. */
  otherSessionFrames: number;
  /** Available from the moment the decoder locks. */
  meta?: TransferMeta;
  /** Set when `state` is `done`. */
  payload?: Uint8Array;
  /** Set when `state` is `failed`. */
  error?: DecodeError;
}

const IGNORED = new Set<FrameReason>(['unknown-type', 'other-session', 'pending-full']);

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Rebuilds a payload from frames in any order. Feed it with `push()`. */
export class Decoder {
  private readonly maxFrameBytes: number | undefined;
  private readonly maxPayloadBytes: number;
  private readonly maxFrameCount: number;
  private readonly maxPendingBytes: number;
  private readonly maxPendingFrames: number;

  private status: DecoderState = 'searching';
  private header: HeaderFrame | undefined;
  private blocks = new Map<number, Uint8Array>();
  private pending = new Map<number, Map<number, Uint8Array>>();
  private pendingBytes = 0;
  private pendingFrames = 0;
  private otherSessionFrames = 0;
  private payload: Uint8Array | undefined;
  private error: DecodeError | undefined;
  private final: PushResult | undefined;

  constructor(options: DecoderOptions = {}) {
    this.maxFrameBytes = options.maxFrameBytes;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 16 * 1024 * 1024;
    this.maxFrameCount = options.maxFrameCount ?? 65_536;
    this.maxPendingBytes = options.maxPendingBytes ?? 256 * 1024;
    this.maxPendingFrames = options.maxPendingFrames ?? 256;
  }

  get state(): DecoderState {
    return this.status;
  }

  /** Takes one frame. Never throws on bad input. */
  push(frame: Uint8Array): PushResult {
    if (this.final) return this.final;

    const parsed = parseFrame(frame, this.maxFrameBytes);
    if (!parsed.ok) return this.refuse(parsed.reason);
    return parsed.frame.type === 'header'
      ? this.pushHeader(parsed.frame)
      : this.pushData(parsed.frame);
  }

  /** Forgets everything, ready for a new transfer. */
  reset(): void {
    this.status = 'searching';
    this.header = undefined;
    this.blocks = new Map();
    this.otherSessionFrames = 0;
    this.payload = undefined;
    this.error = undefined;
    this.final = undefined;
    this.clearPending();
  }

  private pushHeader(header: HeaderFrame): PushResult {
    const problem = this.checkHeader(header);
    if (problem) return this.refuse(problem);

    if (this.header) {
      if (header.sessionId === this.header.sessionId) return this.report('duplicate');
      this.otherSessionFrames++;
      return this.refuse('other-session');
    }

    this.header = header;
    this.status = 'locked';
    this.promotePending(header);
    this.finishIfComplete();
    return this.report('header');
  }

  private checkHeader(header: HeaderFrame): FrameReason | undefined {
    if (header.compression !== COMPRESSION_NONE && header.compression !== COMPRESSION_DEFLATE) {
      return 'unsupported-compression';
    }
    if (header.redundancy !== REDUNDANCY_PLAIN) return 'unsupported-redundancy';
    if (header.payloadSize > this.maxPayloadBytes || header.bodySize > this.maxPayloadBytes) {
      return 'payload-too-large';
    }
    if (header.frameCount > this.maxFrameCount) return 'too-many-frames';
    return undefined;
  }

  private pushData(frame: DataFrame): PushResult {
    if (!this.header) return this.hold(frame);

    if (frame.sessionId !== this.header.sessionId) {
      this.otherSessionFrames++;
      return this.refuse('other-session');
    }
    const problem = this.checkBlock(this.header, frame.index, frame.block);
    if (problem) return this.refuse(problem);
    if (this.blocks.has(frame.index)) return this.report('duplicate');

    this.blocks.set(frame.index, frame.block.slice());
    this.finishIfComplete();
    return this.report('block');
  }

  private checkBlock(header: HeaderFrame, index: number, block: Uint8Array): FrameReason | undefined {
    if (index >= header.frameCount) return 'bad-index';
    if (block.length !== blockLength(index, header.bodySize, header.frameCount)) {
      return 'bad-block-length';
    }
    return undefined;
  }

  private hold(frame: DataFrame): PushResult {
    if (frame.index >= this.maxFrameCount) return this.refuse('bad-index');

    const session = this.pending.get(frame.sessionId);
    if (session?.has(frame.index)) return this.report('duplicate');

    const bytes = this.pendingBytes + frame.block.length;
    if (this.pendingFrames >= this.maxPendingFrames || bytes > this.maxPendingBytes) {
      return this.refuse('pending-full');
    }

    const blocks = session ?? new Map<number, Uint8Array>();
    blocks.set(frame.index, frame.block.slice());
    this.pending.set(frame.sessionId, blocks);
    this.pendingBytes = bytes;
    this.pendingFrames++;
    return this.report('pending');
  }

  private promotePending(header: HeaderFrame): void {
    const held = this.pending.get(header.sessionId);
    this.clearPending();
    if (!held) return;
    for (const [index, block] of held) {
      if (!this.checkBlock(header, index, block)) this.blocks.set(index, block);
    }
  }

  private clearPending(): void {
    this.pending = new Map();
    this.pendingBytes = 0;
    this.pendingFrames = 0;
  }

  private finishIfComplete(): void {
    const header = this.header;
    if (!header || this.blocks.size < header.frameCount) return;

    const body = new Uint8Array(header.bodySize);
    if (header.frameCount > 0) {
      const size = blockSizeFor(header.bodySize, header.frameCount);
      for (const [index, block] of this.blocks) body.set(block, index * size);
    }
    this.blocks = new Map();

    const payload =
      header.compression === COMPRESSION_DEFLATE ? inflateExactly(body, header.payloadSize) : body;
    if (typeof payload === 'string') {
      this.fail(payload);
      return;
    }
    if (!sameBytes(hashPayload(payload), header.payloadHash)) {
      this.fail('hash-mismatch');
      return;
    }
    this.payload = payload;
    this.status = 'done';
  }

  private fail(error: DecodeError): void {
    this.error = error;
    this.status = 'failed';
  }

  private refuse(reason: FrameReason): PushResult {
    return this.report(IGNORED.has(reason) ? 'ignored' : 'rejected', reason);
  }

  private report(outcome: FrameOutcome, reason?: FrameReason): PushResult {
    const header = this.header;
    const finished = this.status === 'done' || this.status === 'failed';
    const received = finished && header ? header.frameCount : this.blocks.size;
    const result: PushResult = {
      state: this.status,
      outcome,
      progress: { received: header ? received : this.pendingFrames, total: header?.frameCount ?? null },
      done: this.status === 'done',
      otherSessionFrames: this.otherSessionFrames,
    };
    if (reason) result.reason = reason;
    if (header) {
      result.meta = {
        sessionId: header.sessionId,
        mime: header.mime,
        kind: header.kind,
        payloadSize: header.payloadSize,
      };
    }
    if (this.payload) result.payload = this.payload;
    if (this.error) result.error = this.error;
    if (finished) this.final = result;
    return result;
  }
}
