import { Decoder } from 'toss-core';
import type { DecodeError, FrameReason, Progress, TransferMeta } from 'toss-core';
import { textToFrame } from 'toss-qr';

export type ReceiveStatus = 'searching' | 'receiving' | 'done' | 'failed' | 'cancelled';

/** The decoder refuses these headers without failing, so scanning on could never finish. */
const FATAL_REASONS = [
  'payload-too-large',
  'too-many-frames',
  'unsupported-compression',
  'unsupported-redundancy',
] as const satisfies readonly FrameReason[];

type FatalReason = (typeof FATAL_REASONS)[number];

export type ReceiveError = DecodeError | FatalReason;

function isFatal(reason: FrameReason | undefined): reason is FatalReason {
  return (FATAL_REASONS as readonly (FrameReason | undefined)[]).includes(reason);
}

export interface ReceiveOptions {
  /** Largest accepted payload. Defaults to the `toss-core` limit, 16 MiB. */
  maxPayloadBytes?: number;
  /** Largest accepted frame count. Defaults to the `toss-core` limit, 65,536. */
  maxFrameCount?: number;
}

export interface ReceiveSnapshot {
  status: ReceiveStatus;
  progress: Progress;
  /** Set once the header arrives. Comes from the sender, so it's untrusted. */
  meta?: TransferMeta;
  /** Set when `status` is `done`. Untrusted. */
  payload?: Uint8Array;
  /** Set when `status` is `failed`. */
  error?: ReceiveError;
  /** Scanner callbacks per second, including repeats of the same symbol. */
  scansPerSecond: number;
  /** Time since the last new block, or since the start. A good cue to ask people to hold steady. */
  stalledMs: number;
  /** Different codes that weren't usable: other QR codes, or damaged frames. */
  rejectedScans: number;
  /**
   * Valid frames from a different transfer. This rises if the sender restarted
   * with new data, and `reset` is the way to follow it.
   */
  otherSessionFrames: number;
}

function initialSnapshot(): ReceiveSnapshot {
  return {
    status: 'searching',
    progress: { received: 0, total: null },
    scansPerSecond: 0,
    stalledMs: 0,
    rejectedScans: 0,
    otherSessionFrames: 0,
  };
}

/** Turns scanner text into transfer state. Pure: the caller supplies the clock. */
export class ReceiveSession {
  private readonly decoder: Decoder;
  private readonly listeners = new Set<() => void>();

  private snapshot = initialSnapshot();
  private lastText: string | undefined;
  private lastProgressAt: number;
  private scans = 0;
  private rateFrom: number;

  constructor(options: ReceiveOptions, now: number) {
    this.decoder = new Decoder(options);
    this.lastProgressAt = now;
    this.rateFrom = now;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ReceiveSnapshot => this.snapshot;

  get finished(): boolean {
    const { status } = this.snapshot;
    return status === 'done' || status === 'failed' || status === 'cancelled';
  }

  /** Takes one scanner result. Never throws on bad input. */
  scan(text: string, now: number): void {
    if (this.finished) return;
    this.scans++;

    // A camera sees each symbol several times, and repeats need no decoding.
    if (text === this.lastText) return;
    this.lastText = text;

    const read = textToFrame(text);
    if (!read.ok) {
      this.update({ rejectedScans: this.snapshot.rejectedScans + 1 });
      return;
    }

    const result = this.decoder.push(read.frame);
    if (isFatal(result.reason)) {
      this.update({ status: 'failed', error: result.reason });
      return;
    }

    const before = this.snapshot;
    if (result.progress.received > before.progress.received) this.lastProgressAt = now;

    let status = before.status;
    if (result.state === 'done' || result.state === 'failed') status = result.state;
    else if (result.progress.received > 0 || result.state === 'locked') status = 'receiving';

    const next: Partial<ReceiveSnapshot> = {
      status,
      progress: result.progress,
      otherSessionFrames: result.otherSessionFrames,
      rejectedScans: before.rejectedScans + (result.outcome === 'rejected' ? 1 : 0),
    };
    if (result.meta) next.meta = result.meta;
    if (result.payload) next.payload = result.payload;
    if (result.error) next.error = result.error;

    const changed =
      status !== before.status ||
      result.progress.received !== before.progress.received ||
      result.progress.total !== before.progress.total ||
      next.rejectedScans !== before.rejectedScans ||
      next.otherSessionFrames !== before.otherSessionFrames;
    if (changed) this.update(next);
  }

  /** Updates the figures that change with time alone. Call it a few times a second. */
  refresh(now: number): void {
    if (this.finished) return;
    const seconds = (now - this.rateFrom) / 1000;
    if (seconds <= 0) return;
    this.update({ scansPerSecond: this.scans / seconds, stalledMs: now - this.lastProgressAt });
    this.scans = 0;
    this.rateFrom = now;
  }

  /** Drops the transfer and stops taking scans. */
  cancel(): void {
    if (this.finished) return;
    this.decoder.reset();
    this.snapshot = { ...initialSnapshot(), status: 'cancelled' };
    this.notify();
  }

  /** Forgets everything, ready for a new transfer. */
  reset(now: number): void {
    this.decoder.reset();
    this.lastText = undefined;
    this.lastProgressAt = now;
    this.scans = 0;
    this.rateFrom = now;
    this.snapshot = initialSnapshot();
    this.notify();
  }

  private update(changes: Partial<ReceiveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
