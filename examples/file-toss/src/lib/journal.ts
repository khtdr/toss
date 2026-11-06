/** Where a journal keeps its frames, one log per transfer. */
export interface JournalFiles {
  read(session: string): Promise<Uint8Array | null>;
  append(session: string, bytes: Uint8Array): Promise<void>;
  remove(session: string): Promise<void>;
}

const LENGTH_BYTES = 2;
const MAX_FRAME_BYTES = 0xffff;
const FLUSH_AT_FRAMES = 32;
/** How many frames to restore between breaks, so the screen stays responsive. */
export const RESTORE_BATCH = 256;

/** Lays frames out as a length and the bytes, so a log can be appended to. */
export function packFrames(frames: readonly Uint8Array[]): Uint8Array {
  const size = frames.reduce((sum, frame) => sum + LENGTH_BYTES + frame.length, 0);
  const packed = new Uint8Array(size);
  let at = 0;
  for (const frame of frames) {
    if (frame.length > MAX_FRAME_BYTES) throw new RangeError('frame is too long to log');
    packed[at] = frame.length >> 8;
    packed[at + 1] = frame.length & 0xff;
    packed.set(frame, at + LENGTH_BYTES);
    at += LENGTH_BYTES + frame.length;
  }
  return packed;
}

/** The reverse of `packFrames`. A write cut short by a crash loses only its last frame. */
export function unpackFrames(log: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let at = 0;
  while (at + LENGTH_BYTES <= log.length) {
    const length = (log[at]! << 8) | log[at + 1]!;
    const start = at + LENGTH_BYTES;
    if (start + length > log.length) break;
    frames.push(log.subarray(start, start + length));
    at = start + length;
  }
  return frames;
}

/**
 * Keeps a receiver's frames on disk, so a transfer survives the app closing.
 * Replaying them through a new decoder rebuilds its state, so `toss-core` never
 * needs to save anything.
 *
 * Frames wait in memory until `open` says which transfer they belong to.
 */
export class FrameJournal {
  private session: string | null = null;
  private waiting: Uint8Array[] = [];
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly files: JournalFiles) {}

  /** Binds to a transfer, returning the frames an earlier run kept. */
  async open(session: string): Promise<Uint8Array[]> {
    const log = await this.files.read(session);
    this.session = session;
    return log ? unpackFrames(log) : [];
  }

  add(frame: Uint8Array): void {
    this.waiting.push(frame);
    if (this.waiting.length >= FLUSH_AT_FRAMES) void this.flush();
  }

  /** Writes what's waiting. A failed write keeps its frames for the next try. */
  flush(): Promise<void> {
    this.writes = this.writes.then(async () => {
      const { session } = this;
      if (session === null || this.waiting.length === 0) return;
      const frames = this.waiting;
      this.waiting = [];
      try {
        await this.files.append(session, packFrames(frames));
      } catch {
        this.waiting = [...frames, ...this.waiting];
      }
    });
    return this.writes;
  }

  /** Forgets the bound transfer's log, once its file is safe or it's been dropped. */
  async discard(): Promise<void> {
    await this.writes;
    const { session } = this;
    this.detach();
    if (session !== null) await this.files.remove(session);
  }

  /** Saves what's waiting and lets go, ready for a different transfer. */
  async close(): Promise<void> {
    await this.flush();
    this.detach();
  }

  private detach(): void {
    this.session = null;
    this.waiting = [];
  }
}
