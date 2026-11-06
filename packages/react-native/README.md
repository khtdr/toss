# toss-react-native

Hooks and components for sending data between two phones with a screen and a camera. For an Expo app, use [`expo-toss`](../expo), which has this whole API and sets up permissions. The [guide](../../docs/guide.md) shows how the pieces fit together.

> Not on npm yet. Android works, and iOS hasn't been tested.

## Install

Your app needs Expo Modules, and these peer dependencies: `expo-camera`, `expo-brightness`, `expo-keep-awake`, `@shopify/react-native-skia` 2.14 or later, `react-native-safe-area-context` 5 or later, and React 19 or later.

## Components

### `<TossSender>`

A whole send screen. Takes everything in [`useTossSend`'s options](#usetosssenddata-options), and:

| Prop | Type | |
|---|---|---|
| `data` | `Uint8Array \| null` | Required. Null until the app is ready. Keep it stable between renders |
| `onStop` | `() => void` | Called when someone presses Stop. Without it, Stop offers to send again |
| `style` | `StyleProp<ViewStyle>` | |

### `<TossReceiver>`

A whole receive screen, including the camera permission. Takes everything in [`useTossReceive`'s options](#usetossreceiveoptions), and:

| Prop | Type | |
|---|---|---|
| `onReceive` | `(payload: Uint8Array, meta: TransferMeta) => void` | Required. Called once per finished transfer. Both arguments are untrusted |
| `onCancel` | `() => void` | Called when someone presses Cancel. Without it, Cancel offers to start again |
| `style` | `StyleProp<ViewStyle>` | |

Options are read once, when the component mounts.

### `<TossSymbol>`

Draws the sender's current symbol, including its quiet zone.

| Prop | Type | |
|---|---|---|
| `symbol` | `SymbolSource` | Required. `send.symbol` from `useTossSend` |
| `maxSide` | `number` | The most room it can take, in layout units. Defaults to the window's width |

## Hooks

### `useTossSend(data, options)`

Pass `null` as `data` until the app is ready, and keep it stable between renders.

| Option | Type | Default | |
|---|---|---|---|
| `mime` | `string` | | Required. Printable ASCII, at most 255 characters |
| `kind` | `string` | | Required. App-defined label, with the same limits |
| `compress` | `boolean` | `true` | Compress when that makes the transfer smaller |
| `version` | `number` | `30` | QR version, fixed for the whole transfer |
| `errorCorrection` | `'L' \| 'M' \| 'Q' \| 'H'` | `'M'` | |
| `fps` | `number` | `10` | Symbols per second |
| `mask` | `0`-`7` | `0` | Fixed, because searching for a mask is too slow while sending |
| `startPosition` | `number` | `0` | Where in the cycle to start. Read it once and keep it, as a change restarts the transfer |

Returns:

| Field | |
|---|---|
| `status` | `idle`, `preparing`, `sending`, `paused`, `cancelled` or `failed` |
| `symbol` | Pass this to `TossSymbol`. Set while `sending` or `paused` |
| `frameCount` | Data frames in the transfer. Set while `sending` or `paused` |
| `stats` | `{ loops, position, shownFps, skippedSlots }`, updated once a second |
| `error` | An `Error`, when `failed` |
| `cancel()` | Stops sending |
| `restart()` | Starts again after `cancel` |
| `pause()` | Holds the sequence, and lets the screen dim and sleep |
| `resume()` | Carries on from the same symbol |

While sending, it keeps the screen awake at full brightness, and it holds the sequence while the app is in the background.

### `useTossReceive(options)`

Options are read once, when the component mounts.

| Option | Type | Default | |
|---|---|---|---|
| `maxPayloadBytes` | `number` | 16 MiB | Largest accepted payload |
| `maxFrameCount` | `number` | 65,536 | Largest accepted frame count |
| `onFrame` | `(frame: Uint8Array) => void` | | Called with each new frame of the locked transfer, to keep for `restore`. Not called for restored frames |

Returns:

| Field | |
|---|---|
| `status` | `searching`, `receiving`, `paused`, `done`, `failed` or `cancelled` |
| `progress` | `{ received, total }`. `total` is null until a header arrives |
| `meta` | `{ sessionId, mime, kind, payloadSize }`, once a header arrives. Untrusted |
| `payload` | A `Uint8Array`, when `done`. Untrusted |
| `error` | The reason, when `failed`. See [Troubleshooting](../../docs/guide.md#troubleshooting) |
| `permission` | The camera permission. Null until it's known |
| `requestPermission()` | Asks for the camera |
| `cameraProps` | Spread these onto a `CameraView` |
| `scansPerSecond` | Scanner callbacks per second, including repeats of the same symbol |
| `stalledMs` | Time since the last new block. A good cue to ask people to hold steady |
| `rejectedScans` | Different codes that weren't usable |
| `otherSessionFrames` | Valid frames from a different transfer. This rises if the sender restarted with new data |
| `cancel()` | Drops the transfer and stops scanning |
| `pause()` | Stops scanning and keeps what's arrived. Leave the `CameraView` out while `paused` |
| `resume()` | Scans again |
| `restore(frames)` | Adds frames kept from an earlier run |
| `reset()` | Forgets everything and scans for a new transfer |

## Lower-level exports

- `SendSession` and `ReceiveSession`: the logic behind the hooks, with the clock passed in. They need no device.
- `DEFAULT_SEND_SETTINGS`: the defaults above, which are the best settings measured on real phones.
- `matrixToPath` and `crispSide`: helpers for drawing a symbol yourself.

## Licence

MIT
