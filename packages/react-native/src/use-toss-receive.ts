import { useCameraPermissions } from 'expo-camera';
import type { BarcodeScanningResult, BarcodeSettings, CameraViewProps, PermissionResponse } from 'expo-camera';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { ReceiveSession } from './receive-session.js';
import type { ReceiveOptions, ReceiveSnapshot } from './receive-session.js';
import { useScreenAwake } from './screen.js';

const REFRESH_INTERVAL_MS = 500;
const QR_ONLY: BarcodeSettings = { barcodeTypes: ['qr'] };

export interface TossReceive extends ReceiveSnapshot {
  /** Null until the camera permission is known. */
  permission: PermissionResponse | null;
  requestPermission(): Promise<PermissionResponse>;
  /** Spread these onto a `CameraView`. */
  cameraProps: Pick<CameraViewProps, 'facing' | 'barcodeScannerSettings' | 'onBarcodeScanned'>;
  /** Drops the transfer and stops scanning. */
  cancel(): void;
  /** Stops scanning and keeps what's arrived. Leave the `CameraView` out while `paused`, to save power. */
  pause(): void;
  /** Scans again. */
  resume(): void;
  /** Adds frames kept from an earlier run, which `options.onFrame` supplied. */
  restore(frames: Iterable<Uint8Array>): void;
  /** Forgets everything and scans for a new transfer. */
  reset(): void;
}

/** Android's scanner can report a missing raw value as the text "null". */
function scannedText({ data, raw }: BarcodeScanningResult): string {
  return raw === undefined || raw === 'null' ? data : raw;
}

/**
 * Rebuilds a transfer from what the camera sees. The app renders the
 * `CameraView`, and decides what to do with `payload`, which is untrusted.
 *
 * `options` are read once, when the component mounts.
 */
export function useTossReceive(options: ReceiveOptions = {}): TossReceive {
  const [session] = useState(() => new ReceiveSession(options, performance.now()));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  // Someone sent to the system settings comes back here, and nothing else says so.
  const denied = permission?.granted === false;
  useEffect(() => {
    if (!denied) return;
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') getPermission().catch(() => {});
    });
    return () => appState.remove();
  }, [denied, getPermission]);

  const scanning = snapshot.status === 'searching' || snapshot.status === 'receiving';
  useScreenAwake(scanning);

  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => session.refresh(performance.now()), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [scanning, session]);

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => session.scan(scannedText(result), performance.now()),
    [session],
  );

  const cameraProps = useMemo<TossReceive['cameraProps']>(() => {
    const props: TossReceive['cameraProps'] = { facing: 'back', barcodeScannerSettings: QR_ONLY };
    if (scanning) props.onBarcodeScanned = onBarcodeScanned;
    return props;
  }, [scanning, onBarcodeScanned]);

  const cancel = useCallback(() => session.cancel(), [session]);
  const reset = useCallback(() => session.reset(performance.now()), [session]);
  const pause = useCallback(() => session.pause(), [session]);
  const resume = useCallback(() => session.resume(performance.now()), [session]);
  const restore = useCallback(
    (frames: Iterable<Uint8Array>) => session.restore(frames, performance.now()),
    [session],
  );

  return { ...snapshot, permission, requestPermission, cameraProps, cancel, reset, pause, resume, restore };
}
