import { mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';
import { compileModsAsync } from 'expo/config-plugins';

const fixture = join(import.meta.dirname, 'fixture');
const roots: string[] = [];

type Plugins = (string | [string, Record<string, unknown>])[];
type Permission = { $: Record<string, string> };

/** Runs Expo's real prebuild pipeline, automatic plugins included, without writing native projects. */
async function prebuild(plugins: Plugins, android: Record<string, unknown> = {}) {
  // Inside the package, so expo-toss and its peers resolve as they would from an app.
  const root = await mkdtemp(join(fixture, '../.run-'));
  roots.push(root);
  await cp(join(fixture, 'package.json'), join(root, 'package.json'));
  const expo = { name: 'fixture', slug: 'fixture', version: '1.0.0', plugins, android: { package: 'test.fixture', ...android }, ios: { bundleIdentifier: 'test.fixture' } };
  await writeFile(join(root, 'app.json'), JSON.stringify({ expo }));

  const { exp } = await getPrebuildConfigAsync(root, { platforms: ['android', 'ios'] });
  const result = await compileModsAsync(exp, { projectRoot: root, introspect: true, platforms: ['android', 'ios'], assertMissingModProviders: false });
  const mods = result._internal!.modResults;
  const entries: Permission[] = mods.android.manifest.manifest['uses-permission'] ?? [];
  return {
    infoPlist: mods.ios.infoPlist as Record<string, string>,
    declared: entries.filter((p) => p.$['tools:node'] !== 'remove').map((p) => p.$['android:name']),
    removed: entries.filter((p) => p.$['tools:node'] === 'remove').map((p) => p.$['android:name']),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('expo-toss config plugin', () => {
  it('declares the camera and nothing for audio', async () => {
    const { declared, infoPlist } = await prebuild(['expo-toss']);
    expect(declared).toContain('android.permission.CAMERA');
    expect(declared).not.toContain('android.permission.RECORD_AUDIO');
    expect(infoPlist.NSCameraUsageDescription).toContain('read codes');
    expect(infoPlist).not.toHaveProperty('NSMicrophoneUsageDescription');
  });

  it('removes WRITE_SETTINGS, which expo-brightness adds automatically', async () => {
    const without = await prebuild([]);
    expect(without.declared).toContain('android.permission.WRITE_SETTINGS');

    const { declared, removed } = await prebuild(['expo-toss']);
    expect(declared).not.toContain('android.permission.WRITE_SETTINGS');
    expect(removed).toContain('android.permission.WRITE_SETTINGS');
  });

  it.each<[string, Plugins]>([
    ['before', ['expo-brightness', 'expo-toss']],
    ['after', ['expo-toss', 'expo-brightness']],
  ])('removes WRITE_SETTINGS when an app lists expo-brightness %s it', async (_, plugins) => {
    const { declared, removed } = await prebuild(plugins);
    expect(declared).not.toContain('android.permission.WRITE_SETTINGS');
    expect(removed).toEqual(['android.permission.WRITE_SETTINGS']);
  });

  it('removes WRITE_SETTINGS from an app that declares it directly', async () => {
    const { declared } = await prebuild(['expo-toss'], { permissions: ['android.permission.WRITE_SETTINGS'] });
    expect(declared).not.toContain('android.permission.WRITE_SETTINGS');
  });

  it('uses the app\'s camera text', async () => {
    const { infoPlist } = await prebuild([['expo-toss', { cameraPermission: 'Scan a transfer' }]]);
    expect(infoPlist.NSCameraUsageDescription).toBe('Scan a transfer');
  });
});
