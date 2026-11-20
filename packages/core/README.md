# toss-core

[npm](https://www.npmjs.com/package/toss-core)

The protocol behind [toss](../../README.md): it turns bytes into a looping sequence of frames, and frames back into bytes. It's sans-IO, so it has no camera, timers, sockets or QR, and it runs anywhere.

Use this to carry toss over something new. For QR, add [`toss-qr`](../qr). For an app, use [`expo-toss`](../expo).

```ts
import { Decoder, Encoder } from 'toss-core'

const encoder = new Encoder(bytes, { maxFrameBytes: 700, mime: 'application/json', kind: 'my-app/theme' })

const decoder = new Decoder({ maxPayloadBytes: 1024 * 1024 })
let result = decoder.push(encoder.nextFrame())
while (!result.done && result.state !== 'failed') result = decoder.push(encoder.nextFrame())

result.payload   // the original bytes. Untrusted
result.meta      // { sessionId, mime, kind, payloadSize }. Untrusted
```

In real use, frames go through your carrier between those two calls, and some never arrive. The decoder copes with lost, repeated and out-of-order frames, and with joining mid-loop.

## `Encoder`

`new Encoder(payload, options)` throws a `RangeError` if the options aren't valid or the header doesn't fit in a frame.

| Option | |
|---|---|
| `maxFrameBytes` | The largest frame the carrier can move. At least `MIN_FRAME_BYTES` |
| `mime` | Printable ASCII, at most 255 characters |
| `kind` | App-defined label, with the same limits |
| `compress` | Compress when that makes the body smaller. Defaults to `true` |

- `nextFrame()` returns the next frame, and never runs out.
- `frameAt(t)` returns the frame at position `t`, which depends only on `t`.
- `cycleLength` is the number of frames before the sequence repeats.
- `frameCount`, `compressed` and `sessionId` describe the transfer.

The same input always gives the same frames and the same session ID. That's what makes [resuming](../../docs/guide.md#pausing-and-resuming) possible.

## `Decoder`

`new Decoder(options)`. All of these caps apply before anything is allocated.

| Option | Default | |
|---|---|---|
| `maxPayloadBytes` | 16 MiB | Largest accepted payload or body |
| `maxFrameCount` | 65,536 | Largest accepted frame count |
| `maxFrameBytes` | unset | Reject frames longer than this |
| `maxPendingBytes` | 256 KiB | Block bytes held before a header arrives |
| `maxPendingFrames` | 256 | Blocks held before a header arrives |

`push(frame)` never throws on bad input, and returns:

| Field | |
|---|---|
| `state` | `searching`, `locked`, `done` or `failed` |
| `outcome` | What this frame did: `header`, `block`, `pending`, `duplicate`, `ignored` or `rejected` |
| `reason` | Why, for `ignored` and `rejected` |
| `progress` | `{ received, total }`. `total` is null until a header arrives |
| `done` | True when the payload is ready |
| `meta` | Available from the moment the decoder locks |
| `payload` | Set when `done` |
| `error` | Set when `failed`: the hash didn't match, or the body wouldn't inflate |
| `otherSessionFrames` | Valid frames from other sessions, so far |

`reset()` forgets everything, and `state` reads the current state.

A hash detects damage, and authenticates nothing. Treat `payload` and `meta` as untrusted.

## Writing a carrier

A carrier moves a frame's bytes unchanged, or drops them. See the [carrier contract](../../docs/protocol.md#3-carrier-contract) and the full [protocol spec](../../docs/protocol.md).

## Licence

MIT
