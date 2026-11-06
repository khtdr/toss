import { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TossSymbol } from './TossSymbol.js';
import { useTossSend } from './use-toss-send.js';
import type { TossSendOptions } from './use-toss-send.js';

export interface TossSenderProps extends TossSendOptions {
  /** Null until the app is ready to send. Keep it stable between renders. */
  data: Uint8Array | null;
  /**
   * Called when someone presses Stop. A sender can't tell when a receiver
   * finishes, so this is the only ending. Without it, Stop offers to send again.
   */
  onStop?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** A ready-made send screen. Use `useTossSend` for anything it doesn't do. */
export function TossSender({ data, onStop, style, ...options }: TossSenderProps) {
  const send = useTossSend(data, options);
  const [room, setRoom] = useState(0);

  const measure = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    setRoom(Math.min(layout.width, layout.height));
  };
  const stop = () => {
    send.cancel();
    onStop?.();
  };

  return (
    <SafeAreaView style={[styles.screen, style]}>
      <View style={styles.stage} onLayout={measure}>
        {send.symbol && room > 0 && <TossSymbol symbol={send.symbol} maxSide={room} />}
        {send.status === 'preparing' && <ActivityIndicator size="large" color="#111" />}
      </View>
      <View style={styles.panel}>
        {send.status === 'preparing' && <Text style={styles.title}>Preparing</Text>}
        {send.status === 'sending' && (
          <>
            <Text style={styles.title}>Keep this screen facing the other phone</Text>
            <Text style={styles.detail}>
              Loop {send.stats.loops + 1}, {send.frameCount} {send.frameCount === 1 ? 'frame' : 'frames'}
            </Text>
            <Button title="Stop" color="#111" onPress={stop} />
          </>
        )}
        {send.status === 'cancelled' && (
          <>
            <Text style={styles.title}>Stopped</Text>
            <Button title="Send again" color="#111" onPress={send.restart} />
          </>
        )}
        {send.status === 'failed' && (
          <>
            <Text style={styles.title}>Couldn't send this</Text>
            <Text style={styles.detail}>{send.error?.message}</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

// White throughout: the symbol needs contrast around it, in dark mode too.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { minHeight: 128, padding: 16, gap: 8 },
  title: { color: '#111', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  detail: { color: '#555', fontSize: 14, textAlign: 'center' },
});
