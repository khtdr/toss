import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Decoder, Encoder } from 'toss-core';
import type { DecodeError, Progress, TransferMeta } from 'toss-core';
import { MAX_PNG_BYTES, frameToPng, scanPng } from './qr-png.js';
import type { RenderOptions } from './qr-png.js';

export interface EncodeOptions extends RenderOptions {
  maxFrameBytes: number;
  mime: string;
  kind: string;
  compress: boolean;
  /** Full cycles to write. */
  loops: number;
}

export interface EncodeSummary {
  sessionId: number;
  frameCount: number;
  cycleLength: number;
  compressed: boolean;
  images: number;
}

export interface DecodeSummary {
  /** `incomplete` means the images ran out before the transfer finished. */
  status: 'done' | 'failed' | 'incomplete';
  scanned: number;
  /** Images that can't be read, have no QR code, or hold a rejected frame. */
  skipped: Record<string, number>;
  progress: Progress;
  otherSessionFrames: number;
  meta?: TransferMeta;
  payload?: Uint8Array;
  error?: DecodeError;
}

const FRAME_NAME = /^frame-\d+\.png$/;

/** Writes `input` to `dir` as numbered PNGs, in display order. */
export async function encodeFile(
  input: string,
  dir: string,
  options: EncodeOptions,
): Promise<EncodeSummary> {
  const { maxFrameBytes, mime, kind, compress, loops } = options;
  const encoder = new Encoder(await readFile(input), { maxFrameBytes, mime, kind, compress });

  await mkdir(dir, { recursive: true });
  // Leftovers from an earlier run would be read back as part of this transfer.
  if ((await readdir(dir)).some((name) => FRAME_NAME.test(name))) {
    throw new Error(`${dir} already contains frames`);
  }

  const images = encoder.cycleLength * loops;
  const digits = Math.max(4, String(images - 1).length);
  for (let t = 0; t < images; t++) {
    const name = `frame-${String(t).padStart(digits, '0')}.png`;
    await writeFile(join(dir, name), frameToPng(encoder.frameAt(t), options));
  }

  const { sessionId, frameCount, cycleLength, compressed } = encoder;
  return { sessionId, frameCount, cycleLength, compressed, images };
}

/** Expands directories into the PNGs inside them. Files pass through as given. */
export async function listImages(paths: string[]): Promise<string[]> {
  const images: string[] = [];
  for (const path of paths) {
    if ((await stat(path)).isDirectory()) {
      const names = (await readdir(path)).filter((name) => name.endsWith('.png')).sort();
      images.push(...names.map((name) => join(path, name)));
    } else {
      images.push(path);
    }
  }
  return images;
}

/** Feeds images to a decoder in the order given, stopping once it finishes. */
export async function decodeImages(images: string[]): Promise<DecodeSummary> {
  const decoder = new Decoder();
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  let progress: Progress = { received: 0, total: null };
  let otherSessionFrames = 0;
  let meta: TransferMeta | undefined;
  let scanned = 0;

  for (const image of images) {
    scanned++;
    if ((await stat(image)).size > MAX_PNG_BYTES) {
      skip('file is too large');
      continue;
    }
    const scan = scanPng(await readFile(image));
    if (scan.status === 'no-qr') skip('no QR code');
    if (scan.status === 'unreadable') skip(scan.reason);
    if (scan.status !== 'frame') continue;

    const result = decoder.push(scan.frame);
    if (result.outcome === 'rejected') skip(result.reason ?? 'rejected');
    ({ progress, otherSessionFrames, meta } = result);

    const base = { scanned, skipped, progress, otherSessionFrames, ...(meta && { meta }) };
    if (result.payload) return { ...base, status: 'done', payload: result.payload };
    if (result.error) return { ...base, status: 'failed', error: result.error };
  }

  return {
    status: 'incomplete',
    scanned,
    skipped,
    progress,
    otherSessionFrames,
    ...(meta && { meta }),
  };
}

/** Writes a decoded payload, refusing to replace a file unless told to. */
export async function writePayload(
  path: string,
  payload: Uint8Array,
  force: boolean,
): Promise<void> {
  await writeFile(path, payload, { flag: force ? 'w' : 'wx' });
}
