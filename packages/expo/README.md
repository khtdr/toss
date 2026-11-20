# expo-toss

[npm](https://www.npmjs.com/package/expo-toss)

Send data between two phones with a screen and a camera, in an Expo app. No network, no accounts, no pairing.

This package re-exports all of [`toss-react-native`](../react-native) and adds a config plugin for permissions. The [main README](../../README.md) explains what toss is, and whether it suits your app.

> Android works, and iOS hasn't been tested.

## Install

Needs Expo SDK 58 or later, and a native build. The native modules have to be your app's own dependencies, so that autolinking finds them.

```sh
npm install expo-toss
npx expo install expo-camera expo-brightness expo-keep-awake @shopify/react-native-skia react-native-safe-area-context
```

```json
{ "expo": { "plugins": [["expo-toss", { "cameraPermission": "Optional iOS camera prompt" }]] } }
```

Don't list `expo-camera` in `plugins` as well. It only runs once, so an entry above `expo-toss` replaces these settings, and one below it is ignored.

## What the plugin does

- Declares the camera, with your iOS prompt.
- Leaves out the microphone: no Android permission, and no iOS text.
- Blocks `WRITE_SETTINGS`, which Expo adds for any app with `expo-brightness`. toss only changes its own window's brightness. An app that calls `setSystemBrightnessAsync` itself can't use this plugin as it stands.

## Use

```tsx
import { TossReceiver, TossSender } from 'expo-toss'

<TossSender data={bytes} mime="application/json" kind="my-app/theme" onStop={close} />

<TossReceiver maxPayloadBytes={1024 * 1024} onReceive={(payload, meta) => review(payload, meta)} onCancel={close} />
```

See the [guide](../../docs/guide.md) and the [API reference](../react-native/README.md).

## Licence

MIT
