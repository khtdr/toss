import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { MIN_FRAME_BYTES } from 'toss-core';
import { MAX_VERSION, MIN_VERSION, isErrorCorrection, maxFrameBytes, smallestVersion } from 'toss-qr';
import type { ErrorCorrection } from 'toss-qr';
import { decodeImages, encodeFile, listImages, writePayload } from './transfer.js';

export const USAGE = `Usage:
  toss encode <file> -o <dir> [options]    Write a file as QR PNG frames
  toss decode <png|dir>... -o <file>       Rebuild a file from QR PNG frames

Encode options:
  --frame-bytes <n>   Largest frame, in bytes (default 700)
  --qr-version <n>    Fill this QR version (1-40), instead of --frame-bytes
  --ec <L|M|Q|H>      QR error correction (default M)
  --scale <n>         Pixels per QR module (default 4)
  --loops <n>         Full cycles to write (default 1)
  --mime <type>       Payload mime type (default application/octet-stream)
  --kind <label>      App-defined label (default file)
  --no-compress       Send the file as it is

Decode options:
  --force             Replace the output file if it exists
`;

const OPTIONS = {
  output: { type: 'string', short: 'o' },
  'frame-bytes': { type: 'string' },
  'qr-version': { type: 'string' },
  ec: { type: 'string', default: 'M' },
  scale: { type: 'string', default: '4' },
  loops: { type: 'string', default: '1' },
  mime: { type: 'string', default: 'application/octet-stream' },
  kind: { type: 'string', default: 'file' },
  'no-compress': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

export interface Output {
  out(line: string): void;
  err(line: string): void;
}

/** A mistake in how the command was called. */
class UsageError extends Error {}

function positiveInt(name: string, value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new UsageError(`--${name} must be a positive integer`);
  return Number(value);
}

function errorCorrection(value: string): ErrorCorrection {
  if (isErrorCorrection(value)) return value;
  throw new UsageError('--ec must be one of L, M, Q, H');
}

/** Every frame in a transfer uses one version, so the symbol never changes size. */
function symbolSize(values: Values, ec: ErrorCorrection) {
  const frameBytes = values['frame-bytes'];
  const qrVersion = values['qr-version'];

  if (qrVersion !== undefined) {
    if (frameBytes !== undefined) throw new UsageError('use --frame-bytes or --qr-version, not both');
    const version = positiveInt('qr-version', qrVersion);
    if (version > MAX_VERSION) {
      throw new UsageError(`--qr-version must be from ${MIN_VERSION} to ${MAX_VERSION}`);
    }
    return { version, maxFrameBytes: maxFrameBytes({ version, errorCorrection: ec }) };
  }

  const size = positiveInt('frame-bytes', frameBytes ?? '700');
  const largest = maxFrameBytes({ version: MAX_VERSION, errorCorrection: ec });
  if (size < MIN_FRAME_BYTES || size > largest) {
    throw new UsageError(`--frame-bytes must be from ${MIN_FRAME_BYTES} to ${largest} at --ec ${ec}`);
  }
  return { version: smallestVersion(size, ec), maxFrameBytes: size };
}

function hex(sessionId: number): string {
  return sessionId.toString(16).padStart(8, '0');
}

type Values = ReturnType<typeof parseCommand>['values'];

function parseCommand(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
}

async function encode(paths: string[], values: Values, io: Output): Promise<number> {
  const [input, ...extra] = paths;
  if (input === undefined || extra.length > 0) throw new UsageError('encode takes one file');
  if (values.output === undefined) throw new UsageError('encode needs -o <dir>');

  const ec = errorCorrection(values.ec);
  const size = symbolSize(values, ec);

  const summary = await encodeFile(input, values.output, {
    ...size,
    errorCorrection: ec,
    scale: positiveInt('scale', values.scale),
    loops: positiveInt('loops', values.loops),
    mime: values.mime,
    kind: values.kind,
    compress: !values['no-compress'],
  });
  io.out(
    `session ${hex(summary.sessionId)}: ${summary.frameCount} data frames, ` +
      `${summary.cycleLength} per cycle, ${summary.compressed ? 'compressed' : 'uncompressed'}`,
  );
  io.out(`QR version ${size.version}, level ${ec}, frames up to ${size.maxFrameBytes} bytes`);
  io.out(`wrote ${summary.images} images to ${values.output}`);
  return 0;
}

async function decode(paths: string[], values: Values, io: Output): Promise<number> {
  if (paths.length === 0) throw new UsageError('decode needs at least one PNG or directory');
  const output = values.output;
  if (output === undefined) throw new UsageError('decode needs -o <file>');
  if (!values.force && existsSync(output)) {
    throw new Error(`${output} already exists; use --force to replace it`);
  }

  const summary = await decodeImages(await listImages(paths));

  for (const [reason, count] of Object.entries(summary.skipped)) {
    io.err(`skipped ${count}: ${reason}`);
  }
  if (summary.otherSessionFrames > 0) {
    io.err(`ignored ${summary.otherSessionFrames} frames from other sessions`);
  }
  if (summary.status === 'failed') {
    io.err(`transfer failed: ${summary.error}`);
    return 1;
  }
  if (summary.status === 'incomplete') {
    const { received, total } = summary.progress;
    io.err(`incomplete: ${received} of ${total ?? 'unknown'} blocks from ${summary.scanned} images`);
    return 1;
  }

  await writePayload(output, summary.payload!, values.force);
  const meta = summary.meta!;
  io.out(`session ${hex(meta.sessionId)}: ${meta.mime}, kind ${meta.kind}`);
  io.out(`wrote ${meta.payloadSize} bytes to ${output} from ${summary.scanned} images`);
  return 0;
}

/** Runs the CLI and returns its exit code: 0 done, 1 failed, 2 bad usage. */
export async function main(argv: string[], io: Output): Promise<number> {
  try {
    const { values, positionals } = parseCommand(argv);
    const [command, ...paths] = positionals;
    if (values.help) {
      io.out(USAGE);
      return 0;
    }
    if (command === 'encode') return await encode(paths, values, io);
    if (command === 'decode') return await decode(paths, values, io);
    throw new UsageError(command ? `unknown command: ${command}` : 'missing command');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const usage =
      error instanceof UsageError ||
      (error as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS');
    io.err(`toss: ${message}`);
    if (usage) io.err(USAGE);
    return usage ? 2 : 1;
  }
}
