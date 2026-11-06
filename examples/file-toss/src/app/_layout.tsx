import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColors } from '@/components/theme';

export default function RootLayout() {
  const colors = useColors();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'File Toss' }} />
        <Stack.Screen name="send" options={{ title: 'Send a file' }} />
        <Stack.Screen name="receive" options={{ title: 'Receive a file' }} />
        <Stack.Screen name="transfer/[id]" options={{ title: 'Transfer' }} />
        <Stack.Screen name="about" options={{ title: 'About' }} />
      </Stack>
    </>
  );
}
