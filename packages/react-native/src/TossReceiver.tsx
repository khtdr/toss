import { CameraView } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { Button, Linking, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { TransferMeta } from 'toss-core';
import type { ReceiveError, ReceiveOptions } from './receive-session.js';
import { useTossReceive } from './use-toss-receive.js';

export interface TossReceiverProps extends ReceiveOptions {
  /** Called once per finished transfer. Both arguments are untrusted. */
  onReceive: (payload: Uint8Array, meta: TransferMeta) => void;
  /** Called when someone presses Cancel. Without it, Cancel offers to start again. */
  onCancel?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Long enough that ordinary gaps between new blocks don't set it off. */
const HOLD_STEADY_AFTER_MS = 2000;
/** Past this share of the blocks, a long wait is normal: the loop has to come back round. */
const NEARLY_DONE = 0.9;

function holdSteadyHint(stalledMs: number, received: number, total: number | null): string {
  if (stalledMs < HOLD_STEADY_AFTER_MS || total === null) return '';
  return received / total >= NEARLY_DONE
    ? 'Hold steady. The last few blocks can take a while.'
    : 'Hold steady, with the whole code in view.';
}

function failureMessage(error: ReceiveError | undefined): string {
  switch (error) {
    case 'payload-too-large':
    case 'too-many-frames':
      return 'This transfer is larger than this app accepts.';
    case 'unsupported-compression':
    case 'unsupported-redundancy':
      return 'This transfer came from a newer version.';
    default:
      return 'The data arrived damaged.';
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A ready-made receive screen. It stops at `onReceive`, so what happens to the
 * data, and any confirmation first, stays with the app. Use `useTossReceive`
 * for anything it doesn't do.
 *
 * Options are read once, when the component mounts.
 */
export function TossReceiver({ onReceive, onCancel, style, ...options }: TossReceiverProps) {
  const receive = useTossReceive(options);
  const { status, payload, meta, permission } = receive;
  const { received, total } = receive.progress;

  const latestOnReceive = useRef(onReceive);
  useEffect(() => {
    latestOnReceive.current = onReceive;
  });
  useEffect(() => {
    if (payload && meta) latestOnReceive.current(payload, meta);
  }, [payload, meta]);

  if (!permission) return <View style={[styles.screen, style]} />;

  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.center, style]}>
        <Text style={styles.title}>The camera reads the other phone's screen</Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" color="#111" onPress={() => void receive.requestPermission()} />
        ) : (
          <Button title="Open settings" color="#111" onPress={() => void Linking.openSettings()} />
        )}
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={[styles.screen, styles.center, style]}>
        <Text style={styles.title}>Received {payload && formatSize(payload.length)}</Text>
        <Button title="Receive another" color="#111" onPress={receive.reset} />
      </View>
    );
  }

  if (status === 'failed') {
    return (
      <View style={[styles.screen, styles.center, style]}>
        <Text style={styles.title}>Transfer failed</Text>
        <Text style={styles.detail}>{failureMessage(receive.error)}</Text>
        <Button title="Try again" color="#111" onPress={receive.reset} />
      </View>
    );
  }

  if (status === 'cancelled') {
    return (
      <View style={[styles.screen, styles.center, style]}>
        <Text style={styles.title}>Cancelled</Text>
        <Button title="Start again" color="#111" onPress={receive.reset} />
      </View>
    );
  }

  const cancel = () => {
    receive.cancel();
    onCancel?.();
  };
  const senderChanged = receive.otherSessionFrames > 0;

  // The panel keeps its height as messages come and go, so the preview doesn't
  // move while someone is aiming it.
  return (
    <View style={[styles.screen, style]}>
      <CameraView style={styles.camera} {...receive.cameraProps} />
      <View style={styles.panel}>
        <Text style={styles.title}>
          {total === null ? "Point the camera at the other phone's code" : `${received} of ${total} blocks`}
        </Text>
        <View style={styles.track}>
          <View style={[styles.bar, { width: `${total ? (received / total) * 100 : 0}%` }]} />
        </View>
        <Text style={styles.detail}>
          {senderChanged
            ? 'The other phone started a different transfer.'
            : holdSteadyHint(receive.stalledMs, received, total)}
        </Text>
        <View style={styles.actions}>
          {senderChanged && <Button title="Follow it" color="#111" onPress={receive.reset} />}
          <Button title="Cancel" color="#111" onPress={cancel} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 },
  camera: { flex: 1 },
  panel: { height: 184, padding: 16, gap: 8 },
  title: { color: '#111', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  detail: { color: '#555', fontSize: 14, textAlign: 'center', minHeight: 20 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#ddd', overflow: 'hidden' },
  bar: { height: 6, backgroundColor: '#111' },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
});
