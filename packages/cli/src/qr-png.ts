import jsQRModule from 'jsqr';
import pngjs from 'pngjs';
import { QUIET_ZONE_MODULES, frameToText, textToFrame, textToMatrix } from 'toss-qr';
import type { QrConfig, QrMatrix } from 'toss-qr';

const { PNG } = pngjs;
// The types describe an ES default export, but at runtime this is the function.
const jsQR = jsQRModule as unknown as typeof jsQRModule.default;

/** Callers refuse larger files before reading them. */
export const MAX_PNG_BYTES = 32 * 1024 * 1024;
/** Refuse larger images before decoding them: about 64 MiB of RGBA. */
export const MAX_PNG_PIXELS = 4096 * 4096;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = 0x49484452;

export interface RenderOptions extends QrConfig {
  /** Pixels per QR module. */
  scale: number;
}

export type ScanResult =
  | { status: 'frame'; frame: Uint8Array }
  | { status: 'no-qr' }
  | { status: 'unreadable'; reason: string };

/** Draws a QR symbol with its quiet zone. */
export function matrixToPng({ size, modules }: QrMatrix, scale: number): Buffer {
  const width = (size + 2 * QUIET_ZONE_MODULES) * scale;
  const png = new PNG({ width, height: width });
  png.data.fill(0xff);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (modules[row * size + col]) paintModule(png, row, col, scale);
    }
  }
  return PNG.sync.write(png, { colorType: 0 });
}

/** Draws one frame as a QR symbol of the given version. */
export function frameToPng(frame: Uint8Array, options: RenderOptions): Buffer {
  return matrixToPng(textToMatrix(frameToText(frame), options), options.scale);
}

function paintModule(png: InstanceType<typeof PNG>, row: number, col: number, scale: number): void {
  const top = (row + QUIET_ZONE_MODULES) * scale;
  const left = (col + QUIET_ZONE_MODULES) * scale;
  for (let y = top; y < top + scale; y++) {
    for (let x = left; x < left + scale; x++) {
      const pixel = (y * png.width + x) * 4;
      png.data[pixel] = png.data[pixel + 1] = png.data[pixel + 2] = 0;
    }
  }
}

/**
 * Finds the reason a PNG is too risky to hand to the decoder, if any.
 *
 * This walks every chunk, even past IEND, because pngjs sizes its buffers from
 * the last IHDR it sees: a tiny file with a second, huge IHDR would otherwise
 * allocate gigabytes.
 */
function rejectPng(png: Uint8Array): string | undefined {
  if (!SIGNATURE.every((byte, i) => png[i] === byte)) return 'not a PNG';

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let headers = 0;
  for (let offset = 8; offset + 12 <= png.length; offset += 12 + view.getUint32(offset)) {
    const type = view.getUint32(offset + 4);
    if (type !== IHDR) continue;
    if (++headers > 1) return 'more than one IHDR chunk';
    if (offset + 16 > png.length) return 'truncated IHDR chunk';
    if (view.getUint32(offset + 8) * view.getUint32(offset + 12) > MAX_PNG_PIXELS) {
      return 'image is too large';
    }
  }
  return undefined;
}

/** Reads the frame from a PNG. The file is untrusted and may be anything. */
export function scanPng(bytes: Uint8Array): ScanResult {
  const rejected = rejectPng(bytes);
  if (rejected !== undefined) return { status: 'unreadable', reason: rejected };

  let image: { width: number; height: number; data: Buffer };
  try {
    image = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (error) {
    return { status: 'unreadable', reason: error instanceof Error ? error.message : 'bad PNG' };
  }

  const pixels = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length);
  const code = jsQR(pixels, image.width, image.height);
  if (!code) return { status: 'no-qr' };

  const read = textToFrame(code.data);
  return read.ok ? { status: 'frame', frame: read.frame } : { status: 'unreadable', reason: read.reason };
}
