import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/components/theme';
import { Button, Notice, ProgressBar } from '@/components/ui';
import { formatDuration, formatSize } from '@/lib/estimate';
import { deleteEntryFiles, saveReceived, shareReceived } from '@/lib/files';
import type { HistoryEntry } from '@/lib/history';
import { history, useEntry } from '@/lib/store';

function Fact({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.fact}>
      <Text style={{ color: colors.muted }}>{label}</Text>
      <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function statusText({ status, direction }: HistoryEntry): string {
  if (status === 'failed') return 'Failed';
  if (status === 'done') return direction === 'sent' ? 'Sent' : 'Received and checked';
  return 'Paused';
}

export default function TransferScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const entry = useEntry(id);

  if (!entry) {
    return (
      <View style={styles.page}>
        <Text style={{ color: colors.muted }}>This transfer is gone.</Text>
      </View>
    );
  }

  const unfinished = entry.status === 'paused' || entry.status === 'active';
  const receivedFile = entry.direction === 'received' && entry.status === 'done';
  const run = (action: () => Promise<unknown>) => {
    action().catch(() => Alert.alert("That didn't work", 'The file is still safe in File Toss.'));
  };

  const remove = () => {
    const what = unfinished
      ? "You won't be able to resume it."
      : receivedFile
        ? 'This deletes the file from File Toss. Copies you saved or shared stay.'
        : 'This only clears the entry.';
    Alert.alert('Delete this?', what, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteEntryFiles(entry);
          history.remove(entry.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={[styles.title, { color: colors.text }]}>{entry.name}</Text>
      {unfinished && entry.total > 0 && <ProgressBar share={entry.received / entry.total} />}

      <View style={[styles.facts, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Fact label="Status" value={statusText(entry)} />
        <Fact label="Size" value={formatSize(entry.size)} />
        <Fact label="Type" value={entry.mime} />
        <Fact label="Started" value={new Date(entry.startedAt).toLocaleString()} />
        {entry.activeMs >= 1000 && <Fact label="Time taken" value={formatDuration(entry.activeMs / 1000)} />}
      </View>

      {unfinished && entry.direction === 'sent' && (
        <Button
          label="Resume sending"
          onPress={() => router.replace({ pathname: '/send', params: { id: entry.id } })}
        />
      )}
      {unfinished && entry.direction === 'received' && (
        <>
          <Notice>Start this file again on the other phone, then point the camera at it.</Notice>
          <Button label="Resume receiving" onPress={() => router.replace('/receive')} />
        </>
      )}
      {receivedFile && (
        <>
          <Notice>This came from someone else's phone. Only open it if you trust them.</Notice>
          <Button label="Save to a folder" onPress={() => run(() => saveReceived(entry))} />
          <Button label="Share" kind="plain" onPress={() => run(() => shareReceived(entry))} />
        </>
      )}
      <Button label="Delete" kind="danger" onPress={remove} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  title: { fontSize: 22, fontWeight: '700' },
  facts: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  value: { flexShrink: 1, textAlign: 'right', fontWeight: '500' },
});
