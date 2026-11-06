import { DATA_OVERHEAD, Encoder } from 'toss-core';

/** What a transfer's timing depends on. Both phones run the same app, so both know this. */
export interface Link {
  /** Symbols per second. */
  fps: number;
  /** File bytes carried by one symbol. */
  blockBytes: number;
}

/** Seconds, as a likely range. */
export interface TimeRange {
  low: number;
  high: number;
}

/**
 * Hand-held capture rates seen on real phones, the share of symbols a receiver
 * reads on one pass. See docs/qr.md, section 4.
 */
export const CAPTURE = { best: 0.92, likely: 0.88, worst: 0.84 } as const;

const EULER_GAMMA = 0.5772;
const MIN_CYCLE = 11;
const FRAMES_PER_HEADER = 16;
const SAMPLE_BYTES = 64 * 1024;
const SAMPLES = 4;
/** Compression has to beat this to be worth the time it takes on the phone. */
const WORTHWHILE_RATIO = 0.95;
/** Below this, there's too little to measure the rate from. */
const MIN_MEASURED_SECONDS = 3;

/** Seconds for one pass through the loop. */
export function passSeconds(frames: number, link: Link): number {
  const cycle = Math.max(MIN_CYCLE, frames + Math.ceil(frames / FRAMES_PER_HEADER));
  return cycle / link.fps;
}

/**
 * Passes until the last of `missing` blocks arrives. Each pass catches each one
 * with chance `capture`, so this is the longest of `missing` geometric waits.
 * It's why a plain loop slows down at the end: the last few blocks set the time.
 */
function passesFor(missing: number, capture: number): number {
  if (missing <= 0) return 0;
  return (Math.log(missing) + EULER_GAMMA) / -Math.log(1 - capture);
}

/** How long a whole transfer of `frames` should take. */
export function estimateFrames(frames: number, link: Link): TimeRange {
  if (frames === 0) return { low: 0, high: 0 };
  const pass = passSeconds(frames, link);
  return {
    low: pass * Math.max(1, passesFor(frames, CAPTURE.best)),
    high: pass * Math.max(1, passesFor(frames, CAPTURE.worst)),
  };
}

export interface Plan {
  frames: number;
  /** Whether to compress. Skipping it saves time on files that won't shrink. */
  compress: boolean;
  time: TimeRange;
}

/** Up to four slices from across the file, as compressing all of it takes too long to do up front. */
function sampleOf(bytes: Uint8Array): Uint8Array {
  if (bytes.length <= SAMPLE_BYTES * SAMPLES) return bytes;
  const sample = new Uint8Array(SAMPLE_BYTES * SAMPLES);
  const stride = Math.floor((bytes.length - SAMPLE_BYTES) / (SAMPLES - 1));
  for (let i = 0; i < SAMPLES; i++) {
    sample.set(bytes.subarray(i * stride, i * stride + SAMPLE_BYTES), i * SAMPLE_BYTES);
  }
  return sample;
}

/**
 * Works out what sending `bytes` will take. The result depends only on the
 * bytes, so sending the same file later gives the same session and can resume.
 */
export function planTransfer(bytes: Uint8Array, link: Link): Plan {
  const plainFrames = Math.ceil(bytes.length / link.blockBytes);
  const sample = sampleOf(bytes);
  const maxFrameBytes = link.blockBytes + DATA_OVERHEAD;
  const options = { maxFrameBytes, mime: 'a/b', kind: 'sample' };
  const packed = new Encoder(sample, options).frameCount;
  const plain = Math.ceil(sample.length / link.blockBytes);
  const ratio = plain === 0 ? 1 : packed / plain;
  const compress = ratio < WORTHWHILE_RATIO;
  const frames = compress ? Math.ceil(plainFrames * ratio) : plainFrames;
  return { frames, compress, time: estimateFrames(frames, link) };
}

/**
 * Estimates the time left on the receiver, from how this sitting has gone so
 * far. It counts time spent off target, so a shaky hand shows up in the number.
 */
export class SittingClock {
  private startedAt = 0;
  private startMissing = 0;

  /** Call this when scanning starts or resumes. */
  start(now: number, missing: number): void {
    this.startedAt = now;
    this.startMissing = missing;
  }

  /** The share of blocks being caught on each pass. */
  captureRate(now: number, missing: number, pass: number): number {
    const seconds = (now - this.startedAt) / 1000;
    if (seconds < MIN_MEASURED_SECONDS || missing >= this.startMissing) return CAPTURE.likely;
    const left = missing / this.startMissing;
    // Blocks fall steadily during the first pass, then by a constant share each pass.
    const rate = seconds < pass ? ((1 - left) * pass) / seconds : 1 - left ** (pass / seconds);
    return Math.min(0.97, Math.max(0.3, rate));
  }

  secondsLeft(now: number, missing: number, total: number, link: Link): number {
    const pass = passSeconds(total, link);
    return pass * passesFor(missing, this.captureRate(now, missing, pass));
  }
}

function round(seconds: number): number {
  if (seconds < 60) return Math.max(5, Math.ceil(seconds / 5) * 5);
  if (seconds < 3600) return Math.ceil(seconds / 60) * 60;
  return Math.ceil(seconds / 600) * 600;
}

export function formatDuration(seconds: number): string {
  const rounded = round(seconds);
  if (rounded < 60) return `${rounded} sec`;
  if (rounded < 3600) return `${rounded / 60} min`;
  const hours = Math.floor(rounded / 3600);
  const minutes = (rounded % 3600) / 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

export function formatRange({ low, high }: TimeRange): string {
  if (high <= 5) return 'a few seconds';
  const from = formatDuration(low);
  const to = formatDuration(high);
  return from === to ? `about ${to}` : `${from} to ${to}`;
}

export type Effort = 'quick' | 'steady' | 'sore-arm' | 'marathon';

const STEADY_SECONDS = 20;
const SORE_ARM_SECONDS = 2 * 60;
const MARATHON_SECONDS = 15 * 60;

export function effortOf({ high }: TimeRange): Effort {
  if (high < STEADY_SECONDS) return 'quick';
  if (high < SORE_ARM_SECONDS) return 'steady';
  return high < MARATHON_SECONDS ? 'sore-arm' : 'marathon';
}

export const EFFORT_ADVICE: Readonly<Record<Effort, string>> = {
  quick: 'Hold the phones steady, and it will be over before you know it.',
  steady: 'Hold the phones steady, with the whole code in view.',
  'sore-arm': "That's long enough for a sore arm. Prop the phones up before you start.",
  marathon:
    'This is a long one. Prop both phones up where they can stay put, and plug them in. You can pause and pick it up later.',
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
