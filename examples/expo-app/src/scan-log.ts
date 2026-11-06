import { Decoder } from 'toss-core';
import type { Progress } from 'toss-core';
import { textToFrame } from 'toss-qr';
import { parseKind, verifyPayload } from './run';

const HEADER_TAG = 0x10;
const DATA_TAG = 0x11;
/** Bytes are `tag, session(4), index(4)`. See docs/protocol.md, section 6. */
const INDEX_OFFSET = 5;

export interface Summary {
  run: string;
  status: 'done' | 'failed' | 'incomplete';
  /** From the first accepted frame to the last scan. */
  elapsedMs: number;
  /** Every callback from the scanner, including repeats of the same symbol. */
  scans: number;
  scansPerSecond: number;
  /** Scans that weren't a repeat of the scan before: symbols actually seen. */
  changes: number;
  /** Share of displayed symbols seen, or null if the sender's rate is unknown. */
  captured: number | null;
  blocks: { received: number; total: number | null };
  /** Times a block arrived that was already held. */
  repeatedBlocks: number;
  payloadBytesPerSecond: number | null;
  /** The transfer's payload matches what the sender should have sent. */
  verified: boolean | null;
  /** Milliseconds to hold each share of the blocks. A slow tail favours a fountain code. */
  msTo: {
    header: number | null;
    first: number | null;
    half: number | null;
    ninety: number | null;
    all: number | null;
  };
  /** Longest wait between new blocks. */
  longestStallMs: number;
  /**
   * Steps between successive data frames, modulo the frame count, as
   * `[step, count]`, most common first. One dominant step suggests phase lock.
   * A smooth spread of small steps suggests random loss.
   */
  steps: [number, number][];
  rejected: Record<string, number>;
  /** Scans where the scanner's two text fields disagreed. */
  displayValueDiffers: number;
  otherSessionFrames: number;
}

/** Records one run. Pure, so a simulated scanner can drive it in tests. */
export class ScanLog {
  private decoder = new Decoder();
  private scans = 0;
  private changes = 0;
  private repeatedBlocks = 0;
  private displayValueDiffers = 0;
  private otherSessionFrames = 0;
  private lastText: string | undefined;
  private firstAt: number | undefined;
  private lastAt = 0;
  private headerAt: number | undefined;
  /** Raw arrivals. Stats wait for `summary`, as the total is unknown before a header. */
  private indices: number[] = [];
  private newBlockTimes: number[] = [];
  private seen = new Set<number>();
  private rejected: Record<string, number> = {};
  private kind: string | undefined;
  private payload: Uint8Array | undefined;
  private failed = false;

  progress: Progress = { received: 0, total: null };

  get finished(): boolean {
    return this.payload !== undefined || this.failed;
  }

  /** `raw` is the scanner's unprocessed value, `data` the one it may reformat. */
  push(raw: string, data: string, at: number): void {
    this.scans++;
    this.lastAt = at;
    if (raw !== data) this.displayValueDiffers++;

    const changed = raw !== this.lastText;
    this.lastText = raw;
    if (changed) this.changes++;
    if (!changed || this.finished) return;

    const read = textToFrame(raw);
    if (!read.ok) return this.reject(read.reason);
    this.firstAt ??= at;

    const result = this.decoder.push(read.frame);
    this.progress = result.progress;
    this.kind = result.meta?.kind ?? this.kind;
    this.otherSessionFrames = result.otherSessionFrames;
    if (result.outcome === 'rejected') this.reject(result.reason ?? 'rejected');
    if (result.outcome !== 'rejected') this.observe(read.frame, at);

    if (result.payload) this.payload = result.payload;
    if (result.error) this.failed = true;
  }

  private reject(reason: string): void {
    this.rejected[reason] = (this.rejected[reason] ?? 0) + 1;
  }

  private observe(frame: Uint8Array, at: number): void {
    if (frame[0] === HEADER_TAG) this.headerAt ??= at;
    if (frame[0] !== DATA_TAG) return;

    const index = new DataView(frame.buffer, frame.byteOffset).getUint32(INDEX_OFFSET);
    this.indices.push(index);
    if (this.seen.has(index)) {
      this.repeatedBlocks++;
    } else {
      this.seen.add(index);
      this.newBlockTimes.push(at);
    }
  }

  private stepCounts(total: number | null): [number, number][] {
    if (!total) return [];
    const counts = new Map<number, number>();
    for (let i = 1; i < this.indices.length; i++) {
      const step = (((this.indices[i]! - this.indices[i - 1]!) % total) + total) % total;
      counts.set(step, (counts.get(step) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }

  private milestones(total: number | null): Summary['msTo'] {
    const start = this.firstAt ?? 0;
    const at = (count: number) => {
      const time = this.newBlockTimes[count - 1];
      return time === undefined ? null : time - start;
    };
    return {
      header: this.headerAt === undefined ? null : this.headerAt - start,
      first: at(1),
      half: total ? at(Math.ceil(total / 2)) : null,
      ninety: total ? at(Math.ceil(total * 0.9)) : null,
      all: total ? at(total) : null,
    };
  }

  private longestStall(): number {
    const times = this.newBlockTimes;
    return times.reduce((longest, time, i) => (i ? Math.max(longest, time - times[i - 1]!) : 0), 0);
  }

  summary(): Summary {
    const elapsedMs = this.firstAt === undefined ? 0 : this.lastAt - this.firstAt;
    const seconds = elapsedMs / 1000;
    const fps = this.kind === undefined ? undefined : parseKind(this.kind)?.fps;
    const payload = this.payload;
    return {
      run: this.kind ?? 'unknown',
      status: payload ? 'done' : this.failed ? 'failed' : 'incomplete',
      elapsedMs,
      scans: this.scans,
      scansPerSecond: seconds > 0 ? this.scans / seconds : 0,
      changes: this.changes,
      captured: fps && seconds > 0 ? Math.min(1, this.changes / (seconds * fps)) : null,
      blocks: { received: this.progress.received, total: this.progress.total },
      repeatedBlocks: this.repeatedBlocks,
      payloadBytesPerSecond: payload && seconds > 0 ? payload.length / seconds : null,
      verified: payload && this.kind !== undefined ? verifyPayload(this.kind, payload) : null,
      msTo: this.milestones(this.progress.total),
      longestStallMs: this.longestStall(),
      steps: this.stepCounts(this.progress.total),
      rejected: this.rejected,
      displayValueDiffers: this.displayValueDiffers,
      otherSessionFrames: this.otherSessionFrames,
    };
  }
}
