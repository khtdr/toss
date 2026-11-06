import * as Brightness from 'expo-brightness';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { textToMatrix } from 'toss-qr';
import type { ErrorCorrection } from 'toss-qr';
import { matrixToPath, prepare } from './prepare';
import type { Prepared } from './prepare';
import { CHECK_TEXT } from './run';
import type { Renderer, RunConfig } from './run';
import { Symbol } from './Symbol';
import { Button, Chips } from './ui';

const VERSIONS = [6, 8, 10, 12, 15, 20, 25, 30] as const;
const LEVELS: readonly ErrorCorrection[] = ['L', 'M', 'Q', 'H'];
const RATES = [3, 5, 8, 10, 12, 15, 20, 30] as const;
const SIZES_KB = [5, 20, 50, 200] as const;
const RENDERERS: readonly Renderer[] = ['svg', 'skia'];
const CHECK_CONFIG = { version: 5, errorCorrection: 'M' } as const;

/** A side in layout units that gives every module a whole number of pixels. */
function crispSide(windowWidth: number, modules: number) {
  const pixels = PixelRatio.getPixelSizeForLayoutSize(windowWidth);
  const pixelsPerModule = Math.floor(pixels / modules);
  return { side: (pixelsPerModule * modules) / PixelRatio.get(), pixelsPerModule };
}

function Flasher({ config, prepared, onStop }: { config: RunConfig; prepared: Prepared; onStop: () => void }) {
  useKeepAwake();
  const { width } = useWindowDimensions();
  const { side, pixelsPerModule } = crispSide(width, prepared.modules);
  const [slot, setSlot] = useState(0);
  const [stats, setStats] = useState('');
  const counters = useRef({ shown: 0, skipped: 0 });

  useEffect(() => {
    const start = performance.now();
    let handle = 0;
    let last = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      const step = Math.floor((elapsed * config.fps) / 1000);
      if (step !== last) {
        counters.current.skipped += step - last - 1;
        counters.current.shown++;
        last = step;
        setSlot(step % prepared.paths.length);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    const report = setInterval(() => {
      const { shown, skipped } = counters.current;
      const seconds = (performance.now() - start) / 1000;
      setStats(`${(shown / seconds).toFixed(1)} fps shown, ${skipped} slots skipped`);
    }, 1000);
    return () => {
      cancelAnimationFrame(handle);
      clearInterval(report);
    };
  }, [config.fps, prepared.paths.length]);

  return (
    <Pressable style={styles.flash} onPress={onStop}>
      <Symbol
        paths={prepared.paths}
        slot={slot}
        modules={prepared.modules}
        side={side}
        renderer={config.renderer}
      />
      <Text style={styles.stats}>
        v{config.version}-{config.errorCorrection}, {prepared.frameCount} frames of {prepared.frameBytes} B,{' '}
        {prepared.paths.length} per cycle, {pixelsPerModule} px/module{'\n'}
        drew {prepared.drawMs.mean.toFixed(1)} ms each, {(prepared.drawMs.total / 1000).toFixed(1)} s total
        {'\n'}
        {stats}
        {'\n'}tap to stop
      </Text>
    </Pressable>
  );
}

function CheckSymbol({ onStop }: { onStop: () => void }) {
  useKeepAwake();
  const { width } = useWindowDimensions();
  const matrix = textToMatrix(CHECK_TEXT, CHECK_CONFIG);
  const modules = matrix.size + 8;
  return (
    <Pressable style={styles.flash} onPress={onStop}>
      <Symbol
        paths={[matrixToPath(matrix)]}
        slot={0}
        modules={modules}
        side={crispSide(width, modules).side}
        renderer="svg"
      />
      <Text style={styles.stats}>Scanner check: point the receiver here.{'\n'}tap to stop</Text>
    </Pressable>
  );
}

export function SendScreen({ onBack }: { onBack: () => void }) {
  const [version, setVersion] = useState<number>(10);
  const [errorCorrection, setLevel] = useState<ErrorCorrection>('M');
  const [fps, setFps] = useState<number>(5);
  const [sizeKb, setSizeKb] = useState<number>(20);
  const [renderer, setRenderer] = useState<Renderer>('svg');
  const [prepared, setPrepared] = useState<Prepared>();
  const [progress, setProgress] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [checking, setChecking] = useState(false);
  const config: RunConfig = { version, errorCorrection, fps, payloadBytes: sizeKb * 1024, renderer };

  // Screen brightness only applies to this app, and goes back when it stops.
  const bright = prepared !== undefined || checking;
  useEffect(() => {
    if (!bright) return;
    Brightness.setBrightnessAsync(1).catch(() => {});
    return () => {
      Brightness.restoreSystemBrightnessAsync().catch(() => {});
    };
  }, [bright]);

  const start = async () => {
    setDrawing(true);
    setProgress('');
    try {
      const result = await prepare(config, (done, total) => setProgress(`drawing ${done} of ${total}`), () =>
        performance.now(),
      );
      setProgress('');
      setPrepared(result);
    } catch (error) {
      setProgress(error instanceof Error ? error.message : String(error));
    } finally {
      setDrawing(false);
    }
  };

  // Drawing can take a while, so nothing else can be tapped until it finishes.
  if (drawing) {
    return (
      <View style={styles.drawing}>
        <Text style={styles.drawingText}>{progress || 'drawing'}</Text>
      </View>
    );
  }
  if (checking) return <CheckSymbol onStop={() => setChecking(false)} />;
  if (prepared) return <Flasher config={config} prepared={prepared} onStop={() => setPrepared(undefined)} />;

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Chips label="QR version" options={VERSIONS} value={version as (typeof VERSIONS)[number]} onChange={setVersion} />
      <Chips label="Error correction" options={LEVELS} value={errorCorrection} onChange={setLevel} />
      <Chips label="Frames per second" options={RATES} value={fps as (typeof RATES)[number]} onChange={setFps} />
      <Chips label="Payload (KB)" options={SIZES_KB} value={sizeKb as (typeof SIZES_KB)[number]} onChange={setSizeKb} />
      <Chips label="Renderer" options={RENDERERS} value={renderer} onChange={setRenderer} />
      <Button label="Start" onPress={start} />
      <Button label="Show scanner check" onPress={() => setChecking(true)} />
      <Button label="Back" onPress={onBack} />
      <Text>{progress}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, paddingTop: 48 },
  flash: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  drawing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  drawingText: { fontSize: 18 },
  stats: { marginTop: 16, color: '#444', textAlign: 'center', fontSize: 12 },
});
