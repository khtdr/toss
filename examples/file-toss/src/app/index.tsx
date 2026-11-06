import * as DocumentPicker from 'expo-document-picker';
import { Link, router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/components/theme';
import { Button, ProgressBar } from '@/components/ui';
import { formatSize } from '@/lib/estimate';
import { displayOrder } from '@/lib/history';
import type { HistoryEntry } from '@/lib/history';
import { useHistory } from '@/lib/store';

async function pickAndSend() {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return;
  router.push({
    pathname: '/send',
    params: { uri: asset.uri, name: asset.name, mime: asset.mimeType ?? '' },
  });
}

function when(time: number): string {
  const date = new Date(time);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function statusLabel(entry: HistoryEntry): string {
  if (entry.status === 'failed') return 'Failed';
  if (entry.status === 'done') return entry.direction === 'sent' ? 'Sent' : 'Received';
  if (entry.direction === 'sent' || entry.total === 0) return 'Paused';
  return `Paused at ${Math.floor((entry.received / entry.total) * 100)}%`;
}

function Row({ entry }: { entry: HistoryEntry }) {
  const colors = useColors();
  const unfinished = entry.status === 'paused' || entry.status === 'active';
  const showBar = unfinished && entry.direction === 'received' && entry.total > 0;
  return (
    <Link href={{ pathname: '/transfer/[id]', params: { id: entry.id } }} asChild>
      <Pressable style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text accessibilityLabel={entry.direction} style={[styles.arrow, { color: colors.accent }]}>
          {entry.direction === 'sent' ? '↑' : '↓'}
        </Text>
        <View style={styles.rowBody}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
            {entry.name}
          </Text>
          <Text style={{ color: unfinished ? colors.accent : colors.muted }}>
            {statusLabel(entry)} · {formatSize(entry.size)} · {when(entry.updatedAt)}
          </Text>
          {showBar && <ProgressBar share={entry.received / entry.total} />}
        </View>
      </Pressable>
    </Link>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const { bottom } = useSafeAreaInsets();
  const entries = useHistory();
  const ordered = useMemo(() => displayOrder(entries), [entries]);

  return (
    <FlatList
      data={ordered}
      keyExtractor={(entry) => entry.id}
      renderItem={({ item }) => <Row entry={item} />}
      contentContainerStyle={[styles.list, { paddingBottom: bottom + 16 }]}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.tagline, { color: colors.muted }]}>
            Phone to phone through the camera. No network, no accounts.
          </Text>
          <View style={styles.actions}>
            <Button label="Send" onPress={() => void pickAndSend()} style={styles.action} />
            <Button label="Receive" onPress={() => router.push('/receive')} style={styles.action} />
          </View>
          {ordered.length > 0 && <Text style={[styles.heading, { color: colors.text }]}>History</Text>}
        </View>
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: colors.muted }]}>Files you send and receive will show up here.</Text>
      }
      ListFooterComponent={
        <Link href="/about" style={[styles.about, { color: colors.muted }]}>
          About File Toss
        </Link>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  header: { gap: 16, marginBottom: 6 },
  tagline: { fontSize: 15 },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1 },
  heading: { fontSize: 18, fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1 },
  arrow: { fontSize: 22, fontWeight: '700', width: 22, textAlign: 'center' },
  rowBody: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: '600' },
  empty: { textAlign: 'center', paddingVertical: 32 },
  about: { textAlign: 'center', paddingVertical: 20 },
});
