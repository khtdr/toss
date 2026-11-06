# toss-qr

The QR carrier for [toss](../../README.md): it turns [`toss-core`](../core) frames into QR symbols, and scanner text back into frames. It's pure logic, with no platform I/O, so it runs anywhere.

Use this to bring toss to a platform other than React Native. For an app, use [`expo-toss`](../expo).

> Not on npm yet.

```ts
import { Decoder, Encoder } from 'toss-core'
import { frameToText, maxFrameBytes, textToFrame, textToMatrix } from 'toss-qr'

const config = { version: 30, errorCorrection: 'M' } as const

// Sender: draw each symbol, then flip through them.
const encoder = new Encoder(bytes, { maxFrameBytes: maxFrameBytes(config), mime, kind })
const matrix = textToMatrix(frameToText(encoder.nextFrame()), { ...config, mask: 0 })

// Receiver: `scanned` comes from your camera, and may be any QR code in view.
const decoder = new Decoder()
const read = textToFrame(scanned)
if (read.ok) decoder.push(read.frame)
```

## API

| Export | |
|---|---|
| `frameToText(frame)` | Frame bytes to QR text |
| `textToFrame(text)` | QR text to `{ ok: true, frame }`, or `{ ok: false, reason }`. Never throws |
| `textToMatrix(text, options)` | QR text to a matrix, at a fixed version. Pass `mask`, as searching for one is slow |
| `maxFrameBytes(config)` | The largest frame a symbol holds |
| `smallestVersion(frameBytes, level)` | The smallest version that holds a frame |
| `textCapacity(config)` | The longest text a symbol holds |
| `QUIET_ZONE_MODULES` | White border to leave on every side, which the matrix doesn't include |

Every frame in a transfer must use the same version and level, so the symbol never changes size on screen.

The full spec, and the measurements behind the defaults, are in [`docs/qr.md`](../../docs/qr.md).

## Licence

MIT. Includes a patched copy of `qrcode-generator`, also MIT.
