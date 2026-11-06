import path from 'node:path';
import { defineConfig } from 'vitest/config';

const shims = path.resolve(import.meta.dirname, 'test/shims.tsx');
const native = [
  'expo-brightness',
  'expo-camera',
  'expo-document-picker',
  'expo-file-system',
  'expo-keep-awake',
  'expo-router',
  'expo-sharing',
  'expo-status-bar',
  'react-native',
  'react-native-safe-area-context',
];

export default defineConfig({
  resolve: {
    alias: [
      // Screens run for real. Only the native modules beneath them are stood in for.
      ...native.map((name) => ({ find: new RegExp(`^${name}$`), replacement: shims })),
      { find: /^expo-toss$/, replacement: path.resolve(import.meta.dirname, 'test/expo-toss.ts') },
      { find: /^@\//, replacement: `${path.resolve(import.meta.dirname, 'src')}/` },
      // The test renderer sits in the root node_modules, so it needs the root's React.
      { find: /^react$/, replacement: path.resolve(import.meta.dirname, '../../node_modules/react') },
    ],
  },
});
