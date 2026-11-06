import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ReceiveScreen } from './src/ReceiveScreen';
import { SendScreen } from './src/SendScreen';
import { Button } from './src/ui';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'send' | 'receive'>('home');
  const home = () => setScreen('home');

  if (screen === 'send') return <SendScreen onBack={home} />;
  if (screen === 'receive') return <ReceiveScreen onBack={home} />;
  return (
    <View style={styles.home}>
      <StatusBar style="auto" />
      <Text style={styles.title}>toss spike</Text>
      <Button label="Send" onPress={() => setScreen('send')} />
      <Button label="Receive" onPress={() => setScreen('receive')} />
    </View>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
});
