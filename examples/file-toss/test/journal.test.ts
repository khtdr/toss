import { Encoder } from 'toss-core';
import { frameToText } from 'toss-qr';
import { ReceiveSession } from '../../../packages/react-native/src/receive-session';
import { describe, expect, it } from 'vitest';
import { FrameJournal, packFrames, unpackFrames } from '../src/lib/journal';
import type { JournalFiles } from '../src/lib/journal';

function memoryFiles() {
  const logs = new Map<string, Uint8Array>();
  const files: JournalFiles & { failing: boolean; appends: number } = {
    failing: false,
    appends: 0,
    read: async (session) => logs.get(session) ?? null,
    append: async (session, bytes) => {
      if (files.failing) throw new Error('disk full');
      files.appends++;
      const old = logs.get(session) ?? new Uint8Array(0);
      const joined = new Uint8Array(old.length + bytes.length);
      joined.set(old);
      joined.set(bytes, old.length);
      logs.set(session, joined);
    },
    remove: async (session) => {
      logs.delete(session);
    },
  };
  return { files, logs };
}

const frame = (...bytes: number[]) => Uint8Array.from(bytes);

describe('packing', () => {
  it('round-trips frames, including an empty one', () => {
    const frames = [frame(1, 2, 3), frame(), new Uint8Array(1400).fill(7)];
    expect(unpackFrames(packFrames(frames))).toEqual(frames);
  });

  it.each([1, 2, 3, 4])('loses only the last frame when %i bytes are cut off', (cut) => {
    const log = packFrames([frame(1, 2, 3), frame(4, 5, 6)]);
    expect(unpackFrames(log.subarray(0, log.length - cut))).toEqual([frame(1, 2, 3)]);
  });

  it('reads nothing from an empty log', () => {
    expect(unpackFrames(new Uint8Array(0))).toEqual([]);
  });

  it('survives a length that runs past the end', () => {
    expect(unpackFrames(frame(0xff, 0xff, 1, 2))).toEqual([]);
  });

  it('refuses a frame its length field cannot hold', () => {
    expect(() => packFrames([new Uint8Array(70_000)])).toThrow(RangeError);
  });
});

describe('FrameJournal', () => {
  it('holds frames until it knows the transfer', async () => {
    const { files, logs } = memoryFiles();
    const journal = new FrameJournal(files);
    journal.add(frame(1));
    await journal.flush();
    expect(logs.size).toBe(0);

    await journal.open('abc');
    await journal.flush();
    expect(unpackFrames(logs.get('abc')!)).toEqual([frame(1)]);
  });

  it('gives back what an earlier run kept', async () => {
    const { files } = memoryFiles();
    const first = new FrameJournal(files);
    await first.open('abc');
    first.add(frame(1));
    first.add(frame(2));
    await first.close();

    const second = new FrameJournal(files);
    expect(await second.open('abc')).toEqual([frame(1), frame(2)]);
    expect(await second.open('other')).toEqual([]);
  });

  it('adds to the log rather than replacing it', async () => {
    const { files } = memoryFiles();
    const first = new FrameJournal(files);
    await first.open('abc');
    first.add(frame(1));
    await first.close();

    const second = new FrameJournal(files);
    await second.open('abc');
    second.add(frame(2));
    await second.close();
    expect(await new FrameJournal(files).open('abc')).toEqual([frame(1), frame(2)]);
  });

  it('writes in batches, not per frame', async () => {
    const { files } = memoryFiles();
    const journal = new FrameJournal(files);
    await journal.open('abc');
    for (let i = 0; i < 31; i++) journal.add(frame(i));
    await journal.flush();
    expect(files.appends).toBe(1);
    await journal.flush();
    expect(files.appends).toBe(1);
  });

  it('keeps frames through a failed write, in order', async () => {
    const { files } = memoryFiles();
    const journal = new FrameJournal(files);
    await journal.open('abc');
    journal.add(frame(1));
    files.failing = true;
    await journal.flush();
    journal.add(frame(2));
    files.failing = false;
    await journal.close();
    expect(await new FrameJournal(files).open('abc')).toEqual([frame(1), frame(2)]);
  });

  it('removes the log on discard', async () => {
    const { files, logs } = memoryFiles();
    const journal = new FrameJournal(files);
    await journal.open('abc');
    journal.add(frame(1));
    await journal.flush();
    await journal.discard();
    expect(logs.size).toBe(0);
  });

  it("doesn't write a closed transfer's frames into the next one", async () => {
    const { files, logs } = memoryFiles();
    const journal = new FrameJournal(files);
    await journal.open('first');
    journal.add(frame(1));
    await journal.close();
    await journal.open('second');
    journal.add(frame(2));
    await journal.close();
    expect(unpackFrames(logs.get('first')!)).toEqual([frame(1)]);
    expect(unpackFrames(logs.get('second')!)).toEqual([frame(2)]);
  });

  it('carries a real transfer across a restart', async () => {
    const payload = new Uint8Array(3000).map((_, i) => (i * 31) & 0xff);
    const encoder = new Encoder(payload, { maxFrameBytes: 200, mime: 'a/b', kind: 'c', compress: false });
    const texts = Array.from({ length: encoder.cycleLength }, (_, t) => frameToText(encoder.frameAt(t)));
    const { files } = memoryFiles();

    const firstJournal = new FrameJournal(files);
    const first = new ReceiveSession({ onFrame: (f) => firstJournal.add(f) }, 0);
    await firstJournal.open('abc');
    texts.slice(0, 7).forEach((text, i) => first.scan(text, i));
    await firstJournal.close();

    const secondJournal = new FrameJournal(files);
    const second = new ReceiveSession({ onFrame: (f) => secondJournal.add(f) }, 0);
    second.restore(await secondJournal.open('abc'), 0);
    expect(second.getSnapshot().progress.received).toBe(first.getSnapshot().progress.received);
    texts.slice(7).forEach((text, i) => second.scan(text, i));
    expect(second.getSnapshot()).toMatchObject({ status: 'done', payload });
  });
});
