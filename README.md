# toss

Toss data from one device to another across the air gap. No network, no accounts, no pairing.

The sender's screen flashes a looping sequence of QR codes. The receiver points a camera at it, watches progress, and gets the data. The same core could later work over other carriers (e.g. modem-like sounds).

## Final form

1. I'm in my app. I tap **Share**. The app does whatever it wants (confirm, pick data, etc.).
2. My phone starts flashing QR codes rapidly.
3. My buddy taps **Receive** in his copy of the app and points his camera at my phone.
4. He sees progress, then "done". We both hit back.
5. His app now has the data (a theme, a file, a config, anything) and uses it however it likes.

toss doesn't care what the data is. It moves bytes plus a mime type and an app-defined `kind`.

## Layers

Each layer depends only on the ones below it.

```
4. packaging      expo-toss             Expo config plugin, permissions, one clean import
3. UI / platform  toss-react-native     camera, drawing, hooks + default components
2. carrier        toss-qr               frame <-> QR (and later: toss-audio, ...)
1. protocol       toss-core             bytes <-> frames. Knows nothing about QR.
```

### 1. `toss-core`: protocol (sans-IO)

Pure state machines. No camera, timers, sockets, or QR. Input in, state out.

```ts
const enc = new Encoder(bytes, { maxFrameBytes: 700, mime, kind })
enc.nextFrame()          // -> Uint8Array, loops forever

const dec = new Decoder()
dec.push(frame)          // -> { progress, done?, payload?, meta? }
```

- **Configurable, carrier-neutral:** frame size is a parameter. Core emits and consumes raw bytes; text codecs (e.g. base45 for QR) live in the carrier layer.
- **Header frame:** version, session ID, mime type, `kind`, total size, frame count, payload hash, compression flag.
- **Data frames:** session ID, index, payload, per-frame CRC.
- **Robustness:** tolerates duplicates, out-of-order frames, and joining mid-loop. Session ID keeps two senders from mixing.
- **Pluggable redundancy:** plain looping indexed frames, with a prime-length cycle so a phase-locked camera can't miss frames forever. The format leaves room for a fountain code, which the device spike didn't justify for now. See `docs/protocol.md`, Appendix B.
- **Untrusted input:** size and frame-count caps enforced before allocating.

### 2. `toss-qr`: carrier

Pure QR logic, with no platform I/O.

- `frameToText` / `textToFrame`: frame bytes <-> QR string (base45 for alphanumeric mode, since scanners return strings)
- `textToMatrix`: QR string -> matrix for drawing, at a fixed version so the symbol never changes size
- `maxFrameBytes` / `smallestVersion`: capacity for a given QR version and error-correction level

See `docs/qr.md`.

### 3. `toss-react-native`: platform bindings

The platform-specific I/O lives here: camera, drawing, keep-awake, brightness.

- Headless hooks: `useTossSend(data, opts)` and `useTossReceive()` (state, progress, cancel)
- Default components: `<TossSender>` and `<TossReceiver>`, built only on the public hooks
- Apps control their own confirmation and UI; components are a convenience

```tsx
// Pass null until the app is ready to send. Keep `data` stable between renders.
const send = useTossSend(data, { mime: 'application/json', kind: 'theme' })
send.symbol && <TossSymbol symbol={send.symbol} />

const receive = useTossReceive({ maxPayloadBytes: 1024 * 1024 })
<CameraView style={{ flex: 1 }} {...receive.cameraProps} />
// receive.status, .progress, .stalledMs, then .payload and .meta. Both are untrusted.
```

The components are whole screens. They handle the camera permission, preparing, progress, asking people to hold steady, and errors:

```tsx
<TossSender data={data} mime="application/json" kind="theme" onStop={close} />

<TossReceiver maxPayloadBytes={1024 * 1024} onReceive={(payload, meta) => review(payload, meta)} onCancel={close} />
```

Both hooks have `pause()` and `resume()`. A transfer can also outlast the app, with no help from core. The session ID comes from the content, so sending the same data again is the same session. A receiver keeps each frame from `onFrame`, then gives them to `restore` in a later run. A sender saves `stats.position`, then passes it back as `startPosition`.

`SendSession` and `ReceiveSession` hold the logic and take the clock as an argument, so tests need no device. The hooks connect them to the platform. Each new symbol goes straight to `TossSymbol`, so the calling screen doesn't re-render at the frame rate.

### 4. `expo-toss`: packaging

Thin by design. It re-exports the layer 3 API and adds a config plugin. An app installs it with the native modules it peer-depends on, which have to be the app's own dependencies for autolinking:

```sh
npm install expo-toss
npx expo install expo-camera expo-brightness expo-keep-awake @shopify/react-native-skia react-native-safe-area-context
```

```json
{ "expo": { "plugins": [["expo-toss", { "cameraPermission": "Optional iOS camera prompt" }]] } }
```

```ts
import { TossReceiver, TossSender } from 'expo-toss'
```

The plugin declares the camera and leaves out what toss doesn't use:

- No microphone permission on Android, and no microphone text on iOS.
- No `WRITE_SETTINGS`. Expo adds it for any app with `expo-brightness`, but toss only changes its own window's brightness. An app that calls `setSystemBrightnessAsync` itself can't use this plugin as it stands.

Don't list `expo-camera` in `plugins` as well. It only runs once, so an entry above `expo-toss` replaces these settings and one below it is ignored.

## Possible future cells

Carriers (qr, audio, ...) times frameworks (react-native, web, ...) gives one adapter per cell. Build only what's needed.

- `toss-audio`: modem-style data over sound (ggwave is worth studying)
- `toss-web`: webcam + canvas

## `toss-cli`: end-to-end harness

Encodes a file to QR PNG frames and decodes them back, so the whole path runs without a device. It isn't a layer: nothing depends on it.

```sh
npm run build
node packages/cli/dist/bin.js encode theme.json -o frames/ --mime application/json --kind theme
node packages/cli/dist/bin.js decode frames/ -o theme-copy.json
```

Each PNG holds one frame, drawn by `toss-qr`. `--frame-bytes` picks the smallest QR version that fits, and `--qr-version` fills a chosen version instead. `--loops` writes more than one cycle, so you can delete images to simulate loss. Scanning PNGs with `jsqr` stays in the CLI, because on a device the camera does that job.

## Package layout (monorepo)

```
toss/
  README.md
  packages/
    core/              toss-core
    cli/               toss-cli
    qr/                toss-qr
    react-native/      toss-react-native
    expo/              expo-toss
  examples/
    file-toss/         File Toss, a file transfer app built on all of the above
  docs/
    protocol.md        frame format spec
    qr.md              QR carrier spec
```

## Known risks

- **Throughput is camera- and display-limited, not protocol-limited.** Hand-held at version 30, level M, 10 fps, incompressible data moves at 4-9 KB/s, and compressible JSON several times faster. See `docs/qr.md`, section 4.
- **Do an early device spike** of the camera + display path to find real frame size and rate. It's the one thing unit tests can't cover.
- Screen-to-camera issues: glare, moire, exposure. Max brightness and keep-awake on the sender help.
- No back-channel: the sender can't know the receiver finished, so it loops until dismissed.
- Display and camera can phase-lock, so a capture rhythm misses the same frames every loop. The sender's prime-length cycle handles this in simulation, and the device spike saw random-looking loss, not repeated misses.

## Open questions

- Optional encryption (shared passphrase)? Currently out of scope. Anyone who can see the screen can read it. A published file transfer app makes this more pressing.
- Should File Toss get a fountain code? It now sends real files of up to 64 MiB, and files compress far less than JSON, so this question is live. See `docs/protocol.md`, Appendix B.
- iOS: everything so far has only been tested on Android.

## Roadmap

1. `toss-core`: frame format, encoder/decoder, tests with simulated loss/duplication/reordering
2. `toss-cli`: round-trip a file through PNG frames, as part of `npm test`
3. `toss-qr`: base45 codec, capacity tuning, taking over the CLI's QR code
4. Device spike: measure real camera/display throughput. Done, see `docs/qr.md`, section 4
5. `toss-react-native`: hooks, then default components. Both run on two phones
6. `expo-toss`: config plugin + packaging. Built and tested, and File Toss uses it. Not yet run on a phone
7. Wire into a real app: File Toss, in `examples/file-toss`, replacing the spike. It's both a utility and a proof of concept. Built and tested, not yet run on a phone or published

## Naming

`toss` is taken on npm (an unrelated, abandoned package), so the published names are suffixed: `toss-core`, `toss-qr`, `toss-react-native`, and `expo-toss`. These were all unclaimed when checked, so consider publishing placeholders or using a scope.
