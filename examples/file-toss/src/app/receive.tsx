import { CameraView } from 'expo-camera';
import { router } from 'expo-router';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/components/theme';
import { Button, Loading, Notice, ProgressBar } from '@/components/ui';
import { EFFORT_ADVICE, formatDuration, formatSize } from '@/lib/estimate';
import { saveReceived, shareReceived } from '@/lib/files';
import { MAX_FILE_BYTES } from '@/lib/settings';
import { useFileReceive } from '@/lib/use-file-receive';

/** Long enough that ordinary gaps between new blocks don't set it off. */
const HOLD_STEADY_AFTER_MS = 2000;
/** Past this share of the blocks, a long wait is normal: the loop has to come back round. */
const NEARLY_DONE = 0.9;

function failureMessage(error: string | undefined): string {
  switch (error) {
    case 'payload-too-large':
    case 'too-many-frames':
      return `This file is bigger than the ${formatSize(MAX_FILE_BYTES)} File Toss accepts.`;
    case 'unsupported-compression':
    case 'unsupported-redundancy':
      return 'The other phone has a newer version of File Toss.';
    default:
      return 'The file arrived damaged, so it was thrown away.';
  }
}

export default function ReceiveScreen() {
  const colors = useColors();
  const transfer = useFileReceive();
  const { receive, entry, restoring, saved, saveFailed, secondsLeft, effort } = transfer;
  const { status, permission, progress } = receive;
  const { received, total } = progress;

  if (!permission) return <Loading label="Starting" />;

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: colors.text }]}>The camera reads the other phone's screen</Text>
        <Text style={[styles.body, { color: colors.muted }]}>Nothing it sees is recorded or leaves this phone.</Text>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={() => void receive.requestPermission()} />
        ) : (
          <Button label="Open settings" onPress={() => void Linking.openSettings()} />
        )}
      </View>
    );
  }

  if (status === 'done') {
    const run = (action: () => Promise<unknown>) => {
      action().catch(() => Alert.alert("That didn't work", 'The file is still safe in File Toss.'));
    };
    return (
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.finished}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {entry?.name ?? 'File'}
        </Text>
        <Text style={[styles.body, { color: colors.muted }]}>
          {saved
            ? `Received ${entry ? formatSize(entry.size) : ''} and checked against the sender's hash. You can stop the other phone.`
            : 'Saving'}
        </Text>
        {saveFailed && <Notice>Couldn't save the file. The phone may be short of space.</Notice>}
        {saveFailed && <Button label="Try again" onPress={() => void transfer.retrySave()} />}
        {saved && entry && (
          <>
            <Notice>This came from someone else's phone. Only open it if you trust them.</Notice>
            <Button label="Save to a folder" onPress={() => run(() => saveReceived(entry))} />
            <Button label="Share" kind="plain" onPress={() => run(() => shareReceived(entry))} />
            <Button label="Receive another" kind="plain" onPress={transfer.startOver} />
          </>
        )}
      </SafeAreaView>
    );
  }

  if (status === 'failed') {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: colors.text }]}>Transfer failed</Text>
        <Text style={[styles.body, { color: colors.muted }]}>{failureMessage(receive.error)}</Text>
        <Button label="Try again" onPress={transfer.startOver} />
      </View>
    );
  }

  const share = total ? received / total : 0;
  const percent = Math.floor(share * 100);

  if (status === 'paused') {
    const discard = () => {
      Alert.alert('Throw this away?', `You'd lose the ${percent}% that's arrived.`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Throw away', style: 'destructive', onPress: () => void transfer.discard() },
      ]);
    };
    return (
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.finished}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {entry?.name ?? 'Paused'}
        </Text>
        <ProgressBar share={share} />
        <Text style={[styles.body, { color: colors.muted }]}>
          Paused at {percent}%. What's arrived is saved, so you can close the app. To carry on later, open this
          screen and point it at the same file on the other phone.
        </Text>
        <Button label="Resume" onPress={transfer.resume} />
        <Button label="Back to history" kind="plain" onPress={() => router.back()} />
        {entry && <Button label="Throw away" kind="danger" onPress={discard} />}
      </SafeAreaView>
    );
  }

  const stalled = receive.stalledMs >= HOLD_STEADY_AFTER_MS && total !== null;
  const senderChanged = receive.otherSessionFrames > 0;

  let hint = '';
  if (senderChanged) hint = 'The other phone is showing a different file.';
  else if (restoring) hint = 'Picking up where you left off';
  else if (stalled) {
    hint = share >= NEARLY_DONE ? 'Hold steady. The last few blocks can take a while.' : 'Hold steady, with the whole code in view.';
  } else if (effort === 'sore-arm' || effort === 'marathon') hint = EFFORT_ADVICE[effort];

  // The panel keeps its height as messages come and go, so the preview doesn't
  // move while someone is aiming it.
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.fill}>
      <CameraView style={styles.fill} {...receive.cameraProps} />
      <View style={styles.panel}>
        <Text numberOfLines={1} style={[styles.panelTitle, { color: colors.text }]}>
          {entry?.name ?? "Point the camera at the other phone's code"}
        </Text>
        <ProgressBar share={share} />
        <Text style={[styles.detail, { color: colors.muted }]}>
          {entry
            ? `${percent}% of ${formatSize(entry.size)}${secondsLeft !== null ? `, about ${formatDuration(secondsLeft)} left` : ''}`
            : 'Hold it so the code fills most of the view.'}
        </Text>
        <Text numberOfLines={3} style={[styles.hint, { color: colors.muted }]}>
          {hint}
        </Text>
        <View style={styles.actions}>
          {senderChanged && (
            <Button label="Switch to it" onPress={() => void transfer.switchTransfer()} style={styles.action} />
          )}
          <Button label="Pause" kind="plain" onPress={transfer.pause} style={styles.action} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  finished: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  panel: { height: 232, padding: 16, gap: 8 },
  panelTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  detail: { fontSize: 14, textAlign: 'center' },
  hint: { fontSize: 14, textAlign: 'center', minHeight: 60 },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1 },
});
