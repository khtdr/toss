import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useColors } from './theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'plain' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, kind = 'primary', disabled, style }: ButtonProps) {
  const colors = useColors();
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: colors.accent }
          : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
        (pressed || disabled) && styles.dimmed,
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          { color: primary ? colors.onAccent : kind === 'danger' ? colors.danger : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ProgressBar({ share }: { share: number }) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
      style={[styles.track, { backgroundColor: colors.border }]}
    >
      <View style={[styles.bar, { backgroundColor: colors.accent, width: `${share * 100}%` }]} />
    </View>
  );
}

/** Something people should read before they start. */
export function Notice({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.notice, { backgroundColor: colors.warning }]}>
      <Text style={[styles.noticeText, { color: colors.onWarning }]}>{children}</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={{ color: colors.muted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  dimmed: { opacity: 0.6 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8 },
  notice: { borderRadius: 12, padding: 14 },
  noticeText: { fontSize: 15, lineHeight: 21 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
