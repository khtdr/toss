import { mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Encoder } from 'toss-core';
import { MAX_PNG_BYTES, frameToPng, scanPng } from '../src/qr-png.js';
import { decodeImages, encodeFile, listImages, writePayload } from '../src/transfer.js';
import type { EncodeOptions } from '../src/transfer.js';
import { noise, seeded, shuffled, tamper } from './helpers.js';

const HEADER_TAG = 0x10;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toss-cli-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const defaults: EncodeOptions = {
  maxFrameBytes: 200,
  errorCorrection: 'M',
  scale: 3,
  mime: 'application/octet-stream',
  kind: 'test',
  compress: true,
  loops: 1,
};

async function encoded(payload: Uint8Array, options: Partial<EncodeOptions> = {}, name = 'frames') {
  const input = join(root, `${name}.bin`);
  await writeFile(input, payload);
  const dir = join(root, name);
  const summary = await encodeFile(input, dir, { ...defaults, ...options });
  return { dir, summary, images: await listImages([dir]) };
}

async function dataImages(images: string[]): Promise<string[]> {
  const data: string[] = [];
  for (const image of images) {
    const scan = scanPng(await readFile(image));
    if (scan.status === 'frame' && scan.frame[0] !== HEADER_TAG) data.push(image);
  }
  return data;
}

describe('round trip through PNG files', () => {
  it.each([
    ['one byte', 1],
    ['one block', 100],
    ['fewer than eight blocks', 800],
    ['many blocks', 3000],
  ])('recovers %s', async (_, length) => {
    const payload = noise(length);
    const { images } = await encoded(payload);
    const result = await decodeImages(images);
    expect(result.status).toBe('done');
    expect(result.payload).toEqual(payload);
  });

  it('recovers an empty file', async () => {
    const { images, summary } = await encoded(new Uint8Array());
    expect(summary.frameCount).toBe(0);
    const result = await decodeImages(images);
    expect(result.status).toBe('done');
    expect(result.payload).toEqual(new Uint8Array());
  });

  it('compresses text and restores it exactly', async () => {
    const payload = new TextEncoder().encode('{"theme":"dark"}\n'.repeat(400));
    const { images, summary } = await encoded(payload);
    expect(summary.compressed).toBe(true);
    expect((await decodeImages(images)).payload).toEqual(payload);
  });

  it('skips compression when asked', async () => {
    const payload = new Uint8Array(500);
    const { images, summary } = await encoded(payload, { compress: false });
    expect(summary.compressed).toBe(false);
    expect((await decodeImages(images)).payload).toEqual(payload);
  });

  it('carries mime and kind', async () => {
    const { images } = await encoded(noise(50), { mime: 'application/json', kind: 'theme' });
    const { meta } = await decodeImages(images);
    expect(meta).toMatchObject({ mime: 'application/json', kind: 'theme', payloadSize: 50 });
  });

  it('writes one image per cycle position, per loop', async () => {
    const { summary, images } = await encoded(noise(1500), { loops: 2 });
    expect(summary.images).toBe(summary.cycleLength * 2);
    expect(images).toHaveLength(summary.images);
  });

  it('names frames so a sort gives display order', async () => {
    const { dir } = await encoded(noise(1500));
    const names = await readdir(dir);
    expect(names).toEqual([...names].sort());
    expect(names[0]).toBe('frame-0000.png');
  });
});

describe('a bad channel', () => {
  const payload = noise(2500);

  it('tolerates any order', async () => {
    const { images } = await encoded(payload);
    for (const seed of [1, 2, 3]) {
      expect((await decodeImages(shuffled(images, seed))).payload).toEqual(payload);
    }
  });

  it('tolerates duplicates', async () => {
    const { images } = await encoded(payload);
    const doubled = images.flatMap((image) => [image, image]);
    expect((await decodeImages(doubled)).payload).toEqual(payload);
  });

  it('tolerates joining at every point in the loop', async () => {
    const { images, summary } = await encoded(payload, { loops: 2 });
    for (let start = 0; start < summary.cycleLength; start += 3) {
      const joined = images.slice(start, start + summary.cycleLength);
      expect((await decodeImages(joined)).payload).toEqual(payload);
    }
  });

  it('tolerates heavy loss given enough loops', async () => {
    const { images } = await encoded(payload, { loops: 5 });
    const random = seeded(7);
    const survivors = images.filter(() => random() > 0.4);
    expect(survivors.length).toBeLessThan(images.length);
    const result = await decodeImages(survivors);
    expect(result.status).toBe('done');
    expect(result.payload).toEqual(payload);
  });

  it('reports a missing block as incomplete, not as success', async () => {
    const { images, summary } = await encoded(payload);
    const data = await dataImages(images);
    const kept = images.filter((image) => image !== data[0]);
    const result = await decodeImages(kept);
    expect(result.status).toBe('incomplete');
    expect(result.payload).toBeUndefined();
    expect(result.progress).toEqual({ received: summary.frameCount - 1, total: summary.frameCount });
  });

  it('never finishes without a header', async () => {
    const { images, summary } = await encoded(payload);
    const data = await dataImages(images);
    const result = await decodeImages(data);
    expect(result.status).toBe('incomplete');
    expect(result.progress.total).toBeNull();
    expect(data).toHaveLength(summary.frameCount);
  });

  it('skips junk images and keeps going', async () => {
    const { images } = await encoded(payload);
    const junk = join(root, 'junk.png');
    await writeFile(junk, 'not a png');
    const mixed = images.flatMap((image) => [junk, image]);
    const result = await decodeImages(mixed);
    expect(result.payload).toEqual(payload);
    expect(result.skipped['not a PNG']).toBeGreaterThan(0);
  });

  it('counts a QR code that holds no valid frame', async () => {
    const { images } = await encoded(payload);
    const stranger = join(root, 'stranger.png');
    const frame = noise(60);
    frame[0] = 0x11; // a data frame by its tag, so only the CRC can reject it
    await writeFile(stranger, frameToPng(frame, defaults));
    const result = await decodeImages([stranger, ...images]);
    expect(result.payload).toEqual(payload);
    expect(result.skipped['bad-crc']).toBe(1);
  });

  it('skips an oversized file without reading it', async () => {
    const { images } = await encoded(payload);
    const huge = join(root, 'huge.png');
    await writeFile(huge, '');
    await truncate(huge, MAX_PNG_BYTES + 1);
    const result = await decodeImages([huge, ...images]);
    expect(result.payload).toEqual(payload);
    expect(result.skipped['file is too large']).toBe(1);
  });

  it('fails, rather than delivering, when a resealed frame breaks the hash', async () => {
    const dir = join(root, 'tampered');
    await mkdir(dir);
    const encoder = new Encoder(noise(400), { ...defaults, compress: false });
    for (let t = 0; t < encoder.cycleLength; t++) {
      const frame = encoder.frameAt(t);
      const bad = frame[0] === HEADER_TAG ? frame : tamper(frame);
      await writeFile(join(dir, `${t}.png`), frameToPng(bad, defaults));
    }
    const result = await decodeImages(await listImages([dir]));
    expect(result.status).toBe('failed');
    expect(result.error).toBe('hash-mismatch');
    expect(result.payload).toBeUndefined();
  });

  it('keeps two senders apart', async () => {
    const first = await encoded(payload, {}, 'first');
    const second = await encoded(noise(2500, 99), {}, 'second');
    const mixed = first.images.flatMap((image, i) => {
      const other = second.images[i];
      return other ? [image, other] : [image];
    });
    const result = await decodeImages(mixed);
    expect(result.payload).toEqual(payload);
    expect(result.otherSessionFrames).toBeGreaterThan(0);
  });

  it('stops reading once the transfer is done', async () => {
    const { images, summary } = await encoded(payload, { loops: 3 });
    const result = await decodeImages(images);
    expect(result.scanned).toBeLessThanOrEqual(summary.cycleLength + 1);
  });
});

describe('output safety', () => {
  it('refuses to mix runs in one directory', async () => {
    const { dir } = await encoded(noise(300));
    const input = join(root, 'again.bin');
    await writeFile(input, noise(300, 2));
    await expect(encodeFile(input, dir, defaults)).rejects.toThrow('already contains frames');
  });

  it('allows a directory with unrelated files', async () => {
    const dir = join(root, 'shared');
    const input = join(root, 'in.bin');
    await writeFile(input, noise(10));
    await encodeFile(input, join(dir, 'nested'), defaults);
    await writeFile(join(dir, 'notes.txt'), 'hello');
    await expect(encodeFile(input, dir, defaults)).resolves.toBeDefined();
  });

  it('refuses to replace a file in the last step, too', async () => {
    const path = join(root, 'taken');
    await writeFile(path, 'keep me');
    await expect(writePayload(path, noise(4), false)).rejects.toThrow('EEXIST');
    expect(await readFile(path, 'utf8')).toBe('keep me');
    await writePayload(path, noise(4), true);
    expect(new Uint8Array(await readFile(path))).toEqual(noise(4));
  });

  it('lists a directory in sorted order, whatever order the files were made', async () => {
    const dir = join(root, 'order');
    await mkdir(dir);
    const names = ['c.png', 'a.png', 'e.png', 'b.png', 'd.png'];
    for (const name of names) await writeFile(join(dir, name), '');
    const listed = await listImages([dir]);
    expect(listed).toEqual([...names].sort().map((name) => join(dir, name)));
  });

  it('lists only PNGs from a directory, and passes files through', async () => {
    const dir = join(root, 'mixed');
    const { images } = await encoded(noise(10), {}, 'mixed');
    await writeFile(join(dir, 'notes.txt'), 'hello');
    const loose = join(root, 'loose.dat');
    await writeFile(loose, 'x');
    expect(await listImages([dir, loose])).toEqual([...images, loose]);
  });
});
