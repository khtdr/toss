import { Encoder } from 'toss-core';
import { QUIET_ZONE_MODULES, frameToText, maxFrameBytes, textToMatrix } from 'toss-qr';
import type { ErrorCorrection, QrMask } from 'toss-qr';
import { matrixToPath } from './symbol.js';
import type { SymbolFrame, SymbolSource } from './symbol.js';

export interface SendSettings {
  /** QR version, fixed for the whole transfer. */
  version: number;
  errorCorrection: ErrorCorrection;
  /** Symbols per second. */
  fps: number;
  /** Fixed, because searching for a mask is too slow to do while sending. */
  mask: QrMask;
}

/** The best setting measured on real phones. See docs/qr.md, section 4. */
export const DEFAULT_SEND_SETTINGS: Readonly<SendSettings> = {
  version: 30,
  errorCorrection: 'M',
  fps: 10,
  mask: 0,
};

export interface SendSessionOptions extends SendSettings {
  mime: string;
  kind: string;
  /** Compress when that makes the transfer smaller. Defaults to true. */
  compress?: boolean;
  /** Where in the cycle to start. Pass an earlier `stats().position` to carry on from there. */
  startPosition?: number;
}

export interface SendStats {
  /** Complete passes through the cycle. There's no back-channel, so this is all a sender can know. */
  loops: number;
  /** The place in the cycle, which `startPosition` can return to later. */
  position: number;
  /** Symbols shown per second, leaving out paused time. */
  shownFps: number;
  /** Time slots that passed with no new symbol, because the device fell behind while running. */
  skippedSlots: number;
}

/**
 * Decides which symbol to show at what time. Pure: the caller supplies the clock.
 *
 * Symbols are drawn as they're needed, one ahead of the screen. A late tick
 * delays the sequence instead of jumping it forward, so falling behind never
 * drops a frame from the cycle.
 */
export class SendSession implements SymbolSource {
  private readonly encoder: Encoder;
  private readonly options: SendSessionOptions;
  private readonly listeners = new Set<() => void>();

  private readonly startPosition: number;
  private position: number;
  private current: SymbolFrame;
  private next: SymbolFrame | undefined;
  private startedAt: number | undefined;
  private pausedAt: number | undefined;
  private lastStep = 0;
  private shown = 1;
  private skipped = 0;

  /** Throws if the settings are invalid or the header doesn't fit the symbol. */
  constructor(payload: Uint8Array, options: SendSessionOptions) {
    if (!(Number.isFinite(options.fps) && options.fps > 0)) {
      throw new RangeError(`${String(options.fps)} is not a frame rate`);
    }
    const { mime, kind, compress = true, startPosition = 0 } = options;
    if (!(Number.isSafeInteger(startPosition) && startPosition >= 0)) {
      throw new RangeError(`${String(startPosition)} is not a position`);
    }
    this.options = options;
    this.encoder = new Encoder(payload, { maxFrameBytes: maxFrameBytes(options), mime, kind, compress });
    this.startPosition = startPosition;
    this.position = startPosition;
    this.current = this.draw(startPosition);
  }

  get frameCount(): number {
    return this.encoder.frameCount;
  }

  get cycleLength(): number {
    return this.encoder.cycleLength;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSymbol = (): SymbolFrame => this.current;

  /** Moves to the next symbol if its time has come. Returns true if it did. */
  advance(now: number): boolean {
    if (this.pausedAt !== undefined) return false;
    if (this.startedAt === undefined) {
      this.startedAt = now;
      return false;
    }
    const step = Math.floor(((now - this.startedAt) * this.options.fps) / 1000);
    if (step <= this.lastStep) return false;

    this.skipped += step - this.lastStep - 1;
    this.lastStep = step;
    this.position++;
    this.current = this.next ?? this.draw(this.position);
    this.next = undefined;
    this.shown++;
    for (const listener of this.listeners) listener();
    return true;
  }

  /** Draws the next symbol early. Call it between ticks, once the screen has updated. */
  prepare(): void {
    this.next ??= this.draw(this.position + 1);
  }

  /** Holds the sequence while nobody can see it. Paused time doesn't count as falling behind. */
  pause(now: number): void {
    this.pausedAt ??= now;
  }

  /** Carries on from the same symbol. */
  resume(now: number): void {
    if (this.pausedAt === undefined) return;
    if (this.startedAt !== undefined) this.startedAt += now - this.pausedAt;
    this.pausedAt = undefined;
  }

  stats(now: number): SendStats {
    const end = this.pausedAt ?? now;
    const seconds = this.startedAt === undefined ? 0 : (end - this.startedAt) / 1000;
    return {
      loops: Math.floor((this.position - this.startPosition) / this.encoder.cycleLength),
      position: this.position % this.encoder.cycleLength,
      shownFps: seconds > 0 ? this.shown / seconds : 0,
      skippedSlots: this.skipped,
    };
  }

  private draw(t: number): SymbolFrame {
    const { version, errorCorrection, mask } = this.options;
    const text = frameToText(this.encoder.frameAt(t));
    const matrix = textToMatrix(text, { version, errorCorrection, mask });
    return { path: matrixToPath(matrix), modules: matrix.size + 2 * QUIET_ZONE_MODULES };
  }
}
