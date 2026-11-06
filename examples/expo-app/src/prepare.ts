import { Encoder } from 'toss-core';
import { QUIET_ZONE_MODULES, frameToText, maxFrameBytes, textToMatrix } from 'toss-qr';
import type { QrMatrix } from 'toss-qr';
import { runKind, testPayload } from './run';
import type { RunConfig } from './run';

export interface Prepared {
  /** One SVG path per slot in the cycle, in module units. */
  paths: string[];
  /** Modules per side, quiet zone included. */
  modules: number;
  frameBytes: number;
  frameCount: number;
  /** Time in `textToMatrix` and path building, per symbol and in total. */
  drawMs: { mean: number; max: number; total: number };
}

/** One rectangle per horizontal run of dark modules, offset by the quiet zone. */
export function matrixToPath({ size, modules }: QrMatrix): string {
  let path = '';
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!modules[row * size + col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && modules[row * size + col]) col++;
      const x = start + QUIET_ZONE_MODULES;
      const y = row + QUIET_ZONE_MODULES;
      path += `M${x} ${y}h${col - start}v1h-${col - start}z`;
    }
  }
  return path;
}

export function encoderFor(config: RunConfig): Encoder {
  return new Encoder(testPayload(config.payloadBytes), {
    maxFrameBytes: maxFrameBytes(config),
    mime: 'application/octet-stream',
    kind: runKind(config),
    compress: false,
  });
}

/** Draws the cycle once, yielding so the screen can show progress. */
export async function prepare(
  config: RunConfig,
  onProgress: (done: number, total: number) => void,
  now: () => number,
): Promise<Prepared> {
  const encoder = encoderFor(config);
  const paths: string[] = [];
  let total = 0;
  let max = 0;
  let size = 0;

  for (let t = 0; t < encoder.cycleLength; t++) {
    const start = now();
    const matrix = textToMatrix(frameToText(encoder.frameAt(t)), config);
    paths.push(matrixToPath(matrix));
    const elapsed = now() - start;
    total += elapsed;
    max = Math.max(max, elapsed);
    size = matrix.size;
    if (t % 8 === 7) {
      onProgress(t + 1, encoder.cycleLength);
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  return {
    paths,
    modules: size + 2 * QUIET_ZONE_MODULES,
    frameBytes: maxFrameBytes(config),
    frameCount: encoder.frameCount,
    drawMs: { mean: total / paths.length, max, total },
  };
}
