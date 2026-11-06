import Constants from 'expo-constants';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useColors } from '@/components/theme';
import { formatSize } from '@/lib/estimate';
import { MAX_FILE_BYTES } from '@/lib/settings';

export default function AboutScreen() {
  const colors = useColors();
  const heading = [styles.heading, { color: colors.text }];
  const body = [styles.body, { color: colors.muted }];
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={heading}>How it works</Text>
      <Text style={body}>
        The sending phone flashes a loop of QR codes, and the receiving phone reads them with its camera. Each loop
        repeats everything, so missing a code only means waiting for it to come round again. The file is checked
        when it's complete.
      </Text>

      <Text style={heading}>Privacy</Text>
      <Text style={body}>
        File Toss has no internet access: Android doesn't give it the permission. Your files never leave the two
        phones. They aren't encrypted, though, so anyone who can see the screen while it flashes can read the file.
        Send anything private somewhere nobody can film it.
      </Text>

      <Text style={heading}>Files you receive</Text>
      <Text style={body}>
        They stay inside File Toss until you save or share them, and the app never opens them. Treat them as you
        would a file from a stranger's USB stick, unless you know the sender.
      </Text>

      <Text style={heading}>Limits</Text>
      <Text style={body}>
        Up to {formatSize(MAX_FILE_BYTES)}. Expect a few KB a second for photos and other compressed files, and more
        for text. Pause whenever you like: the receiver keeps what's arrived, even if the app closes.
      </Text>

      <Text style={body}>Version {Constants.expoConfig?.version}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 10 },
  heading: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  body: { fontSize: 15, lineHeight: 22 },
});
