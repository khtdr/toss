import { Encoder } from 'toss-core';
import { frameToText } from 'toss-qr';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TossReceiver } from '../src/TossReceiver.js';
import type { TossReceiverProps } from '../src/TossReceiver.js';
import { TossSender } from '../src/TossSender.js';
import type { TossSenderProps } from '../src/TossSender.js';
import { noise } from './helpers.js';

const native = vi.hoisted(() => ({
  permission: null as { granted: boolean; canAskAgain?: boolean } | null,
  requestPermission: vi.fn(async () => {}),
  openSettings: vi.fn(async () => {}),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Button: 'Button',
  Linking: { openSettings: native.openSettings },
  PixelRatio: { get: () => 3 },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 360 }),
}));
vi.mock('@shopify/react-native-skia', () => ({
  Canvas: 'Canvas',
  Fill: 'Fill',
  Group: 'Group',
  Path: 'Path',
  Skia: { Path: { MakeFromSVGString: (path: string) => ({ path }) } },
}));
vi.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [native.permission, native.requestPermission, async () => {}],
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: async () => {},
  deactivateKeepAwake: async () => {},
}));
vi.mock('expo-brightness', () => ({
  setBrightnessAsync: async () => {},
  restoreSystemBrightnessAsync: async () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  vi.clearAllMocks();
  native.permission = { granted: true };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(element: React.ReactElement) {
  let root: ReactTestRenderer;
  act(() => {
    root = create(element);
  });
  return root!;
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function text(root: ReactTestRenderer): string {
  return root.root
    .findAllByType('Text' as never)
    .map((node) => node.children.join(''))
    .join('\n');
}

function find(root: ReactTestRenderer, type: string): ReactTestInstance[] {
  return root.root.findAllByType(type as never);
}

function press(root: ReactTestRenderer, title: string) {
  const button = find(root, 'Button').find((node) => node.props.title === title);
  if (!button) throw new Error(`no ${title} button`);
  act(() => button.props.onPress());
}

describe('TossSender', () => {
  const send: Omit<TossSenderProps, 'data'> = { mime: 'text/plain', kind: 'test', version: 10 };

  function layOut(root: ReactTestRenderer, width: number, height: number) {
    const stage = find(root, 'View').find((node) => node.props.onLayout);
    act(() => stage!.props.onLayout({ nativeEvent: { layout: { width, height } } }));
  }

  it('draws nothing until there is data', () => {
    const root = render(<TossSender {...send} data={null} />);
    layOut(root, 360, 600);
    advance(100);
    expect(find(root, 'Canvas')).toHaveLength(0);
    expect(find(root, 'ActivityIndicator')).toHaveLength(0);
  });

  it('shows that it is preparing, then the symbol', () => {
    const root = render(<TossSender {...send} data={noise(3000)} />);
    layOut(root, 360, 600);
    expect(find(root, 'ActivityIndicator')).toHaveLength(1);
    expect(text(root)).toContain('Preparing');
    expect(find(root, 'Canvas')).toHaveLength(0);

    advance(0);
    expect(find(root, 'ActivityIndicator')).toHaveLength(0);
    expect(find(root, 'Canvas')).toHaveLength(1);
    expect(text(root)).toContain('Keep this screen facing the other phone');
  });

  it('fits the symbol to the shorter side of its space', () => {
    const root = render(<TossSender {...send} data={noise(3000)} />);
    layOut(root, 700, 300);
    advance(0);
    const { width } = find(root, 'Canvas')[0]!.props.style;
    expect(width).toBeGreaterThan(250);
    expect(width).toBeLessThanOrEqual(300);
  });

  it('keeps the symbol mounted through stats updates, and counts loops from one', () => {
    const root = render(<TossSender {...send} data={noise(500)} />);
    layOut(root, 360, 600);
    advance(0);
    expect(text(root)).toMatch(/Loop 1, \d+ frames?/);
    const canvas = find(root, 'Canvas')[0];
    advance(3000);
    expect(text(root)).not.toContain('Loop 1,');
    expect(find(root, 'Canvas')[0]).toBe(canvas);
  });

  it('stops and tells the app', () => {
    const onStop = vi.fn();
    const root = render(<TossSender {...send} data={noise(3000)} onStop={onStop} />);
    layOut(root, 360, 600);
    advance(0);
    press(root, 'Stop');
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(find(root, 'Canvas')).toHaveLength(0);
    expect(text(root)).toContain('Stopped');
  });

  it('can send again after stopping', () => {
    const root = render(<TossSender {...send} data={noise(3000)} />);
    layOut(root, 360, 600);
    advance(0);
    press(root, 'Stop');
    press(root, 'Send again');
    advance(0);
    expect(find(root, 'Canvas')).toHaveLength(1);
  });

  it('shows why it could not send', () => {
    const root = render(<TossSender {...send} data={noise(10)} fps={0} />);
    advance(0);
    expect(text(root)).toContain("Couldn't send this");
    expect(text(root)).toContain('0 is not a frame rate');
  });
});

describe('TossReceiver', () => {
  function frames(payload: Uint8Array) {
    const encoder = new Encoder(payload, { maxFrameBytes: 200, mime: 'text/plain', kind: 'note', compress: false });
    return Array.from({ length: encoder.cycleLength }, (_, t) => frameToText(encoder.frameAt(t)));
  }

  function scan(root: ReactTestRenderer, texts: string[]) {
    for (const data of texts) {
      const onBarcodeScanned = find(root, 'CameraView')[0]?.props.onBarcodeScanned;
      act(() => onBarcodeScanned?.({ data }));
    }
  }

  /** Scans until the screen says `blocks` have arrived. */
  function scanTo(root: ReactTestRenderer, texts: string[], blocks: number) {
    for (const data of texts) {
      scan(root, [data]);
      if (text(root).startsWith(`${blocks} of `)) return;
    }
    throw new Error(`never reached ${blocks} blocks`);
  }

  const receiver = (props: Partial<TossReceiverProps> = {}) => <TossReceiver onReceive={() => {}} {...props} />;

  it('waits for the permission to be known', () => {
    native.permission = null;
    const root = render(receiver());
    expect(find(root, 'CameraView')).toHaveLength(0);
    expect(find(root, 'Button')).toHaveLength(0);
  });

  it('asks for the camera', () => {
    native.permission = { granted: false, canAskAgain: true };
    const root = render(receiver());
    expect(find(root, 'CameraView')).toHaveLength(0);
    press(root, 'Allow camera');
    expect(native.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('points to the settings once the system stops asking', () => {
    native.permission = { granted: false, canAskAgain: false };
    const root = render(receiver());
    press(root, 'Open settings');
    expect(native.openSettings).toHaveBeenCalledTimes(1);
  });

  it('scans QR codes and says what to do', () => {
    const root = render(receiver());
    expect(find(root, 'CameraView')[0]!.props).toMatchObject({ barcodeScannerSettings: { barcodeTypes: ['qr'] } });
    expect(text(root)).toContain("Point the camera at the other phone's code");
  });

  it('shows progress as blocks arrive', () => {
    const root = render(receiver());
    scanTo(root, frames(noise(2000)), 3);
    expect(text(root)).toMatch(/^3 of (\d+) blocks/);
    const total = Number(/of (\d+)/.exec(text(root))![1]);
    const bar = find(root, 'View').find((node) => String(node.props.style?.[1]?.width).endsWith('%'));
    expect(parseFloat(bar!.props.style[1].width)).toBeCloseTo((3 / total) * 100);
  });

  it('asks people to hold steady only after a stall', () => {
    const root = render(receiver());
    scanTo(root, frames(noise(2000)), 2);
    advance(1000);
    expect(text(root)).not.toContain('Hold steady');
    advance(1500);
    expect(text(root)).toContain('Hold steady, with the whole code in view.');
  });

  it('explains a stall near the end', () => {
    const root = render(receiver());
    const texts = frames(noise(2000));
    scan(root, texts.slice(0, 1));
    const total = Number(/of (\d+)/.exec(text(root))![1]);
    scanTo(root, texts, total - 1);
    advance(2500);
    expect(text(root)).toContain('The last few blocks can take a while.');
  });

  it('hands over the payload once, and uses the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const payload = noise(1000);
    const root = render(receiver({ onReceive: first }));
    act(() => root.update(receiver({ onReceive: second })));
    scan(root, frames(payload));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0]).toEqual(payload);
    expect(second.mock.calls[0]![1]).toMatchObject({ kind: 'note', mime: 'text/plain' });

    act(() => root.update(receiver({ onReceive: second })));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('closes the camera when done, and can receive another', () => {
    const onReceive = vi.fn();
    const root = render(receiver({ onReceive }));
    scan(root, frames(noise(1000)));
    expect(find(root, 'CameraView')).toHaveLength(0);
    expect(text(root)).toContain('Received 1000 bytes');

    press(root, 'Receive another');
    expect(find(root, 'CameraView')).toHaveLength(1);
    scan(root, frames(noise(1000, 2)));
    expect(onReceive).toHaveBeenCalledTimes(2);
  });

  it('explains a transfer over the size cap, and can try again', () => {
    const onReceive = vi.fn();
    const root = render(receiver({ onReceive, maxPayloadBytes: 100 }));
    scan(root, frames(noise(1000)));
    expect(text(root)).toContain('This transfer is larger than this app accepts.');
    expect(onReceive).not.toHaveBeenCalled();
    press(root, 'Try again');
    expect(find(root, 'CameraView')).toHaveLength(1);
  });

  it('offers to follow a sender that moved on to something else', () => {
    const root = render(receiver());
    scanTo(root, frames(noise(2000, 1)), 2);
    expect(find(root, 'Button').map((node) => node.props.title)).toEqual(['Cancel']);

    scan(root, frames(noise(2000, 2)).slice(0, 2));
    expect(text(root)).toContain('The other phone started a different transfer.');
    press(root, 'Follow it');
    expect(text(root)).toContain("Point the camera at the other phone's code");
  });

  it('cancels and tells the app', () => {
    const onCancel = vi.fn();
    const root = render(receiver({ onCancel }));
    press(root, 'Cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(find(root, 'CameraView')).toHaveLength(0);
    press(root, 'Start again');
    expect(find(root, 'CameraView')).toHaveLength(1);
  });
});
