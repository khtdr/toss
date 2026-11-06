import type { ErrorCorrection } from 'toss-qr';

export type Renderer = 'svg' | 'skia';
export type Mask = 'best' | 'fixed';

export interface RunConfig {
  version: number;
  errorCorrection: ErrorCorrection;
  fps: number;
  payloadBytes: number;
  renderer: Renderer;
  mask: Mask;
}

/**
 * Shown as a still symbol to test what a scanner does to text. It has outer and
 * repeated spaces, and every other character base45 can produce.
 */
export const CHECK_TEXT = '  0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ  $%*+-./:  ';

const KIND = /^spike-v(\d+)-([LMQH])-(\d+)fps-(svg|skia)(-fixed)?$/;

/** Sent as the transfer's `kind`, so a receiver needs no settings of its own. */
export function runKind({ version, errorCorrection, fps, renderer, mask }: RunConfig): string {
  const suffix = mask === 'fixed' ? '-fixed' : '';
  return `spike-v${version}-${errorCorrection}-${fps}fps-${renderer}${suffix}`;
}

export function parseKind(kind: string): Omit<RunConfig, 'payloadBytes'> | undefined {
  const match = KIND.exec(kind);
  if (!match) return undefined;
  const [, version, errorCorrection, fps, renderer, fixed] = match;
  return {
    version: Number(version),
    errorCorrection: errorCorrection as ErrorCorrection,
    fps: Number(fps),
    renderer: renderer as Renderer,
    mask: fixed ? 'fixed' : 'best',
  };
}

/** Deterministic bytes that won't compress, so frame counts are predictable. */
export function testPayload(length: number): Uint8Array {
  let state = 0x70737304;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    bytes[i] = (t ^ (t >>> 14)) & 0xff;
  }
  return bytes;
}
