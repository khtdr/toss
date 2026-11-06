import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { ScanLog } from './scan-log';
import type { ScannerCheck, Summary } from './scan-log';
import { Button, Chips } from './ui';

const ZOOMS = [0, 0.1, 0.2, 0.3] as const;

function device() {
  const constants = Platform.constants as unknown as { Model?: string; Release?: string };
  const hermes = 'HermesInternal' in globalThis;
  return { model: constants.Model, android: constants.Release, hermes };
}

function line(summary: Summary): string {
  const rate = summary.payloadBytesPerSecond;
  const seconds = (summary.elapsedMs / 1000).toFixed(1);
  const speed = rate === null ? '' : `, ${(rate / 1024).toFixed(2)} KB/s`;
  return `${summary.run}: ${summary.status} in ${seconds} s${speed}, ${summary.scansPerSecond.toFixed(1)} scans/s`;
}

export function ReceiveScreen({ onBack }: { onBack: () => void }) {
  useKeepAwake();
  const [permission, requestPermission] = useCameraPermissions();
  const [runs, setRuns] = useState<Summary[]>([]);
  const [zoom, setZoom] = useState<number>(0);
  const [, redraw] = useState(0);
  const log = useRef(new ScanLog());
  // Each run gets a new log, and this result has to outlive them.
  const lastCheck = useRef<ScannerCheck | undefined>(undefined);

  useEffect(() => {
    const timer = setInterval(() => redraw((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);

  const finishRun = () => {
    const summary = log.current.summary();
    if (summary.scans > 0) {
      setRuns((all) => [...all, summary]);
      console.log(`TOSS_SPIKE ${JSON.stringify({ device: device(), summary })}`);
    }
    log.current = new ScanLog();
  };

  const onScan = ({ data, raw }: { data: string; raw?: string }) => {
    const value = raw === undefined || raw === 'null' ? data : raw;
    const wasFinished = log.current.finished;
    log.current.push(value, data, performance.now());
    lastCheck.current = log.current.check ?? lastCheck.current;
    if (!wasFinished && log.current.finished) finishRun();
  };

  const share = () => {
    Share.share({ message: JSON.stringify({ device: device(), check: lastCheck.current, runs }, null, 1) });
  };

  if (!permission) return <View />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Button label="Allow camera" onPress={requestPermission} />
        <Button label="Back" onPress={onBack} />
      </View>
    );
  }

  const { received, total } = log.current.progress;
  const live = log.current.summary();
  const check = lastCheck.current;
  return (
    <View style={styles.screen}>
      <CameraView
        style={styles.camera}
        facing="back"
        zoom={zoom}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScan}
      />
      <ScrollView style={styles.panel}>
        <Text style={styles.big}>
          {received} of {total ?? '?'} blocks, {live.scansPerSecond.toFixed(1)} scans/s
        </Text>
        <Text>
          {live.run}, rejected {JSON.stringify(live.rejected)}
        </Text>
        {check && (
          <Text>
            Scanner check {check.exact ? 'exact' : 'CHANGED'}: {check.received}
          </Text>
        )}
        {runs.map((run, i) => (
          <Text key={i}>{line(run)}</Text>
        ))}
        <Chips label="Zoom" options={ZOOMS} value={zoom as (typeof ZOOMS)[number]} onChange={setZoom} />
        <Button label="End run" onPress={finishRun} />
        <Button label="Share results" onPress={share} />
        <Button label="Back" onPress={onBack} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  camera: { flex: 1 },
  panel: { flex: 1, padding: 12 },
  big: { fontSize: 18, fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', padding: 16 },
});
