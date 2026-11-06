# Architecture

toss is four layers. Each depends only on the ones below it, so a new carrier or platform replaces one layer and leaves the rest alone.

```
4. packaging      expo-toss             Expo config plugin, permissions, one clean import
3. UI / platform  toss-react-native     camera, drawing, hooks + default components
2. carrier        toss-qr               frame <-> QR (and later: toss-audio, ...)
1. protocol       toss-core             bytes <-> frames. Knows nothing about QR.
```

## A transfer

1. The app hands over bytes, a mime type and a `kind`. The app decides everything else, like asking for confirmation or choosing what to send.
2. `toss-core` compresses the bytes if that helps, splits them into blocks, and makes a header frame. It loops through them forever, with headers spread through the loop.
3. `toss-qr` turns each frame into text, and the text into a QR symbol. Every symbol in a transfer has the same size.
4. `toss-react-native` draws a symbol ten times a second, with the screen at full brightness.
5. On the other phone, the camera returns text for each symbol it reads. `toss-qr` turns that back into a frame, and `toss-core` collects them in any order until it has every block.
6. `toss-core` checks the hash, and the app gets the bytes.

The sender never hears back, so step 4 lasts until someone stops it.

## Layer 1: `toss-core`, the protocol

Pure state machines, in a sans-IO style: no camera, timers, sockets or QR. Input goes in, state comes out.

- **Carrier-neutral.** Frame size is a parameter, and core handles raw bytes only. Text codecs like base45 belong to the carrier. The test is whether it could run over modem-like sound unchanged.
- **Header frame:** version, session ID, mime type, `kind`, sizes, frame count, payload hash and compression flag.
- **Data frames:** session ID, index, payload and a CRC.
- **Robust.** It tolerates duplicates, reordering and joining mid-loop, and the session ID keeps two senders from mixing.
- **Plain looping**, with a prime-length cycle, so that a camera locked to the display's rhythm can't miss the same frames forever. The format leaves room for a fountain code. See [`protocol.md`, Appendix B](protocol.md#appendix-b-fountain-code-considerations).
- **Untrusted input.** Size and frame-count caps apply before anything is allocated.

## Layer 2: `toss-qr`, the carrier

Pure QR logic, with no platform I/O. It turns frames into base45 text and back, turns text into a QR matrix at a fixed version, and works out capacity.

Base45 fits QR's alphanumeric mode, which matters because scanners return strings and guess at the character set of binary data. See [`qr.md`](qr.md).

## Layer 3: `toss-react-native`, the platform

All the platform I/O lives here: `expo-camera` for scanning, Skia for drawing, keep-awake and brightness. These were chosen from measurements on real phones.

- `SendSession` and `ReceiveSession` hold the logic and take the clock as an argument, so tests need no device.
- `useTossSend` and `useTossReceive` connect those to the platform.
- `TossSender` and `TossReceiver` are built only on the public hooks. Apps control their own confirmation and UI.
- Each new symbol goes straight to `TossSymbol`, so the calling screen doesn't re-render at the frame rate.

## Layer 4: `expo-toss`, packaging

Thin by design: it re-exports layer 3 and adds a config plugin for permissions.

## Adding to it

Carriers (QR, audio) times frameworks (React Native, web) gives one adapter per cell. Build only what's needed.

- `toss-audio`: modem-style data over sound. ggwave is worth studying.
- `toss-web`: webcam and canvas.

A new carrier has to meet the contract in [`protocol.md`, section 3](protocol.md#3-carrier-contract).
