# toss: working notes for Claude

Read `README.md` first. It has the architecture, layers, risks, and roadmap. This file records decisions and preferences from the design conversation.

## Project intent

- Personal library, built for the owner's own apps (Expo / React Native). An existing library may already do this; that is irrelevant. Don't suggest "just use X" unless asked.
- Priority is **modularity and testability**. The design was done top-down ("final form") and is being built bottom-up.

## Decisions made

- Four layers: `toss-core` (protocol) -> `toss-qr` (carrier) -> `toss-react-native` (platform/UI) -> `expo-toss` (packaging). Each depends only on layers below.
- **`toss-core` is sans-IO**: pure state machines (`Encoder.nextFrame()`, `Decoder.push(frame)`), with no camera, timers, sockets, or QR knowledge. The owner understands the idea: it's a style, not a spec.
- Core must pass the thought experiment "could this run over audio (modem-like sounds) unchanged?" Frame size is a config parameter.
- Core payload semantics: opaque bytes plus mime type plus app-defined `kind`. The app decides what the data means.
- **Layer 2 vs 3 boundary**: layer 2 is pure carrier logic (frame <-> QR string/matrix). Platform I/O (camera, screen, mic, speaker) lives in layer 3.
- Layer 3 exposes headless hooks first (`useTossSend`, `useTossReceive`), default components second. Apps handle their own confirmation UI.
- Layer 4 stays thin: peer deps, config plugin, permission strings, re-exports.
- **Frame format:** `docs/protocol.md` is approved. Change it only with the owner's agreement.
- **Redundancy:** plain looping with a prime-length cycle for v1. After the device spike, the owner chose not to add a fountain code for now: apps mostly send JSON, which compresses well, and short loops make misses cheap. The considerations are in `docs/protocol.md`, Appendix B.
- **Session ID:** derived from header content, so the encoder stays deterministic and needs no RNG.
- **Compression:** on by default, kept only if smaller, `compress: false` to opt out. Raw DEFLATE via `fflate`, a direct dependency of `toss-core`.
- **Text codec:** owned by the carrier layer. Core handles raw bytes only.
- **Workspaces:** npm.
- **QR carrier:** `docs/qr.md`. Frame text is `T` plus base45, in one alphanumeric segment, at one fixed version per transfer. The `T` keeps the text from starting with a space. `toss-qr` encodes symbols with a vendored copy of `qrcode-generator`, patched so callers can skip the mask search. The React Native layer should pass mask 0.
- **CLI:** `toss-cli` draws frames through `toss-qr`. Scanning PNGs with `jsqr` and `pngjs` stays in the CLI, since a device's camera does that job.
- **Device layer:** `expo-camera` for scanning and Skia for drawing, chosen from the spike results in `docs/qr.md`, section 4.
- **Default settings:** version 30, level M, 10 fps, as a configurable default in the React Native layer. Apps' payload sizes vary, so don't hard-code them.
- Package names (checked on npm, available): `toss-core`, `toss-qr`, `toss-react-native`, `expo-toss`. Bare `toss` is taken.

## Where things stand

As of 2026-11-05, the device spike is finished, with results in `docs/qr.md`, section 4. `toss-react-native` has its headless hooks and `TossSymbol`, tested in Node and bundled with Metro, but **not yet run on a phone. Do that next**, then build the default components.

Check these on the phones first:

- Whether the sender holds 10 fps. The spike parsed every Skia path up front, and `TossSymbol` parses one per symbol, so that cost is unmeasured. Watch `stats.shownFps` and `stats.skippedSlots`.
- Memory in a long session. Each symbol makes a new Skia path, which the spike didn't do.

Carry these into the default components:

- Show live progress and ask people to hold steady, using `stalledMs`. A good hand-held session reaches 9-11 KB/s, but a poor one can be several times slower.
- `examples/expo-app/metro.config.js` must keep `disableHierarchicalLookup`. Without it, a linked package bundles a second React, because the root install has one too.

After that layer comes a small published file transfer app, as a utility and a proof of concept. It's the layer's first real user, and it replaces the spike in `examples/expo-app`. The plan is Android first, with a cap of about 1 MB.

- **Fountain code:** the decision not to add one assumed JSON, so revisit it for this app. Files compress far less, and 1 MB takes 2-4 minutes on a good run.
- **Privacy:** there's no encryption, so the app should say that anyone who can see the screen can read the file.
- **Received files:** they're untrusted. Clean up filenames, enforce size caps, and hand files to the system's save or share sheet instead of opening them.
- **Publishing:** it needs a real signing key, a privacy policy and a camera permission message. Check Google Play's current testing rules for new personal accounts early.

Not tested yet, in rough order of value:

- Real JSON with compression on. Every spike run used incompressible data.
- Versions 35 and 40, which the spike app offers.
- Masks other than 0.
- The Pixel as receiver with a lower camera analysis resolution. It managed about 15 scans/s against the Galaxy S21's 25, and the cause is unknown.
- 15 fps from the Pixel to the S21.

The test phones are a Galaxy S21 and a Pixel 10 Pro. To rebuild the spike, see `examples/expo-app/README.md`. It needs the Android SDK and JDK 21, and `android/` is generated, so a new machine rebuilds it.

## Open (don't silently decide)

See "Open questions" in the README: encryption, a fountain code for the file transfer app, and iOS. Present a recommendation and let the owner choose.

## Build order

Protocol + tests -> CLI round-trip -> QR carrier -> **device spike for real camera/display throughput** -> RN layer -> Expo packaging -> real app. Throughput is the main unknown, and it can only be measured on a device.

## Conventions

- Monorepo, one package per layer, under `packages/`.
- TypeScript. Tests must be able to simulate loss, duplicate frames, reordering, and joining mid-loop without any device.
- Treat received data as untrusted: enforce size and frame-count caps before allocating. This includes images: `pngjs` sizes its buffers from the last `IHDR`, so check every chunk first.
- No Co-Authored-By attribution in commit messages.
