import { Encoder } from 'toss-core';
import { frameToText } from 'toss-qr';
import { describe, expect, it } from 'vitest';
import { ReceiveSession } from '../src/receive-session.js';
import { SendSession } from '../src/send-session.js';
import { chance, noise, scan } from './helpers.js';

const encoderOptions = { maxFrameBytes: 200, mime: 'application/json', kind: 'theme', compress: false };

function texts(payload: Uint8Array, count?: number): string[] {
  const encoder = new Encoder(payload, encoderOptions);
  return Array.from({ length: count ?? encoder.cycleLength }, (_, t) => frameToText(encoder.frameAt(t)));
}

function feed(session: ReceiveSession, frames: string[]) {
  frames.forEach((text, i) => session.scan(text, i));
  return session.getSnapshot();
}

describe('ReceiveSession', () => {
  it('starts out searching', () => {
    expect(new ReceiveSession({}, 0).getSnapshot()).toMatchObject({
      status: 'searching',
      progress: { received: 0, total: null },
    });
  });

  it('finishes a clean transfer', () => {
    const payload = noise(1500);
    const result = feed(new ReceiveSession({}, 0), texts(payload));
    expect(result.status).toBe('done');
    expect(result.payload).toEqual(payload);
    expect(result.meta).toMatchObject({ mime: 'application/json', kind: 'theme', payloadSize: 1500 });
  });

  it('survives reordering', () => {
    const payload = noise(1500);
    const result = feed(new ReceiveSession({}, 0), texts(payload).reverse());
    expect(result.payload).toEqual(payload);
  });

  it('survives joining mid-loop', () => {
    const payload = noise(1500);
    const all = texts(payload);
    const middle = Math.floor(all.length / 2);
    const session = new ReceiveSession({}, 0);
    expect(feed(session, all.slice(middle)).status).toBe('receiving');
    expect(feed(session, all.slice(0, middle)).payload).toEqual(payload);
  });

  it('finishes after heavy random loss, given enough loops', () => {
    const payload = noise(3000);
    const all = texts(payload);
    const random = chance(42);
    const session = new ReceiveSession({}, 0);
    for (let loop = 0; loop < 40 && session.getSnapshot().status !== 'done'; loop++) {
      for (const text of all) if (random() > 0.6) session.scan(text, loop);
    }
    expect(session.getSnapshot().payload).toEqual(payload);
  });

  it('shows progress before the header arrives', () => {
    const data = texts(noise(1500)).filter((_, i) => i > 0).slice(0, 3);
    const result = feed(new ReceiveSession({}, 0), data);
    expect(result.status).toBe('receiving');
    expect(result.progress.received).toBeGreaterThan(0);
  });

  it('does no work for repeats of the same symbol', () => {
    const [text] = texts(noise(1500));
    const session = new ReceiveSession({}, 0);
    session.scan(text!, 0);
    let updates = 0;
    session.subscribe(() => updates++);
    for (let i = 0; i < 10; i++) session.scan(text!, i);
    expect(updates).toBe(0);
  });

  it('keeps its snapshot when a frame changes nothing', () => {
    const [first, second] = texts(noise(1500));
    const session = new ReceiveSession({}, 0);
    feed(session, [first!, second!]);
    const before = session.getSnapshot();
    feed(session, [first!, second!]);
    expect(session.getSnapshot()).toBe(before);
  });

  it('counts other QR codes without failing', () => {
    const result = feed(new ReceiveSession({}, 0), ['https://example.com', 'Tnot base45 ~']);
    expect(result).toMatchObject({ status: 'searching', rejectedScans: 2 });
  });

  it('counts a damaged frame', () => {
    const [header, data] = texts(noise(1500));
    const flipped = data!.slice(0, 40) + (data![40] === 'A' ? 'B' : 'A') + data!.slice(41);
    const result = feed(new ReceiveSession({}, 0), [header!, flipped]);
    expect(result.rejectedScans).toBe(1);
    expect(result.progress.received).toBe(0);
  });

  it('fails straight away on a payload over the cap', () => {
    const session = new ReceiveSession({ maxPayloadBytes: 1000 }, 0);
    const result = feed(session, texts(noise(1500)));
    expect(result).toMatchObject({ status: 'failed', error: 'payload-too-large' });
    expect(result.payload).toBeUndefined();
    expect(session.finished).toBe(true);
  });

  it('fails straight away on too many frames', () => {
    const result = feed(new ReceiveSession({ maxFrameCount: 2 }, 0), texts(noise(1500)));
    expect(result).toMatchObject({ status: 'failed', error: 'too-many-frames' });
  });

  it('reports frames from a different transfer, and can follow it after a reset', () => {
    const first = texts(noise(1500, 1));
    const other = noise(1500, 2);
    const session = new ReceiveSession({}, 0);
    feed(session, first.slice(0, 3));
    expect(feed(session, texts(other).slice(0, 3)).otherSessionFrames).toBeGreaterThan(0);

    session.reset(100);
    expect(session.getSnapshot()).toMatchObject({ status: 'searching', otherSessionFrames: 0 });
    expect(feed(session, texts(other)).payload).toEqual(other);
  });

  it('takes the same symbol again after a reset', () => {
    const payload = noise(1500);
    const all = texts(payload);
    const session = new ReceiveSession({}, 0);
    feed(session, all);
    session.reset(0);
    expect(feed(session, all).payload).toEqual(payload);
  });

  it('ignores scans once finished', () => {
    const session = new ReceiveSession({}, 0);
    const all = texts(noise(1500));
    const done = feed(session, all);
    session.scan('https://example.com', 0);
    expect(session.getSnapshot()).toBe(done);
  });

  it('stops on cancel and drops what it held', () => {
    const session = new ReceiveSession({}, 0);
    const all = texts(noise(1500));
    feed(session, all.slice(0, 3));
    session.cancel();
    expect(session.getSnapshot()).toMatchObject({ status: 'cancelled', progress: { received: 0 } });
    session.scan(all[3]!, 0);
    expect(session.getSnapshot().progress.received).toBe(0);
  });

  it('measures the scan rate, repeats included', () => {
    const [text] = texts(noise(1500));
    const session = new ReceiveSession({}, 0);
    for (let i = 0; i < 10; i++) session.scan(text!, i);
    session.refresh(500);
    expect(session.getSnapshot().scansPerSecond).toBe(20);
    session.refresh(1000);
    expect(session.getSnapshot().scansPerSecond).toBe(0);
  });

  it('measures how long progress has stalled', () => {
    const all = texts(noise(1500));
    const session = new ReceiveSession({}, 1000);
    session.scan(all[1]!, 1200);
    session.refresh(1500);
    expect(session.getSnapshot().stalledMs).toBe(300);
    session.scan(all[1]!, 1600);
    session.refresh(2500);
    expect(session.getSnapshot().stalledMs).toBe(1300);
  });

  it('completes through real symbols, with loss and repeated scans', () => {
    const payload = noise(4000);
    const sender = new SendSession(payload, {
      version: 10,
      errorCorrection: 'M',
      fps: 10,
      mask: 0,
      mime: 'application/octet-stream',
      kind: 'test',
    });
    const receiver = new ReceiveSession({}, 0);
    const random = chance(7);

    sender.advance(0);
    // Starts partway through the cycle, as someone joining late would.
    for (let step = 1; step <= 7; step++) sender.advance(step * 100);
    for (let step = 8; step < 2000 && !receiver.finished; step++) {
      if (random() > 0.25) {
        const text = scan(sender.getSymbol());
        receiver.scan(text, step * 100);
        receiver.scan(text, step * 100 + 40);
      }
      sender.prepare();
      sender.advance(step * 100);
    }

    expect(receiver.getSnapshot()).toMatchObject({ status: 'done', rejectedScans: 0 });
    expect(receiver.getSnapshot().payload).toEqual(payload);
  });
});
