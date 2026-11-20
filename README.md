<p align="center"><img src="docs/logo.png" alt="A page with QR finder squares, tossed along an arc" width="240"></p>

# toss

Send data between two phones with a screen and a camera. No network, no accounts, no pairing.

The sender's screen flashes a loop of QR codes. The receiver points a camera at it, watches the progress, and gets the bytes. toss is a library for Expo and React Native apps, so the send and receive screens live inside your app and you decide what the data means: a theme, a config, a document, anything.

```tsx
import { TossReceiver, TossSender } from 'expo-toss'

// On one phone
<TossSender data={bytes} mime="application/json" kind="my-app/theme" onStop={close} />

// On the other
<TossReceiver onReceive={(payload, meta) => review(payload, meta)} onCancel={close} />
```

> **Status:** works on Android, tested on two phones. iOS hasn't been tested. See [Status](#status).

## Is it right for your app?

**A good fit:**

- Moving settings, themes, saved work or small documents from one person's app to another's.
- Places with no shared network, or where you don't want one: offline, on a plane, or across an air gap.
- Apps that shouldn't need `INTERNET`, accounts or a server for this.

**Not a good fit:**

- **Secrets, unless you encrypt them yourself.** toss has no encryption. Anyone who can see the screen can read the data.
- **Trusted input.** Anyone can show a screen, and nothing proves who sent a transfer.
- **Big files.** It moves kilobytes per second. See the table below.
- **Anything that needs an answer.** Data flows one way, so the sender can't know when the receiver finished.

## How fast is it?

Measured hand-held on real phones, at the default settings. Times vary a lot with the conditions, and each row has only a few runs.

| Payload | Time | Speed |
|---|---|---|
| 50 KB JSON | 1.9 s | 26.6 KB/s |
| 200 KB JSON | 5.7 s | 34.8 KB/s |
| 166 KB PDF | 30 s | 5.5 KB/s |
| 50 KB of random bytes | 8-12 s | 4-6 KB/s |
| 1 MB of random bytes | 4 min 15 s | 4 KB/s |

Compression is why JSON is so much faster, and the test JSON was synthetic, so real JSON may compress less. Data that's already compressed, like most PDFs and photos, moves at about 4-6 KB/s. The full results are in [`docs/qr.md`, section 4](docs/qr.md#4-device-spike-results).

## Quick start

Install `expo-toss` and the native modules it uses. They have to be your app's own dependencies, so that autolinking finds them.

```sh
npm install expo-toss
npx expo install expo-camera expo-brightness expo-keep-awake @shopify/react-native-skia react-native-safe-area-context
```

Add the config plugin to `app.json`, then make a new native build. Don't list `expo-camera` here as well.

```json
{ "expo": { "plugins": ["expo-toss"] } }
```

Add a screen for each side. These two components are whole screens: they handle the camera permission, progress, asking people to hold steady, and errors.

```tsx
import { useMemo } from 'react'
import { TossReceiver, TossSender } from 'expo-toss'

function ShareTheme({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  // Keep the bytes stable between renders. New bytes are a new transfer.
  const data = useMemo(() => new TextEncoder().encode(JSON.stringify(theme)), [theme])
  return <TossSender data={data} mime="application/json" kind="my-app/theme" onStop={onClose} />
}

function ReceiveTheme({ onTheme, onClose }: { onTheme: (theme: Theme) => void; onClose: () => void }) {
  return (
    <TossReceiver
      maxPayloadBytes={1024 * 1024}
      onReceive={(payload, meta) => {
        // Everything here came from a stranger's screen, so check it before using it.
        if (meta.kind !== 'my-app/theme') return
        const theme = parseTheme(new TextDecoder().decode(payload))
        if (theme) onTheme(theme)
      }}
      onCancel={onClose}
    />
  )
}
```

The sender keeps looping until someone presses Stop, because it can't tell when the receiver has finished.

## What you get

- **Ready-made screens or headless hooks.** `TossSender` and `TossReceiver` are built only on `useTossSend` and `useTossReceive`, which you can use to build your own UI.
- **A receiver that can join at any time.** It tolerates missed, repeated and out-of-order frames, and ignores other QR codes in view. A hash checks the finished payload.
- **Pause and resume**, on both sides, including after the app is killed.
- **Compression**, used only when it makes the transfer smaller.
- **Limits you control.** Size and frame-count caps apply before anything is allocated.
- **Few permissions.** toss only needs the camera, and the plugin removes the microphone and `WRITE_SETTINGS`.

[File Toss](examples/file-toss) is a complete app built on toss, and the best example of it in real use. It sends files between phones, with estimates, history and resuming.

## Documentation

| | |
|---|---|
| **[Guide](docs/guide.md)** | Building toss into an app: custom UI, untrusted data, resuming, tuning, permissions, troubleshooting, testing |
| **[API reference](packages/react-native/README.md)** | Hooks, components, options and states |
| **[Architecture](docs/architecture.md)** | The four layers, and how a transfer works |
| **[Protocol spec](docs/protocol.md)** | The frame format, for anyone writing another implementation |
| **[QR carrier spec](docs/qr.md)** | How frames become QR symbols, and the measurements from real phones |
| **[Roadmap](docs/roadmap.md)** | What's planned, known risks and open questions |
| **[Contributing](CONTRIBUTING.md)** | Building and testing this repo |

## Packages

Most apps need only `expo-toss`.

| Package | npm | Use it for |
|---|---|---|
| [`expo-toss`](packages/expo) | [expo-toss](https://www.npmjs.com/package/expo-toss) | Expo apps. The config plugin, and everything in `toss-react-native` in one import |
| [`toss-react-native`](packages/react-native) | [toss-react-native](https://www.npmjs.com/package/toss-react-native) | The hooks and components, without the config plugin |
| [`toss-qr`](packages/qr) | [toss-qr](https://www.npmjs.com/package/toss-qr) | Turning frames into QR symbols and back, on any platform |
| [`toss-core`](packages/core) | [toss-core](https://www.npmjs.com/package/toss-core) | The protocol alone, to build a different carrier. It knows nothing about QR |

## Status

| | |
|---|---|
| Android | Works. Tested on a Galaxy S21 and a Pixel 10 Pro |
| iOS | Not tested. Its scanner is different, so it needs its own measurements |
| Expo | SDK 58 or later. Only tested in native builds, not Expo Go |
| React Native without Expo | Needs Expo Modules, for `expo-camera`, `expo-brightness` and `expo-keep-awake` |
| npm | Published |
| Largest transfer on real phones | 1 MB. Larger ones should work but haven't been tried |

The wire format is version 1. The JavaScript API is at 0.x, so it may still change between minor versions.

## Licence

[MIT](LICENSE)
