import { Pressable, StyleSheet, Text, View } from 'react-native';

export function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

interface ChipsProps<T> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}

export function Chips<T extends string | number>({ label, options, value, onChange }: ChipsProps<T>) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => (
          <Pressable
            key={option}
            style={[styles.chip, option === value && styles.chipOn]}
            onPress={() => onChange(option)}
          >
            <Text style={option === value ? styles.chipTextOn : styles.chipText}>{option}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, marginVertical: 6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  group: { marginVertical: 6 },
  label: { fontSize: 13, color: '#555', marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: '#bbb', borderRadius: 6, paddingVertical: 7, paddingHorizontal: 11 },
  chipOn: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#111' },
  chipTextOn: { color: '#fff' },
});
