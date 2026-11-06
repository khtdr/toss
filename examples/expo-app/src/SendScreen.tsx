import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { TossSymbol, useTossSend } from 'toss-react-native';
import type { ErrorCorrection } from 'toss-qr';
import { sendOptions, testPayload } from './run';
import type { PayloadType, RunConfig } from './run';
import { Button, Chips } from './ui';

const VERSIONS = [6, 8, 10, 12, 15, 20, 25, 30, 35, 40] as const;
const LEVELS: readonly ErrorCorrection[] = ['L', 'M', 'Q', 'H'];
const RATES = [3, 5, 8, 10, 12, 15, 20, 30] as const;
const SIZES_KB = [5, 20, 50, 200, 1024] as const;
const PAYLOADS: readonly PayloadType[] = ['noise', 'json'];

function Flasher({ config, onStop }: { config: RunConfig; onStop: () => void }) {
  const [run] = useState(() => {
    const data = testPayload(config.payloadBytes, config.payloadType);
    return { data, options: sendOptions(config), createdAt: performance.now() };
  });
  const send = useTossSend(run.data, run.options);
  const { shownFps, skippedSlots, loops } = send.stats;

  // Covers compression and the first symbol, which block the screen on a large payload.
  const startMs = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (send.status === 'sending') startMs.current ??= performance.now() - run.createdAt;
  }, [send.status, run.createdAt]);

  return (
    <Pressable style={styles.flash} onPress={onStop}>
      {send.symbol && <TossSymbol symbol={send.symbol} />}
      <Text style={styles.stats}>
        v{config.version}-{config.errorCorrection}, {config.payloadType}, {send.frameCount ?? '?'} frames
        {'\n'}
        started in {startMs.current?.toFixed(0) ?? '?'} ms
        {'\n'}
        {shownFps.toFixed(1)} fps shown, {skippedSlots} slots skipped, {loops} loops
        {'\n'}
        {send.error ? `${send.error.message}\n` : ''}tap to stop
      </Text>
    </Pressable>
  );
}

export function SendScreen({ onBack }: { onBack: () => void }) {
  const [version, setVersion] = useState<number>(30);
  const [errorCorrection, setLevel] = useState<ErrorCorrection>('M');
  const [fps, setFps] = useState<number>(10);
  const [sizeKb, setSizeKb] = useState<number>(50);
  const [payloadType, setPayloadType] = useState<PayloadType>('json');
  const [sending, setSending] = useState(false);
  const config: RunConfig = { version, errorCorrection, fps, payloadBytes: sizeKb * 1024, payloadType };

  if (sending) return <Flasher config={config} onStop={() => setSending(false)} />;

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Chips label="QR version" options={VERSIONS} value={version as (typeof VERSIONS)[number]} onChange={setVersion} />
      <Chips label="Error correction" options={LEVELS} value={errorCorrection} onChange={setLevel} />
      <Chips label="Frames per second" options={RATES} value={fps as (typeof RATES)[number]} onChange={setFps} />
      <Chips label="Payload (KB)" options={SIZES_KB} value={sizeKb as (typeof SIZES_KB)[number]} onChange={setSizeKb} />
      <Chips label="Payload type" options={PAYLOADS} value={payloadType} onChange={setPayloadType} />
      <Button label="Start" onPress={() => setSending(true)} />
      <Button label="Back" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, paddingTop: 48 },
  flash: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stats: { marginTop: 16, color: '#444', textAlign: 'center', fontSize: 12 },
});
