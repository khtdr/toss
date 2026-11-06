import { CameraView } from 'expo-camera';
import type { BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTossReceive } from 'expo-toss';
import { verifyPayload } from './run';
import { ScanLog } from './scan-log';
import type { Summary } from './scan-log';
import { Button, Chips } from './ui';

const ZOOMS = [0, 0.1, 0.2, 0.3] as const;

/** A run's `ScanLog` figures, plus what the hook made of the same scans. */
interface Run extends Summary {
  hook: { status: string; error: string | null; verified: boolean | null };
}

function device() {
  const constants = Platform.constants as unknown as { Model?: string; Release?: string };
  const hermes = 'HermesInternal' in globalThis;
  return { model: constants.Model, android: constants.Release, hermes };
}

function line(run: Run): string {
  const rate = run.payloadBytesPerSecond;
  const seconds = (run.elapsedMs / 1000).toFixed(1);
  const speed = rate === null ? '' : `, ${(rate / 1024).toFixed(2)} KB/s`;
  const verified = run.hook.verified === null ? '' : run.hook.verified ? ', verified' : ', NOT VERIFIED';
  return `${run.run}: ${run.hook.status} in ${seconds} s${speed}, ${run.blocks.total ?? '?'} frames, ${run.scansPerSecond.toFixed(1)} scans/s${verified}`;
}

export function ReceiveScreen({ onBack }: { onBack: () => void }) {
  const receive = useTossReceive();
  const [runs, setRuns] = useState<Run[]>([]);
  const [zoom, setZoom] = useState<number>(0);
  const log = useRef(new ScanLog());

  const finishRun = () => {
    const summary = log.current.summary();
    log.current = new ScanLog();
    if (summary.scans === 0) return;
    const { status, error, meta, payload } = receive;
    const verified = payload && meta ? verifyPayload(meta.kind, payload) : null;
    const run: Run = { ...summary, hook: { status, error: error ?? null, verified } };
    setRuns((all) => [...all, run]);
    console.log(`TOSS_SPIKE ${JSON.stringify({ device: device(), run })}`);
  };

  const finished = receive.status === 'done' || receive.status === 'failed';
  useEffect(() => {
    if (finished) finishRun();
    // Runs once per finish. `finishRun` reads the render that finished.
  }, [finished]);

  const endRun = () => {
    if (!finished) finishRun();
    receive.reset();
  };

  const { onBarcodeScanned } = receive.cameraProps;
  const onScan = (result: BarcodeScanningResult) => {
    const raw = result.raw === undefined || result.raw === 'null' ? result.data : result.raw;
    log.current.push(raw, result.data, performance.now());
    onBarcodeScanned?.(result);
  };

  const share = () => {
    Share.share({ message: JSON.stringify({ device: device(), runs }, null, 1) });
  };

  if (!receive.permission) return <View />;
  if (!receive.permission.granted) {
    return (
      <View style={styles.center}>
        <Button label="Allow camera" onPress={receive.requestPermission} />
        <Button label="Back" onPress={onBack} />
      </View>
    );
  }

  const { received, total } = receive.progress;
  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <CameraView
        style={styles.camera}
        zoom={zoom}
        {...receive.cameraProps}
        onBarcodeScanned={onBarcodeScanned ? onScan : undefined}
      />
      <ScrollView style={styles.panel}>
        <Text style={styles.big}>
          {receive.status}: {received} of {total ?? '?'} blocks, {receive.scansPerSecond.toFixed(1)} scans/s
        </Text>
        <Text>
          {receive.meta?.kind ?? 'no header yet'}, stalled {(receive.stalledMs / 1000).toFixed(1)} s, rejected{' '}
          {receive.rejectedScans}, other session {receive.otherSessionFrames}
          {receive.error ? `, ${receive.error}` : ''}
        </Text>
        {runs.map((run, i) => (
          <Text key={i}>{line(run)}</Text>
        ))}
        <Chips label="Zoom" options={ZOOMS} value={zoom as (typeof ZOOMS)[number]} onChange={setZoom} />
        <Button label={finished ? 'Next run' : 'End run'} onPress={endRun} />
        <Button label="Share results" onPress={share} />
        <Button label="Back" onPress={onBack} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  camera: { flex: 1 },
  panel: { flex: 1, padding: 12 },
  big: { fontSize: 18, fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', padding: 16 },
});
