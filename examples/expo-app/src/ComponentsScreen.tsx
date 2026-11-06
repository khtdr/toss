import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { TossReceiver, TossSender } from 'toss-react-native';
import { sendOptions, testPayload, verifyPayload } from './run';
import type { RunConfig } from './run';
import { Button, Chips } from './ui';

const SIZES_KB = [50, 200, 1024] as const;

function Sender({ sizeKb, onStop }: { sizeKb: number; onStop: () => void }) {
  const config: RunConfig = {
    version: 30,
    errorCorrection: 'M',
    fps: 10,
    payloadBytes: sizeKb * 1024,
    payloadType: 'json',
  };
  // After the first render, so making test data doesn't hold up the screen change.
  const [data, setData] = useState<Uint8Array | null>(null);
  useEffect(() => setData(testPayload(config.payloadBytes, config.payloadType)), [config.payloadBytes, config.payloadType]);
  return <TossSender data={data} {...sendOptions(config)} onStop={onStop} />;
}

/** The default components, as an app would use them. */
export function ComponentsScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'menu' | 'send' | 'receive'>('menu');
  const [sizeKb, setSizeKb] = useState<number>(200);
  const [result, setResult] = useState('');
  const menu = () => setMode('menu');

  if (mode === 'send') return <Sender sizeKb={sizeKb} onStop={menu} />;
  if (mode === 'receive') {
    return (
      <TossReceiver
        maxPayloadBytes={2 * 1024 * 1024}
        onCancel={menu}
        onReceive={(payload, meta) => {
          const verified = verifyPayload(meta.kind, payload);
          setResult(`${payload.length} bytes, ${verified ? 'verified' : 'NOT VERIFIED'}`);
        }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Chips label="Payload (KB)" options={SIZES_KB} value={sizeKb as (typeof SIZES_KB)[number]} onChange={setSizeKb} />
      <Button label="Send" onPress={() => setMode('send')} />
      <Button label="Receive" onPress={() => setMode('receive')} />
      <Button label="Back" onPress={onBack} />
      {result !== '' && <Text style={styles.result}>Last received: {result}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, paddingTop: 48 },
  result: { marginTop: 12, textAlign: 'center' },
});
