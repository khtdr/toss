# toss: working notes for Claude

Read `README.md` first. It's written for developers choosing a library. The layers are in `docs/architecture.md`, the risks, roadmap and open questions in `docs/roadmap.md`, and integration advice in `docs/guide.md`. The API reference is `packages/react-native/README.md`, so keep it in step with the code. This file records decisions and preferences from the design conversation.

## Project intent

- Built for the owner's own apps (Expo / React Native), and now meant for other app developers too. An existing library may already do this; that is irrelevant. Don't suggest "just use X" unless asked.
- **Scope, in order:** first make the library useful to other app developers, with File Toss as its proof of concept, and write the docs and blog posts. Then expand File Toss into a cross-platform tool. If that works well enough, put it in the app stores.
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

As of 2026-11-05, `toss-react-native` has its headless hooks and `TossSymbol`, and they've run on both test phones through the spike. All transfers verified, the sender held 10 fps while drawing live, and memory stayed flat. Results are in `docs/qr.md`, section 4.

`TossSender` and `TossReceiver` are built on those hooks. The owner has run them on the phones and they work. **Preparing** shows briefly before a 1 MB start, so deferring the session build to a later task does get it on screen before the JS thread blocks. Keep that deferral: tests can't show what reaches the screen.

`expo-toss` is built. Its tests run Expo's real prebuild pipeline. It has run on the phones through File Toss. `aapt dump permissions` on the 2026-11-06 release APK shows no `WRITE_SETTINGS`, so `tools:node="remove"` works in Gradle's manifest merge. Full brightness works without it.

**File Toss**, in `examples/file-toss`, replaced the spike. It's the layers' first real user, as a utility and a proof of concept. Its README covers how resuming and the estimate work, and lists what to check on the phones. **As of 2026-11-06 it has had a native build and run on the phones.** A 160 KB PDF went from one phone to the other and opened on the receiver, including a pause, going back, and resuming. That run's time means nothing, as the phone was moving around a lot. A second PDF, 166 KB, took 30 s, at the fast end of the simulated 30-55 s. Force-stopping both phones mid-transfer and reopening them also picked up where it left off. The README's phone checklist is done except for a large file: nothing above 1 MB has run on a phone. The machine it was written on has no JDK 21. The spike is in git at `340a056`, under `examples/expo-app`, if more measurements are needed.

`examples/file-toss/metro.config.js` must keep `disableHierarchicalLookup`. Without it, a linked package bundles a second React, because the root install has one too. It also hides anything nested in `node_modules/*/node_modules`, so a package nested there has to become a direct dependency. `@expo/metro-runtime` is one. `expo export -p android` shows this, while tests and typechecks don't.

- **Size limit:** 64 MiB, for memory and to stop a hostile sender claiming an enormous file. The owner asked for no 1 MB cap, and this is about 4.5 hours of transfer. The time estimate, not a limit, is what's meant to put people off.
- **Filename:** carried in `kind` as `file-toss/1:` plus the percent-encoded name, so the receiver has it from the header. It's untrusted, and it goes through `sanitizeFilename`.
- **Resume:** the receiver logs frames and replays them through a new decoder, so `toss-core` has no save or restore API. Don't add one without a reason. Anything that changes the bytes of the header changes the session, so `planTransfer` and `nameToKind` must stay deterministic.
- **Fountain code:** deferred by the owner until they're sending real files, which File Toss now does, so it's the owner's call. Don't build it unasked. For reference, 1 MB of noise took 4 min 15 s, with 63% of that on the last 10% of blocks. A rough estimate with a fountain code is 1.6 minutes. When it comes back, first benchmark receiver CPU on Hermes.
- **Privacy:** there's no encryption, so the app says that anyone who can see the screen can read the file.
- **Received files:** they're untrusted. Filenames are cleaned, sizes capped, and files go to the system's save or share sheet, never opened.
- **Permissions:** `INTERNET`, `SYSTEM_ALERT_WINDOW`, `VIBRATE` and the old storage permissions are blocked in `app.json`. The About screen promises no internet access, so that must stay true.
- **Signing:** the real key is in `~/.config/file-toss`, outside the repo, and must never be committed. There's no way to update installed copies without it, so it needs a backup. `npm run apk:small` signs with it. APKs go in GitHub Releases, not in git.
- **Publishing:** it still needs a privacy policy. Check Google Play's current testing rules for new personal accounts early. `eas.json` hasn't been run.

Not tested yet, in rough order of value:

- Real app JSON. The hook runs used synthetic JSON, which may compress better. 1 MB of it hasn't been run either.
- The hooks with the phones swapped, Pixel sending to the S21.
- Versions 35 and 40.
- Masks other than 0.
- The Pixel as receiver with a lower camera analysis resolution. It managed about 15 scans/s against the Galaxy S21's 25, and the cause is unknown.
- 15 fps from the Pixel to the S21.

The test phones are a Galaxy S21 and a Pixel 10 Pro. The S21's USB connection drops in and out, and each reconnect opens the USB settings page over the app, so prefer wireless debugging for long `adb` sessions. To build the app, see `examples/file-toss/README.md`. It needs the Android SDK and JDK 21, and `android/` is generated, so a new machine rebuilds it.

## Open (don't silently decide)

See "Open questions" in `docs/roadmap.md`: encryption and iOS. A fountain code is deferred, as noted above. Present a recommendation and let the owner choose.

## Build order

Protocol + tests -> CLI round-trip -> QR carrier -> **device spike for real camera/display throughput** -> RN layer -> Expo packaging -> real app. Throughput is the main unknown, and it can only be measured on a device.

## Conventions

- Monorepo, one package per layer, under `packages/`.
- TypeScript. Tests must be able to simulate loss, duplicate frames, reordering, and joining mid-loop without any device.
- Treat received data as untrusted: enforce size and frame-count caps before allocating. This includes images: `pngjs` sizes its buffers from the last `IHDR`, so check every chunk first.
- No Co-Authored-By attribution in commit messages.
