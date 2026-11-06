import { Encoder } from 'toss-core';
import { frameToText } from 'toss-qr';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceiveScreen from '../src/app/receive';
import SendScreen from '../src/app/send';
import { nameToKind } from '../src/lib/filename';
import { parseHistory } from '../src/lib/history';
import { unpackFrames } from '../src/lib/journal';
import { LINK, MAX_FILE_BYTES, SEND_SETTINGS } from '../src/lib/settings';
import { history } from '../src/lib/store';
import { AppState, camera, disk, failures, route, router, shared } from './shims';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function noise(length: number, seed = 7): Uint8Array {
  let state = seed;
  return Uint8Array.from({ length }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  });
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

function render(element: React.ReactElement) {
  let root: ReactTestRenderer;
  act(() => {
    root = create(element);
  });
  return {
    get text() {
      return textOf(root.root);
    },
    find: (type: string) => root.root.findAll((node) => (node.type as unknown) === type),
    press(label: string) {
      const buttons = root.root.findAll((node) => (node.type as unknown) === 'Pressable' && textOf(node) === label);
      if (buttons.length === 0) throw new Error(`no "${label}" button in: ${textOf(root.root)}`);
      act(() => buttons[0]!.props.onPress());
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

/** Lets promises and zero-delay tasks finish. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

function setBackground(state: string) {
  act(() => {
    for (const listener of AppState.listeners) listener(state);
  });
}

const blockBytes = LINK.blockBytes;
const log = () => [...disk.keys()].find((uri) => uri.includes('/partial/'));

function airwaves(payload: Uint8Array, name: string, mime = 'text/plain') {
  const encoder = new Encoder(payload, {
    maxFrameBytes: blockBytes + 13,
    mime,
    kind: nameToKind(name),
    compress: false,
  });
  return Array.from({ length: encoder.cycleLength }, (_, t) => frameToText(encoder.frameAt(t)));
}

function scan(screen: ReturnType<typeof render>, texts: string[]) {
  for (const text of texts) {
    // The camera goes away by itself when the transfer finishes.
    const [view] = screen.find('CameraView');
    if (!view) return;
    act(() => view.props.onBarcodeScanned?.({ data: text, raw: text }));
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  for (const { id } of history.getEntries()) history.remove(id);
  disk.clear();
  shared.length = 0;
  failures.write = false;
  camera.granted = true;
  route.params = {};
  AppState.listeners.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('receiving', () => {
  const payload = noise(blockBytes * 12 + 100);
  const texts = airwaves(payload, 'holiday.jpg', 'image/jpeg');

  it('asks for the camera before anything else', () => {
    camera.granted = false;
    expect(render(<ReceiveScreen />).text).toContain('Allow camera');
  });

  it('finishes a transfer, keeps the file, and clears the log', async () => {
    const screen = render(<ReceiveScreen />);
    expect(screen.text).toContain("Point the camera at the other phone's code");

    scan(screen, texts.slice(0, 1));
    await settle();
    expect(screen.text).toContain('holiday.jpg');

    scan(screen, texts);
    await settle();
    expect(screen.text).toContain('Received');
    expect(screen.text).toContain('Only open it if you trust them');

    const [entry] = history.getEntries();
    expect(entry).toMatchObject({ status: 'done', direction: 'received', name: 'holiday.jpg', mime: 'image/jpeg' });
    expect(disk.get(`documents/received/${entry!.id}/holiday.jpg`)).toEqual(payload);
    expect(log()).toBeUndefined();
  });

  it('survives leaving the screen, and resumes with the same file', async () => {
    const first = render(<ReceiveScreen />);
    scan(first, texts.slice(0, 1));
    await settle();
    scan(first, texts.slice(1, 7));
    first.unmount();
    await settle();

    expect(history.getEntries()).toHaveLength(1);
    // Slots 0 and 4 of the loop are headers, so that was 5 blocks and one kept header.
    expect(history.getEntries()[0]).toMatchObject({ status: 'paused', received: 5 });
    expect(unpackFrames(disk.get(log()!)!)).toHaveLength(6);

    const second = render(<ReceiveScreen />);
    scan(second, texts.slice(0, 1));
    await settle();
    expect(second.text).toContain('38%');
    expect(history.getEntries()).toHaveLength(1);

    scan(second, texts.slice(7));
    await settle();
    expect(second.text).toContain('Received');
    const [entry] = history.getEntries();
    expect(entry!.status).toBe('done');
    expect(disk.get(`documents/received/${entry!.id}/holiday.jpg`)).toEqual(payload);
  });

  it('survives the app being killed, using only what was already on disk', async () => {
    const first = render(<ReceiveScreen />);
    scan(first, texts.slice(0, 1));
    await settle();
    scan(first, texts.slice(1, 7));
    setBackground('background');
    await settle();

    // A killed app runs no cleanup, so the saved history still says active.
    const saved = new TextDecoder().decode(disk.get('documents/history.json'));
    expect(parseHistory(saved)[0]).toMatchObject({ status: 'paused', received: 5 });
    expect(unpackFrames(disk.get(log()!)!)).toHaveLength(6);
  });

  it('keeps saving the history after its first save', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts.slice(0, 2));
    await settle();
    for (let i = 0; i < 3; i++) await settle(3000);
    expect(disk.has('documents/history.json')).toBe(true);
    expect(disk.has('documents/history.json.tmp')).toBe(false);
    const saved = new TextDecoder().decode(disk.get('documents/history.json'));
    expect(parseHistory(saved)).toHaveLength(1);
  });

  it('saves progress on a timer too', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts.slice(0, 1));
    await settle();
    scan(screen, texts.slice(1, 4));
    await settle(3000);
    expect(unpackFrames(disk.get(log()!)!).length).toBe(4);
    expect(history.getEntries()[0]!.received).toBe(3);
  });

  it('pauses with the camera off, then resumes', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts.slice(0, 1));
    await settle();
    scan(screen, texts.slice(1, 4));

    screen.press('Pause');
    await settle();
    expect(screen.find('CameraView')).toHaveLength(0);
    expect(screen.text).toContain('Paused at 23%');
    expect(history.getEntries()[0]!.status).toBe('paused');

    screen.press('Resume');
    await settle();
    expect(history.getEntries()[0]!.status).toBe('active');
    scan(screen, texts);
    await settle();
    expect(screen.text).toContain('Received');
  });

  it('counts only time spent scanning', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts.slice(0, 2));
    await settle();
    await settle(2000);
    screen.press('Pause');
    await settle(60_000);
    screen.press('Resume');
    await settle(1000);
    scan(screen, texts);
    await settle();
    const { activeMs } = history.getEntries()[0]!;
    expect(activeMs).toBeGreaterThanOrEqual(3000);
    expect(activeMs).toBeLessThan(10_000);
  });

  it('shows a time left once it knows the size', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts.slice(0, 3));
    await settle(1000);
    expect(screen.text).toMatch(/about \d+ (sec|min) left/);
  });

  it('warns about a long transfer as soon as the header arrives', async () => {
    const big = airwaves(noise(blockBytes * 800), 'video.mp4');
    const screen = render(<ReceiveScreen />);
    scan(screen, big.slice(0, 1));
    await settle(1000);
    expect(screen.text).toContain('sore arm');
  });

  it('throws away a paused transfer and its log', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts.slice(0, 4));
    await settle();
    screen.press('Pause');
    await settle();
    expect(log()).toBeDefined();

    const { Alert } = await import('./shims');
    const alert = vi.spyOn(Alert, 'alert');
    screen.press('Throw away');
    const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    act(() => buttons.find(({ text }) => text === 'Throw away')!.onPress!());
    await settle();

    expect(history.getEntries()).toEqual([]);
    expect(log()).toBeUndefined();
    expect(screen.text).toContain("Point the camera at the other phone's code");
  });

  it('keeps one transfer paused when switching to another', async () => {
    const other = airwaves(noise(blockBytes * 3, 99), 'other.txt');
    const screen = render(<ReceiveScreen />);
    scan(screen, texts.slice(0, 4));
    await settle();
    scan(screen, other.slice(0, 1));
    expect(screen.text).toContain('showing a different file');

    screen.press('Switch to it');
    await settle();
    scan(screen, other);
    await settle();

    const entries = history.getEntries();
    expect(entries.map(({ name, status }) => [name, status])).toEqual([
      ['holiday.jpg', 'paused'],
      ['other.txt', 'done'],
    ]);
    expect(log()).toBeDefined();
  });

  it('can receive the same file twice', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts);
    await settle();
    screen.press('Receive another');
    await settle();
    scan(screen, texts);
    await settle();
    expect(history.getEntries().map(({ status }) => status)).toEqual(['done', 'done']);
  });

  it('cleans a hostile filename, and never writes outside its own folder', async () => {
    const hostile = airwaves(noise(100), '../../../shared_prefs/settings.xml');
    const screen = render(<ReceiveScreen />);
    scan(screen, hostile);
    await settle();
    const [entry] = history.getEntries();
    expect(entry!.name).toBe('settings.xml');
    expect(disk.has(`documents/received/${entry!.id}/settings.xml`)).toBe(true);
  });

  it('refuses an oversized file before keeping anything', async () => {
    const encoder = new Encoder(new Uint8Array(MAX_FILE_BYTES + 1), {
      maxFrameBytes: blockBytes + 13,
      mime: 'a/b',
      kind: nameToKind('huge.bin'),
    });
    const screen = render(<ReceiveScreen />);
    scan(screen, [frameToText(encoder.frameAt(0))]);
    await settle();
    expect(screen.text).toContain('bigger than');
    expect(history.getEntries()).toEqual([]);
  });

  it("keeps the log if the file can't be written, and can try again", async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts.slice(0, 2));
    await settle();
    await settle(3000);
    failures.write = true;
    scan(screen, texts);
    await settle();
    expect(screen.text).toContain("Couldn't save the file");
    expect(log()).toBeDefined();

    failures.write = false;
    screen.press('Try again');
    await settle();
    expect(history.getEntries()[0]!.status).toBe('done');
    expect(log()).toBeUndefined();
  });

  it('hands the file to the share sheet', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts);
    await settle();
    screen.press('Share');
    await settle();
    expect(shared[0]).toContain('holiday.jpg');
  });

  it('saves a copy to a chosen folder', async () => {
    const screen = render(<ReceiveScreen />);
    scan(screen, texts);
    await settle();
    screen.press('Save to a folder');
    await settle();
    expect(disk.get('picked/holiday.jpg')).toEqual(payload);
  });
});

describe('sending', () => {
  const pick = (bytes: Uint8Array, name = 'notes.bin') => {
    disk.set('cache/pick', bytes);
    route.params = { uri: 'cache/pick', name, mime: 'application/octet-stream' };
  };

  async function started(bytes: Uint8Array) {
    pick(bytes);
    const screen = render(<SendScreen />);
    await settle();
    screen.press('Start');
    await settle();
    await settle();
    return screen;
  }

  it('shows the expected time and a warning before anything flashes', async () => {
    pick(noise(1024 * 1024));
    const screen = render(<SendScreen />);
    expect(screen.text).toContain('Reading the file');
    await settle();
    expect(screen.text).toContain('Expect this to take');
    expect(screen.text).toContain('5 min to 6 min');
    expect(screen.text).toContain('sore arm');
    expect(screen.text).toContain('Anyone who can see the screen');
    expect(screen.find('TossSymbol')).toHaveLength(0);
  });

  it('refuses a file over the limit without reading it', async () => {
    pick(new Uint8Array(MAX_FILE_BYTES + 1));
    const screen = render(<SendScreen />);
    await settle();
    expect(screen.text).toContain('The most File Toss can send');
  });

  it('removes the temporary copy if nobody starts', async () => {
    pick(noise(100));
    const screen = render(<SendScreen />);
    await settle();
    screen.unmount();
    expect(disk.has('cache/pick')).toBe(false);
    expect(history.getEntries()).toEqual([]);
  });

  it('flashes once started, and keeps its own copy', async () => {
    const screen = await started(noise(5000));
    expect(screen.text).toContain('notes.bin');
    expect(history.getEntries()[0]).toMatchObject({ direction: 'sent', status: 'active', size: 5000 });
    expect(disk.has(`documents/outgoing/${history.getEntries()[0]!.id}`)).toBe(true);
    expect(disk.has('cache/pick')).toBe(false);
  });

  it('hides the code while paused', async () => {
    const screen = await started(noise(5000));
    screen.press('Pause');
    await settle();
    expect(screen.text).toContain('Paused');
    expect(history.getEntries()[0]!.status).toBe('paused');
    screen.press('Resume');
    await settle();
    expect(history.getEntries()[0]!.status).toBe('active');
  });

  it('stays resumable after leaving, from the same place in the loop', async () => {
    const screen = await started(noise(blockBytes * 40));
    await settle(2500);
    screen.unmount();
    const [entry] = history.getEntries();
    expect(entry).toMatchObject({ status: 'paused' });
    expect(entry!.position).toBeGreaterThan(10);

    route.params = { id: entry!.id };
    const again = render(<SendScreen />);
    await settle();
    expect(again.text).toContain('Resume');
    expect(again.text).toContain('keeps what it already has');
    again.press('Resume');
    await settle();
    again.unmount();
    expect(history.getEntries()[0]!.position).toBe(entry!.position);
  });

  it('sends the same session after resuming, so the receiver can pick it up', async () => {
    const bytes = noise(5000);
    const screen = await started(bytes);
    screen.unmount();
    const [entry] = history.getEntries();
    expect(disk.get(`documents/outgoing/${entry!.id}`)).toEqual(bytes);
    expect(entry!.name).toBe('notes.bin');
  });

  it('finishes when told the other phone has it, and removes its copy', async () => {
    const back = vi.spyOn(router, 'back');
    const screen = await started(noise(5000));
    const [{ id }] = [history.getEntries()[0]!];
    screen.press('Other phone has it');
    await settle();
    expect(history.get(id)!.status).toBe('done');
    expect(disk.has(`documents/outgoing/${id}`)).toBe(false);
    expect(back).toHaveBeenCalled();
  });

  it('says so if a resumed file has gone', async () => {
    const screen = await started(noise(5000));
    screen.unmount();
    const [entry] = history.getEntries();
    disk.delete(`documents/outgoing/${entry!.id}`);
    route.params = { id: entry!.id };
    const again = render(<SendScreen />);
    await settle();
    expect(again.text).toContain('no longer here');
  });

  it('uses the settings the time estimate assumes', () => {
    expect(SEND_SETTINGS.fps).toBe(LINK.fps);
  });
});

describe('end to end', () => {
  it('a file sent by the send screen arrives through the receive screen', async () => {
    const bytes = noise(LINK.blockBytes * 3);
    disk.set('cache/pick', bytes);
    route.params = { uri: 'cache/pick', name: 'résumé.pdf', mime: 'application/pdf' };
    const sender = render(<SendScreen />);
    await settle();
    sender.press('Start');
    await settle();
    await settle();
    const stage = sender.find('View').find((view) => view.props.onLayout)!;
    act(() => stage.props.onLayout({ nativeEvent: { layout: { width: 400, height: 500 } } }));
    expect(sender.find('TossSymbol')[0]!.props.symbol.frameCount).toBe(3);

    const receiver = render(<ReceiveScreen />);
    scan(receiver, airwaves(bytes, 'résumé.pdf', 'application/pdf'));
    await settle();
    const received = history.getEntries().find(({ direction }) => direction === 'received')!;
    expect(received).toMatchObject({ name: 'résumé.pdf', status: 'done', mime: 'application/pdf' });
  });
});
