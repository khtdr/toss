import type { ReactNode } from 'react';

/** Stand-ins for native modules, so the real screens can run in Node. */

// react-native
export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';
export const ScrollView = 'ScrollView';
export const ActivityIndicator = 'ActivityIndicator';
export const StyleSheet = { create: <T,>(styles: T) => styles };
export const useColorScheme = () => 'light';
export const Linking = { openSettings: async () => {} };
export const Alert = { alert: (..._args: unknown[]) => {} };
export const AppState = {
  currentState: 'active',
  listeners: new Set<(state: string) => void>(),
  addEventListener(_type: string, listener: (state: string) => void) {
    AppState.listeners.add(listener);
    return { remove: () => AppState.listeners.delete(listener) };
  },
};

// react-native-safe-area-context
export const SafeAreaView = 'SafeAreaView';

// expo-keep-awake, expo-brightness
export const activateKeepAwakeAsync = async () => {};
export const deactivateKeepAwake = async () => {};
export const setBrightnessAsync = async () => {};
export const restoreSystemBrightnessAsync = async () => {};

// expo-camera
export const CameraView = 'CameraView';
export const camera = { granted: true };
export const useCameraPermissions = () => [
  { granted: camera.granted, canAskAgain: true },
  async () => {},
  async () => {},
];

// expo-router
export const route = { params: {} as Record<string, string> };
export const router = { back: () => {}, push: () => {}, replace: () => {} };
export const useLocalSearchParams = () => route.params;
export const Stack = { Screen: (_props: { options: object; children?: ReactNode }) => null };

// expo-sharing
export const shared: string[] = [];
export const shareAsync = async (url: string) => void shared.push(url);

// expo-file-system, in memory
export const disk = new Map<string, Uint8Array>();
export const failures = { write: false };

const uriOf = (parts: unknown[]) =>
  parts.map((part) => (typeof part === 'string' ? part : (part as { uri: string }).uri)).join('/');

export class File {
  uri: string;
  constructor(...parts: unknown[]) {
    this.uri = uriOf(parts);
  }
  get exists() {
    return disk.has(this.uri);
  }
  get size() {
    return disk.get(this.uri)?.length ?? 0;
  }
  async bytes() {
    return disk.get(this.uri)!;
  }
  textSync() {
    return new TextDecoder().decode(disk.get(this.uri));
  }
  write(content: string | Uint8Array, options: { append?: boolean } = {}) {
    if (failures.write) throw new Error('disk full');
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const old = options.append ? (disk.get(this.uri) ?? new Uint8Array(0)) : new Uint8Array(0);
    const joined = new Uint8Array(old.length + bytes.length);
    joined.set(old);
    joined.set(bytes, old.length);
    disk.set(this.uri, joined);
  }
  async move(destination: File) {
    disk.set(destination.uri, disk.get(this.uri)!);
    disk.delete(this.uri);
    this.uri = destination.uri;
  }
  delete() {
    disk.delete(this.uri);
  }
}

export class Directory {
  uri: string;
  constructor(...parts: unknown[]) {
    this.uri = uriOf(parts);
  }
  get exists() {
    return true;
  }
  create() {}
  delete() {
    for (const uri of disk.keys()) {
      if (uri.startsWith(`${this.uri}/`)) disk.delete(uri);
    }
  }
  createFile(name: string) {
    return new File(this, name);
  }
  static pickDirectoryAsync = async () => new Directory('picked');
}

export const Paths = { document: new Directory('documents') };
