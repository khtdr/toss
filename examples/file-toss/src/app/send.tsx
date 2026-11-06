import { TossSymbol, useTossSend } from 'expo-toss';
import { File } from 'expo-file-system';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/components/theme';
import { Button, Loading, Notice } from '@/components/ui';
import { EFFORT_ADVICE, effortOf, formatDuration, formatRange, formatSize, planTransfer } from '@/lib/estimate';
import type { Plan } from '@/lib/estimate';
import { deleteEntryFiles, outgoingFile } from '@/lib/files';
import { nameToKind, safeMime, sanitizeFilename } from '@/lib/filename';
import { LINK, MAX_FILE_BYTES, SEND_SETTINGS } from '@/lib/settings';
import { history, newId } from '@/lib/store';

type Params = { id?: string; uri?: string; name?: string; mime?: string };

interface Source {
  /** Set when this carries on from the history. */
  id: string | null;
  file: File;
  name: string;
  mime: string;
  position: number;
  activeMs: number;
}

function sourceFrom(params: Params): Source | null {
  if (params.id) {
    const entry = history.get(params.id);
    if (!entry) return null;
    const { id, name, mime, position, activeMs } = entry;
    return { id, file: outgoingFile(id), name, mime, position, activeMs };
  }
  if (!params.uri) return null;
  return {
    id: null,
    file: new File(params.uri),
    name: sanitizeFilename(params.name ?? ''),
    mime: safeMime(params.mime),
    position: 0,
    activeMs: 0,
  };
}

interface Loaded {
  bytes: Uint8Array;
  plan: Plan;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve));

export default function SendScreen() {
  const params = useLocalSearchParams<Params>();
  const [source] = useState(() => sourceFrom(params));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(source ? null : 'This file is no longer here.');
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    let stale = false;
    const load = async () => {
      if (!source.file.exists) throw new Error('This file is no longer here.');
      if (source.file.size > MAX_FILE_BYTES) {
        throw new Error(`This file is ${formatSize(source.file.size)}. The most File Toss can send is ${formatSize(MAX_FILE_BYTES)}.`);
      }
      const bytes = await source.file.bytes();
      await nextTask();
      if (!stale) setLoaded({ bytes, plan: planTransfer(bytes, LINK) });
    };
    load().catch((error: unknown) => {
      if (!stale) setProblem(error instanceof Error ? error.message : "Couldn't read this file.");
    });
    return () => {
      stale = true;
    };
  }, [source]);

  // A file picked here is a temporary copy. Starting moves it, and otherwise it isn't needed.
  const started = useRef(false);
  useEffect(
    () => () => {
      if (source?.id === null && !started.current && source.file.exists) source.file.delete();
    },
    [source],
  );

  const start = async () => {
    if (!source || !loaded) return;
    started.current = true;
    const now = Date.now();
    try {
      if (source.id) {
        history.update(source.id, { status: 'active' }, now);
        setActiveId(source.id);
        return;
      }
      const id = newId();
      await source.file.move(outgoingFile(id));
      history.add({
        id,
        direction: 'sent',
        name: source.name,
        mime: source.mime,
        size: loaded.bytes.length,
        status: 'active',
        startedAt: now,
        updatedAt: now,
        activeMs: 0,
        session: null,
        received: 0,
        total: 0,
        position: 0,
      });
      setActiveId(id);
    } catch (error) {
      console.warn('Could not keep a copy of the file', error);
      started.current = false;
      setProblem("Couldn't get this file ready. The phone may be short of space.");
    }
  };

  if (problem) return <Problem message={problem} />;
  if (!source || !loaded) return <Loading label="Reading the file" />;
  if (activeId === null) {
    return <Review source={source} loaded={loaded} onStart={() => void start()} />;
  }
  return <Flashing id={activeId} source={source} loaded={loaded} />;
}

function Problem({ message }: { message: string }) {
  const colors = useColors();
  return (
    <View style={styles.centered}>
      <Text style={[styles.title, { color: colors.text }]}>Couldn't send this</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{message}</Text>
      <Button label="Back" kind="plain" onPress={() => router.back()} />
    </View>
  );
}

function Review({ source, loaded, onStart }: { source: Source; loaded: Loaded; onStart: () => void }) {
  const colors = useColors();
  const { time } = loaded.plan;
  const resuming = source.id !== null;
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.fill}>
      <ScrollView contentContainerStyle={styles.review}>
        <View>
          <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>
            {source.name}
          </Text>
          <Text style={[styles.body, { color: colors.muted }]}>{formatSize(loaded.bytes.length)}</Text>
        </View>

        <View>
          <Text style={[styles.label, { color: colors.muted }]}>
            {resuming ? 'A whole transfer would take' : 'Expect this to take'}
          </Text>
          <Text style={[styles.time, { color: colors.text }]}>{formatRange(time)}</Text>
          <Text style={[styles.body, { color: colors.muted }]}>
            {resuming
              ? "The other phone keeps what it already has, so this should take less. Tap Receive there and point it at this screen."
              : 'Held steady at close range. A shaky hand or a bright room can take longer.'}
          </Text>
        </View>

        <Notice>{EFFORT_ADVICE[effortOf(time)]}</Notice>
        <Text style={[styles.small, { color: colors.muted }]}>
          There's no encryption. Anyone who can see the screen while it flashes can read this file.
        </Text>
      </ScrollView>
      <View style={styles.footer}>
        <Button label={resuming ? 'Resume' : 'Start'} onPress={onStart} />
      </View>
    </SafeAreaView>
  );
}

function elapsedMs({ activeMs, sittingFrom }: { activeMs: number; sittingFrom: number | null }): number {
  return activeMs + (sittingFrom === null ? 0 : performance.now() - sittingFrom);
}

function Flashing({ id, source, loaded }: { id: string; source: Source; loaded: Loaded }) {
  const options = useMemo(
    () => ({
      ...SEND_SETTINGS,
      mime: source.mime,
      kind: nameToKind(source.name),
      compress: loaded.plan.compress,
      startPosition: source.position,
    }),
    [source, loaded],
  );
  const send = useTossSend(loaded.bytes, options);
  const [room, setRoom] = useState(0);
  const [seconds, setSeconds] = useState(source.activeMs / 1000);
  const finished = useRef(false);

  const measure = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    setRoom(Math.min(layout.width, layout.height));
  };

  // Read by listeners and cleanups, which would otherwise see an old render.
  const latest = useRef({ position: source.position, activeMs: source.activeMs, sittingFrom: null as number | null });
  useEffect(() => {
    latest.current.position = send.stats.position;
  }, [send.stats.position]);

  const save = (status?: 'active' | 'paused' | 'done') => {
    const { position } = latest.current;
    history.update(id, { position, activeMs: elapsedMs(latest.current), ...(status ? { status } : {}) }, Date.now());
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  const sending = send.status === 'sending';
  useEffect(() => {
    if (!sending) return;
    const state = latest.current;
    state.sittingFrom = performance.now();
    const timer = setInterval(() => setSeconds(elapsedMs(state) / 1000), 1000);
    return () => {
      clearInterval(timer);
      state.activeMs = elapsedMs(state);
      state.sittingFrom = null;
    };
  }, [sending]);

  // The system can close a backgrounded app without warning.
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') saveRef.current();
    });
    return () => {
      appState.remove();
      if (!finished.current) saveRef.current('paused');
    };
  }, []);

  const pause = () => {
    send.pause();
    save('paused');
  };
  const resume = () => {
    send.resume();
    save('active');
  };
  const finish = () => {
    finished.current = true;
    send.cancel();
    save('done');
    const entry = history.get(id);
    if (entry) deleteEntryFiles(entry);
    router.back();
  };

  const { time } = loaded.plan;

  return (
    <SafeAreaView style={styles.flashing}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.stage} onLayout={measure}>
        {send.status === 'sending' && send.symbol && room > 0 && <TossSymbol symbol={send.symbol} maxSide={room} />}
        {send.status === 'preparing' && <Loading label="Preparing" />}
        {send.status === 'paused' && <Text style={styles.flashTitle}>Paused</Text>}
      </View>
      <View style={styles.panel}>
        {send.status === 'failed' ? (
          <>
            <Text style={styles.flashTitle}>Couldn't send this</Text>
            <Text style={styles.flashDetail}>{send.error?.message}</Text>
            <Button label="Back" kind="plain" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Text numberOfLines={1} style={styles.flashTitle}>
              {source.name}
            </Text>
            <Text style={styles.flashDetail}>
              {send.status === 'paused'
                ? 'The other phone keeps what it has. Pause it there too, and you can close this app.'
                : `${seconds < 5 ? 'Just started' : `${formatDuration(seconds)} so far`}, expect ${formatRange(time)} in all. Loop ${send.stats.loops + 1}.`}
            </Text>
            <View style={styles.actions}>
              {send.status === 'paused' ? (
                <Button label="Resume" onPress={resume} style={styles.action} />
              ) : (
                <Button
                  label="Pause"
                  kind="plain"
                  disabled={send.status !== 'sending'}
                  onPress={pause}
                  style={styles.action}
                />
              )}
              <Button label="Other phone has it" kind="plain" onPress={finish} style={styles.finish} />
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

// The flashing screen stays white in dark mode: the code needs contrast around it.
const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  review: { padding: 20, gap: 24 },
  footer: { padding: 16 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 14 },
  time: { fontSize: 34, fontWeight: '700', marginVertical: 4 },
  flashing: { flex: 1, backgroundColor: '#fff' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { minHeight: 148, padding: 16, gap: 8 },
  flashTitle: { color: '#1B1F3B', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  flashDetail: { color: '#5C6079', fontSize: 14, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  action: { flex: 1 },
  finish: { flex: 1.4 },
});
