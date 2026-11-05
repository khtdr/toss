import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Encoder } from 'toss-core';
import { USAGE, main } from '../src/cli.js';
import { frameToPng } from '../src/qr-png.js';
import { noise, tamper } from './helpers.js';

let root: string;
let input: string;
let frames: string;
let output: string;
const payload = noise(900);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toss-cli-'));
  input = join(root, 'in.bin');
  frames = join(root, 'frames');
  output = join(root, 'out.bin');
  await writeFile(input, payload);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const encodeSmall = () => run('encode', input, '-o', frames, '--frame-bytes', '200', '--scale', '3');

describe('toss encode and decode', () => {
  it('round-trips a file', async () => {
    const encoded = await encodeSmall();
    expect(encoded).toMatchObject({ code: 0, err: '' });
    expect(encoded.out).toContain(`to ${frames}`);

    const decoded = await run('decode', frames, '-o', output);
    expect(decoded).toMatchObject({ code: 0, err: '' });
    expect(new Uint8Array(await readFile(output))).toEqual(payload);
  });

  it('accepts individual files as well as directories', async () => {
    await encodeSmall();
    const images = (await readdir(frames)).map((name) => join(frames, name));
    expect((await run('decode', ...images, '-o', output)).code).toBe(0);
    expect(new Uint8Array(await readFile(output))).toEqual(payload);
  });

  it('passes mime and kind through', async () => {
    await run('encode', input, '-o', frames, '--mime', 'text/plain', '--kind', 'note');
    const { out } = await run('decode', frames, '-o', output);
    expect(out).toContain('text/plain, kind note');
  });

  it('exits 1 and writes nothing when frames are missing', async () => {
    await encodeSmall();
    const [, ...rest] = (await readdir(frames)).map((name) => join(frames, name));
    const kept = rest.slice(0, 2);
    const { code, err } = await run('decode', ...kept, '-o', output);
    expect(code).toBe(1);
    expect(err).toContain('incomplete');
    await expect(readFile(output)).rejects.toThrow();
  });

  it('honours --no-compress', async () => {
    await writeFile(input, 'a'.repeat(2000));
    const compressed = await run('encode', input, '-o', frames);
    const plain = await run('encode', input, '-o', join(root, 'plain'), '--no-compress');
    expect(compressed.out).toContain(', compressed');
    expect(plain.out).toContain('uncompressed');
  });

  it('exits 1 and writes nothing when the payload fails its hash', async () => {
    await mkdir(frames);
    const render = { version: 10, errorCorrection: 'M', scale: 3 } as const;
    const encoder = new Encoder(payload, {
      maxFrameBytes: 200,
      mime: 'application/octet-stream',
      kind: 'file',
      compress: false,
    });
    for (let t = 0; t < encoder.cycleLength; t++) {
      const frame = encoder.frameAt(t);
      const bad = frame[0] === 0x10 ? frame : tamper(frame);
      await writeFile(join(frames, `${t}.png`), frameToPng(bad, render));
    }
    const { code, err } = await run('decode', frames, '-o', output);
    expect(code).toBe(1);
    expect(err).toContain('hash-mismatch');
    await expect(readFile(output)).rejects.toThrow();
  });

  it('reports what it skipped', async () => {
    await encodeSmall();
    await writeFile(join(frames, 'zzz.png'), 'junk');
    const [first] = await readdir(frames);
    const { code, err } = await run('decode', join(frames, 'zzz.png'), join(frames, first!), '-o', output);
    expect(code).toBe(1);
    expect(err).toContain('skipped 1: not a PNG');
  });

  it('will not replace an output file by default', async () => {
    await encodeSmall();
    await writeFile(output, 'keep me');
    const { code, err } = await run('decode', frames, '-o', output);
    expect(code).toBe(1);
    expect(err).toContain('--force');
    expect(await readFile(output, 'utf8')).toBe('keep me');
  });

  it('replaces an output file with --force', async () => {
    await encodeSmall();
    await writeFile(output, 'old');
    expect((await run('decode', frames, '--force', '-o', output)).code).toBe(0);
    expect(new Uint8Array(await readFile(output))).toEqual(payload);
  });

  it('reports a missing input without a stack trace', async () => {
    const { code, err } = await run('encode', join(root, 'nope'), '-o', frames);
    expect(code).toBe(1);
    expect(err).toContain('ENOENT');
    expect(err).not.toContain(' at ');
  });

  it('reports a bad label from the encoder', async () => {
    const { code, err } = await run('encode', input, '-o', frames, '--kind', 'café');
    expect(code).toBe(1);
    expect(err).toContain('printable ASCII');
  });

  it('accepts the largest frame for an EC level', async () => {
    const big = await run('encode', input, '-o', frames, '--ec', 'H', '--frame-bytes', '1234');
    expect(big.code).toBe(0);
    expect(big.out).toContain('QR version 40, level H');
  });

  it('picks the smallest QR version that holds the frame size', async () => {
    const { out } = await run('encode', input, '-o', frames, '--scale', '3');
    expect(out).toContain('QR version 22, level M, frames up to 700 bytes');
  });

  it('sizes frames to fill a chosen QR version', async () => {
    const { code, out } = await run('encode', input, '-o', frames, '--qr-version', '10', '--ec', 'Q');
    expect(code).toBe(0);
    expect(out).toContain('QR version 10, level Q, frames up to 146 bytes');
    const decoded = await run('decode', frames, '-o', output);
    expect(decoded.code).toBe(0);
    expect(await readFile(output)).toEqual(Buffer.from(payload));
  });

  it('reports a QR version too small for the header', async () => {
    const { code, err } = await run('encode', input, '-o', frames, '--qr-version', '1', '--ec', 'H');
    expect(code).toBe(1);
    expect(err).toContain('maxFrameBytes');
  });
});

describe('usage', () => {
  it('prints help', async () => {
    expect(await run('--help')).toEqual({ code: 0, out: USAGE, err: '' });
  });

  it.each([
    ['no command', []],
    ['an unknown command', ['fling']],
    ['an unknown flag', ['encode', 'a', '-o', 'b', '--nope']],
    ['encode without a file', ['encode', '-o', 'b']],
    ['encode with two files', ['encode', 'a', 'b', '-o', 'c']],
    ['encode without -o', ['encode', 'a']],
    ['decode without inputs', ['decode', '-o', 'b']],
    ['decode without -o', ['decode', 'a']],
    ['a bad EC level', ['encode', 'a', '-o', 'b', '--ec', 'X']],
    ['a prototype key as EC level', ['encode', 'a', '-o', 'b', '--ec', 'toString']],
    ['a non-numeric size', ['encode', 'a', '-o', 'b', '--frame-bytes', '12x']],
    ['a frame below the minimum', ['encode', 'a', '-o', 'b', '--frame-bytes', '4']],
    ['a frame beyond QR capacity', ['encode', 'a', '-o', 'b', '--ec', 'H', '--frame-bytes', '1235']],
    ['a QR version of zero', ['encode', 'a', '-o', 'b', '--qr-version', '0']],
    ['a QR version past 40', ['encode', 'a', '-o', 'b', '--qr-version', '41']],
    ['both frame size flags', ['encode', 'a', '-o', 'b', '--frame-bytes', '200', '--qr-version', '9']],
    ['zero loops', ['encode', 'a', '-o', 'b', '--loops', '0']],
    ['zero scale', ['encode', 'a', '-o', 'b', '--scale', '0']],
  ])('exits 2 for %s', async (_, argv) => {
    const { code, err } = await run(...argv);
    expect(code).toBe(2);
    expect(err).toContain('Usage:');
  });
});
