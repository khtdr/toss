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
- **Redundancy:** plain looping with a prime-length cycle for v1. Fountain codes are deferred until the device spike; the considerations are in `docs/protocol.md`, Appendix B.
- **Session ID:** derived from header content, so the encoder stays deterministic and needs no RNG.
- **Compression:** on by default, kept only if smaller, `compress: false` to opt out. Raw DEFLATE via `fflate`, a direct dependency of `toss-core`.
- **Text codec:** owned by the carrier layer. Core handles raw bytes only.
- **Workspaces:** npm.
- **CLI:** `toss-cli` draws real QR PNGs in byte mode, using `qrcode-generator`, `jsqr`, and `pngjs`. This doesn't settle the libraries or text codec for `toss-qr`, which replaces the CLI's QR code when it's built.
- Package names (checked on npm, available): `toss-core`, `toss-qr`, `toss-react-native`, `expo-toss`. Bare `toss` is taken.

## Open (don't silently decide)

See "Open questions" in the README: whether to add a fountain code after the spike, camera lib, QR drawing lib, and encryption. Present a recommendation and let the owner choose.

## Build order

Protocol + tests -> CLI round-trip -> QR carrier -> **device spike for real camera/display throughput** -> RN layer -> Expo packaging -> real app. Throughput is the main unknown, and it can only be measured on a device.

## Conventions

- Monorepo, one package per layer, under `packages/`.
- TypeScript. Tests must be able to simulate loss, duplicate frames, reordering, and joining mid-loop without any device.
- Treat received data as untrusted: enforce size and frame-count caps before allocating. This includes images: `pngjs` sizes its buffers from the last `IHDR`, so check every chunk first.
- No Co-Authored-By attribution in commit messages.
