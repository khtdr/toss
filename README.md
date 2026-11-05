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
- **Pluggable redundancy:** plain looping indexed frames, with a prime-length cycle so a phase-locked camera can't miss frames forever. The format leaves room for a fountain code, to be decided after the device spike. See `docs/protocol.md`, Appendix B.
- **Untrusted input:** size and frame-count caps enforced before allocating.

### 2. `toss-qr`: carrier

Pure QR logic, with no platform I/O.

- `frame bytes <-> QR string` (base45 for alphanumeric mode, since scanners return strings)
- `QR string -> matrix` for drawing
- Chooses `maxFrameBytes` for a given QR version and error-correction level

### 3. `toss-react-native`: platform bindings

The platform-specific I/O lives here: camera, drawing, keep-awake, brightness.

- Headless hooks: `useTossSend(data, opts)` and `useTossReceive()` (state, progress, cancel)
- Optional default components: `<TossSender>` and `<TossReceiver>`
- Apps control their own confirmation and UI; components are a convenience

### 4. `expo-toss`: packaging

Thin by design. Peer-depends on `expo-camera`, adds a config plugin for permission strings, and re-exports the layer 3 API as one import.

```ts
import Toss from 'expo-toss'
```

## Possible future cells

Carriers (qr, audio, ...) times frameworks (react-native, web, ...) gives one adapter per cell. Build only what's needed.

- `toss-audio`: modem-style data over sound (ggwave is worth studying)
- `toss-web`: webcam + canvas
- `toss-cli`: encode a file to PNG frames and decode them back; doubles as an end-to-end test harness

## Package layout (monorepo)

```
toss/
  README.md
  packages/
    core/              toss-core
    qr/                toss-qr
    react-native/      toss-react-native
    expo/              expo-toss
  examples/
    expo-app/          minimal app: send + receive
  docs/
    protocol.md        frame format spec
```

## Known risks

- **Throughput is camera- and display-limited, not protocol-limited.** Rough guess: ~0.5-1 KB per frame at 5-10 fps, so a few KB/s at best. Great for themes and configs, painful past a few hundred KB.
- **Do an early device spike** of the camera + display path to find real frame size and rate. It's the one thing unit tests can't cover.
- Screen-to-camera issues: glare, moire, exposure. Max brightness and keep-awake on the sender help.
- No back-channel: the sender can't know the receiver finished, so it loops until dismissed.
- Display and camera can phase-lock, so a capture rhythm misses the same frames every loop. The sender's prime-length cycle handles this in simulation, but the spike should confirm it.

## Open questions

- Add a fountain code after v1? Depends on the loss measured in the device spike. See `docs/protocol.md`, Appendix B.
- Camera library: `expo-camera` scanning vs. `react-native-vision-camera`?
- QR drawing: `react-native-svg` vs. Skia?
- Optional encryption (shared passphrase)? Currently out of scope. Anyone who can see the screen can read it.

## Roadmap

1. `toss-core`: frame format, encoder/decoder, tests with simulated loss/duplication/reordering
2. `toss-cli`: round-trip a file through PNG frames in CI
3. `toss-qr`: base45 codec, capacity tuning
4. Device spike: measure real camera/display throughput
5. `toss-react-native`: hooks, then default components
6. `expo-toss`: config plugin + packaging
7. Wire into a real app

## Naming

`toss` is taken on npm (an unrelated, abandoned package), so the published names are suffixed: `toss-core`, `toss-qr`, `toss-react-native`, and `expo-toss`. These were all unclaimed when checked, so consider publishing placeholders or using a scope.
