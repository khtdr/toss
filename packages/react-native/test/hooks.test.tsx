import { Encoder } from 'toss-core';
import { frameToText } from 'toss-qr';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { BarcodeScanningResult } from 'expo-camera';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTossReceive } from '../src/use-toss-receive.js';
import type { TossReceive } from '../src/use-toss-receive.js';
import { useTossSend } from '../src/use-toss-send.js';
import type { TossSend, TossSendOptions } from '../src/use-toss-send.js';
import { noise } from './helpers.js';

const screen = vi.hoisted(() => ({
  activateKeepAwakeAsync: vi.fn(async (_tag?: string) => {}),
  deactivateKeepAwake: vi.fn(async (_tag?: string) => {}),
  setBrightnessAsync: vi.fn(async (_value: number) => {}),
  restoreSystemBrightnessAsync: vi.fn(async () => {}),
  requestPermission: vi.fn(),
  app: {
    currentState: 'active',
    listeners: new Set<(state: string) => void>(),
  },
}));

vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return screen.app.currentState;
    },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      screen.app.listeners.add(listener);
      return { remove: () => screen.app.listeners.delete(listener) };
    },
  },
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: screen.activateKeepAwakeAsync,
  deactivateKeepAwake: screen.deactivateKeepAwake,
}));
vi.mock('expo-brightness', () => ({
  setBrightnessAsync: screen.setBrightnessAsync,
  restoreSystemBrightnessAsync: screen.restoreSystemBrightnessAsync,
}));
vi.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true }, screen.requestPermission],
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options: TossSendOptions = { mime: 'application/json', kind: 'test', version: 10 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  // Node has no animation frames, so these stand in at 60 Hz.
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  vi.clearAllMocks();
  screen.app.currentState = 'active';
  screen.app.listeners.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderSend(data: Uint8Array | null, sendOptions = options) {
  const seen: { current: TossSend; renders: number } = { current: undefined as never, renders: 0 };
  function Host(props: { data: Uint8Array | null; options: TossSendOptions }) {
    seen.current = useTossSend(props.data, props.options);
    seen.renders++;
    return null;
  }
  let root: ReactTestRenderer;
  act(() => {
    root = create(<Host data={data} options={sendOptions} />);
  });
  return {
    seen,
    update(next: Uint8Array | null, nextOptions = sendOptions) {
      act(() => root.update(<Host data={next} options={nextOptions} />));
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function renderReceive(receiveOptions = {}) {
  const seen: { current: TossReceive } = { current: undefined as never };
  function Host() {
    seen.current = useTossReceive(receiveOptions);
    return null;
  }
  let root: ReactTestRenderer;
  act(() => {
    root = create(<Host />);
  });
  return {
    seen,
    unmount() {
      act(() => root.unmount());
    },
  };
}

function barcode(data: string, raw?: string): BarcodeScanningResult {
  const result = { type: 'qr', data, cornerPoints: [], bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } } };
  return raw === undefined ? result : { ...result, raw };
}

function transferTexts(payload: Uint8Array): string[] {
  const encoder = new Encoder(payload, { maxFrameBytes: 200, mime: 'text/plain', kind: 'note', compress: false });
  return Array.from({ length: encoder.cycleLength }, (_, t) => frameToText(encoder.frameAt(t)));
}

describe('useTossSend', () => {
  it('stays idle, with the screen left alone, until there is data', () => {
    const { seen } = renderSend(null);
    expect(seen.current).toMatchObject({ status: 'idle', symbol: null, frameCount: null });
    expect(screen.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(screen.setBrightnessAsync).not.toHaveBeenCalled();
  });

  it('starts sending, with the default settings for anything unset', () => {
    const { seen } = renderSend(noise(3000), { mime: 'text/plain', kind: 'test' });
    expect(seen.current.status).toBe('sending');
    expect(seen.current.symbol?.getSymbol().modules).toBe(137 + 8);
    expect(seen.current.frameCount).toBe(3);
  });

  it('wakes and brightens the screen only while sending', () => {
    const { update } = renderSend(noise(500));
    expect(screen.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(screen.setBrightnessAsync).toHaveBeenCalledWith(1);
    update(null);
    expect(screen.deactivateKeepAwake).toHaveBeenCalledTimes(1);
    expect(screen.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
  });

  it('changes symbols at the configured rate without rendering the host', () => {
    const { seen } = renderSend(noise(3000));
    const source = seen.current.symbol!;
    const rendersBefore = seen.renders;
    const symbols = new Set([source.getSymbol()]);
    const leave = source.subscribe(() => symbols.add(source.getSymbol()));

    act(() => {
      vi.advanceTimersByTime(950);
    });

    leave();
    expect(symbols.size).toBeGreaterThanOrEqual(8);
    expect(symbols.size).toBeLessThanOrEqual(10);
    expect(seen.renders).toBe(rendersBefore);
  });

  it('reports stats once a second', () => {
    const { seen } = renderSend(noise(500));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(seen.current.stats.shownFps).toBeGreaterThan(8);
    expect(seen.current.stats.loops).toBeGreaterThan(0);
  });

  it('stops the clock while the app is in the background', () => {
    const { seen } = renderSend(noise(3000));
    const source = seen.current.symbol!;
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const held = source.getSymbol();
    act(() => {
      for (const listener of screen.app.listeners) listener('background');
      vi.advanceTimersByTime(30_000);
    });
    expect(source.getSymbol()).toBe(held);

    act(() => {
      for (const listener of screen.app.listeners) listener('active');
      vi.advanceTimersByTime(1000);
    });
    expect(source.getSymbol()).not.toBe(held);
    expect(seen.current.stats.skippedSlots).toBeLessThan(5);
  });

  it('starts paused if the app is already in the background', () => {
    screen.app.currentState = 'background';
    const { seen } = renderSend(noise(3000));
    const first = seen.current.symbol!.getSymbol();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(seen.current.symbol!.getSymbol()).toBe(first);
  });

  it('stops on cancel and can restart', () => {
    const { seen } = renderSend(noise(3000));
    const first = seen.current.symbol!;
    act(() => seen.current.cancel());
    expect(seen.current).toMatchObject({ status: 'cancelled', symbol: null });

    const frozen = first.getSymbol();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(first.getSymbol()).toBe(frozen);

    act(() => seen.current.restart());
    expect(seen.current.status).toBe('sending');
  });

  it('sends new data after a cancel', () => {
    const { seen, update } = renderSend(noise(3000, 1));
    act(() => seen.current.cancel());
    update(noise(3000, 2));
    expect(seen.current.status).toBe('sending');
  });

  it('starts a new transfer when the data changes, and not on other renders', () => {
    const data = noise(3000, 1);
    const { seen, update } = renderSend(data);
    const first = seen.current.symbol;
    update(data, { ...options });
    expect(seen.current.symbol).toBe(first);
    update(noise(3000, 2));
    expect(seen.current.symbol).not.toBe(first);
  });

  it('reports bad settings instead of throwing', () => {
    const { seen } = renderSend(noise(10), { ...options, fps: 0 });
    expect(seen.current.status).toBe('failed');
    expect(seen.current.error).toBeInstanceOf(RangeError);
    expect(screen.activateKeepAwakeAsync).not.toHaveBeenCalled();
  });

  it('leaves nothing running after unmounting', () => {
    const { unmount } = renderSend(noise(3000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.app.listeners.size).toBe(0);
    expect(screen.deactivateKeepAwake).toHaveBeenCalledTimes(1);
    expect(screen.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
  });
});

describe('useTossReceive', () => {
  const scanAll = (seen: { current: TossReceive }, texts: string[]) => {
    for (const text of texts) {
      act(() => seen.current.cameraProps.onBarcodeScanned?.(barcode(text)));
    }
  };

  it('gives the camera QR-only settings and exposes permission', () => {
    const { seen } = renderReceive();
    expect(seen.current.cameraProps).toMatchObject({
      facing: 'back',
      barcodeScannerSettings: { barcodeTypes: ['qr'] },
    });
    expect(seen.current.permission).toEqual({ granted: true });
    expect(seen.current.requestPermission).toBe(screen.requestPermission);
  });

  it('completes a transfer, then stops scanning and lets the screen sleep', () => {
    const payload = noise(1000);
    const { seen } = renderReceive();
    expect(screen.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);

    scanAll(seen, transferTexts(payload));

    expect(seen.current).toMatchObject({ status: 'done', meta: { kind: 'note' } });
    expect(seen.current.payload).toEqual(payload);
    expect(seen.current.cameraProps.onBarcodeScanned).toBeUndefined();
    expect(screen.deactivateKeepAwake).toHaveBeenCalledTimes(1);
  });

  it('prefers the raw value, as display values can differ', () => {
    const payload = noise(1000);
    const { seen } = renderReceive();
    for (const text of transferTexts(payload)) {
      act(() => seen.current.cameraProps.onBarcodeScanned?.(barcode('garbled', text)));
    }
    expect(seen.current.status).toBe('done');
  });

  it('falls back to data when the raw value is the text "null"', () => {
    const [header] = transferTexts(noise(1000));
    const { seen } = renderReceive();
    act(() => seen.current.cameraProps.onBarcodeScanned?.(barcode(header!, 'null')));
    expect(seen.current.status).toBe('receiving');
  });

  it('enforces the size cap', () => {
    const { seen } = renderReceive({ maxPayloadBytes: 100 });
    scanAll(seen, transferTexts(noise(1000)));
    expect(seen.current).toMatchObject({ status: 'failed', error: 'payload-too-large' });
    expect(seen.current.cameraProps.onBarcodeScanned).toBeUndefined();
  });

  it('updates live figures while scanning', () => {
    const { seen } = renderReceive();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(seen.current.stalledMs).toBeGreaterThanOrEqual(1000);
  });

  it('resets for another transfer', () => {
    const { seen } = renderReceive();
    scanAll(seen, transferTexts(noise(1000)));
    act(() => seen.current.reset());
    expect(seen.current.status).toBe('searching');
    expect(seen.current.payload).toBeUndefined();
    expect(seen.current.cameraProps.onBarcodeScanned).toBeDefined();
  });

  it('stops on cancel', () => {
    const { seen } = renderReceive();
    act(() => seen.current.cancel());
    expect(seen.current.status).toBe('cancelled');
    expect(seen.current.cameraProps.onBarcodeScanned).toBeUndefined();
  });

  it('leaves nothing running after unmounting', () => {
    const { unmount } = renderReceive();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
