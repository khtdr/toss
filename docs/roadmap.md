# Roadmap

The order from here: make the library useful to app developers, with File Toss as the proof of concept, and write the docs and blog posts. Then expand File Toss into a cross-platform tool, and if it works well enough, put it in the app stores.

1. `toss-core`: frame format, encoder/decoder, tests with simulated loss/duplication/reordering. Done
2. `toss-cli`: round-trip a file through PNG frames, as part of `npm test`. Done
3. `toss-qr`: base45 codec, capacity tuning, taking over the CLI's QR code. Done
4. Device spike: measure real camera/display throughput. Done, see [`qr.md`, section 4](qr.md#4-device-spike-results)
5. `toss-react-native`: hooks, then default components. Both run on two phones
6. `expo-toss`: config plugin + packaging. Built and tested, and File Toss uses it on the phones
7. Wire into a real app: File Toss, in `examples/file-toss`, replacing the spike. It's both a utility and a proof of concept. Runs on both test phones, not yet published
8. Publish `toss-core`, `toss-qr`, `toss-react-native` and `expo-toss` to npm. Each needs a real version in place of `0.0.0`, and `private` removed. `toss-qr` also needs the full MIT text in its vendored `qrcode-generator` file. `toss-cli` can probably stay private. Not started
9. Desktop builds of File Toss for Mac, Linux and Windows, so files can move between phones and computers. Deno Desktop bundles the TypeScript into a standalone executable, which would likely use `toss-web`. Not started

## Known risks

- **Throughput is camera- and display-limited, not protocol-limited.** Hand-held at version 30, level M, 10 fps, incompressible data moves at 4-9 KB/s, and compressible JSON several times faster. See [`qr.md`, section 4](qr.md#4-device-spike-results).
- Screen-to-camera issues: glare, moire, exposure. Max brightness and keep-awake on the sender help.
- No back-channel: the sender can't know the receiver finished, so it loops until dismissed.
- Display and camera can phase-lock, so a capture rhythm misses the same frames every loop. The sender's prime-length cycle handles this in simulation, and the device spike saw random-looking loss, not repeated misses.

## Open questions

- Optional encryption (shared passphrase)? Currently out of scope. Anyone who can see the screen can read it. A published file transfer app makes this more pressing.
- Should File Toss get a fountain code? It now sends real files of up to 64 MiB, and files compress far less than JSON, so this question is live. See [`protocol.md`, Appendix B](protocol.md#appendix-b-fountain-code-considerations).
- iOS: everything so far has only been tested on Android.

## Naming

`toss` is taken on npm (an unrelated, abandoned package), so the published names are suffixed: `toss-core`, `toss-qr`, `toss-react-native`, and `expo-toss`. These were all unclaimed when checked, so consider publishing placeholders or using a scope.
