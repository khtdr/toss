# toss-qr carrier, version 1

This spec defines how `toss-qr` carries a `toss-core` frame in a QR symbol. It meets the carrier contract in `docs/protocol.md`, section 3, and doesn't change the frame format. Platform I/O (camera, screen) belongs to layer 3.

```ts
const config = { version: 22, errorCorrection: 'M' }

// Sender: render each frame in the cycle once, then flip through them.
const encoder = new Encoder(bytes, { maxFrameBytes: maxFrameBytes(config), mime, kind })
const matrix = textToMatrix(frameToText(encoder.frameAt(t)), config)

// Receiver: the camera library supplies `scanned`, which may be any QR code in view.
const read = textToFrame(scanned)
if (read.ok) decoder.push(read.frame)
```

## 1. Frame text

```
text = "T" || base45(frame)
```

Base45 is RFC 9285. The symbol holds one alphanumeric-mode segment.

**Why text:** scanner libraries return strings, and they decode binary QR data with their own guess at a character set. Alphanumeric mode has no character set to guess. It costs about 3% of capacity against byte mode: 2,260 bytes instead of 2,331 at version 40-M.

**Why the `T`:**

- **It stops the text starting with a space.** Space is a base45 digit, and a frame's first bytes are its type and the start of its session ID. About 1 session in 45 would start with a space on every header or data frame. Session IDs come from the content, so resending wouldn't change that. If any scanner trims its result, those transfers could never finish.
- **It rejects other QR codes cheaply.** A receiver can drop a stray URL without decoding it.
- **It leaves room to change the format.** A new text encoding can use a different first character.

It costs one character per frame. Base45 text never ends in a space, because the last digit of a group is at most `W`, so the end needs no marker.

## 2. Reading text

`textToFrame` never throws, and checks in this order:

1. The text starts with `T`, otherwise `not-toss`.
2. It's at most 4,296 characters, the capacity of the largest symbol, otherwise `too-long`. This comes before any allocation.
3. It's valid base45, otherwise `bad-base45`. That means a length that isn't 0 or 2 modulo 3, a character outside the alphabet, or a group over its limit (65,535, or 255 for a final 2-character group).

The frame then goes to `Decoder.push`, which checks its CRC.

## 3. Symbols

Every frame in a transfer uses the same version and error correction level, so the symbol never changes size on screen. Shorter frames, such as the header, rely on the QR format's own padding. Frame lengths survive, so the carrier adds no framing.

`maxFrameBytes(config)` gives the largest frame a symbol holds, and `smallestVersion(frameBytes, level)` goes the other way:

| Version | Modules | L | M | Q | H |
|---|---|---|---|---|---|
| 10 | 57 | 262 | 206 | 146 | 115 |
| 15 | 77 | 504 | 399 | 283 | 213 |
| 20 | 97 | 832 | 646 | 467 | 370 |
| 25 | 117 | 1,234 | 966 | 693 | 518 |
| 30 | 137 | 1,679 | 1,328 | 952 | 719 |
| 40 | 177 | 2,863 | 2,260 | 1,612 | 1,234 |

Renderers must leave `QUIET_ZONE_MODULES` (4) of white on every side. A matrix doesn't include it.

The smallest symbols return a size that can't hold a toss header, and `Encoder` throws for those.

## 4. Device spike results

Measured with `examples/expo-app` on a Galaxy S21 and a Pixel 10 Pro, using expo-camera and a hand-held receiver. Each setting has only a few runs, and times vary a lot between runs. Every completed run verified, and no scan was rejected.

- **Rate.** At v10-M, 10 fps gave the best result, with 99% of symbols captured. Capture fell to 87% at 12 fps and 78% at 15 fps. The Pixel sustained about 15 scans/s and the S21 about 25, so this limit depends on the receiver.
- **Version.** Larger symbols won clearly, and scan rate barely changed with size. v30-M moved 50 KB in 4.3-8.8 s, about 8.9 KB/s on average. v10-M took 42 s. Nothing above v30 has been tested.
- **Level.** M beat L at v30. L carries more per symbol but missed more. Both Q runs were far worse, but they ran last, so that result isn't reliable.
- **Renderer.** Skia averaged about 8.9 KB/s and `react-native-svg` about 5.3 KB/s, from S21 sender runs at v30-M. The S21 held 10 fps with no skipped slots on a Skia run. SVG's sender figures weren't recorded.
- **Direction.** Pixel to S21 matched S21 to Pixel, at 4.2 and 5.3 s for 50 KB.
- **Large transfers.** 200 KB took 33-38 s at v30-M, with 87% of symbols captured. One clean pass would take about 17 s.
- **Render cost.** Preparing a v30 symbol took 237 ms on the S21 and 146 ms on the Pixel, so 200 KB needed 39.5 s on the S21 before the first symbol appeared. In Node, `qrcode-generator` spends about 94% of its time choosing a mask: about 35 ms per symbol, against about 2 ms with a fixed mask. That hasn't been measured on Hermes, and the effect of a fixed mask on scanning is untested.
- **Scanner behaviour.** ML Kit kept the check text's leading and trailing spaces, and its display value never differed from its raw value. `jsQR` and `zbar` also keep spaces and every other alphanumeric character.

There's still deliberately no default config in this package. v30-M at 10 fps is the best setting measured, and the choice belongs with the React Native layer.
