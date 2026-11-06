# Using toss in your app

This guide assumes you've followed the [quick start](../README.md#quick-start). Everything imports from `expo-toss`, or from `toss-react-native` if you aren't using the config plugin. Every option is listed in the [API reference](../packages/react-native/README.md).

- [Components or hooks](#components-or-hooks)
- [Describing your data](#describing-your-data)
- [Handling received data](#handling-received-data)
- [Sensitive data](#sensitive-data)
- [Ending a transfer](#ending-a-transfer)
- [Building your own UI](#building-your-own-ui)
- [Pausing and resuming](#pausing-and-resuming)
- [Tuning](#tuning)
- [Permissions](#permissions)
- [Troubleshooting](#troubleshooting)
- [Testing without a device](#testing-without-a-device)

## Components or hooks

Start with `TossSender` and `TossReceiver`. They're whole screens, and you only need to fit them into your navigation. Move to `useTossSend` and `useTossReceive` when you want your own design, or need something the components don't do, like pausing. The components use only those public hooks, so you won't lose anything by moving.

## Describing your data

A transfer is bytes plus two labels:

- **`mime`** says what format the bytes are in, like `application/json`.
- **`kind`** is yours. It says what the data means to your app, so use something specific, like `my-app/theme`. A version number helps if the format might change: `my-app/theme/2`.

Both must be printable ASCII of at most 255 characters. For anything else, like a filename, percent-encode it. File Toss carries names in `kind` that way.

Keep `data` stable between renders, with `useMemo` or state. A new `Uint8Array` is a new transfer, even with the same contents. Pass `null` until the data is ready, and the hook stays `idle`.

Data is compressed if that makes it smaller. Pass `compress: false` to skip the attempt, for data you know is already compressed.

## Handling received data

Everything received is untrusted, including `meta`. Any screen can show a toss transfer, and the hash only proves that the data arrived intact. It doesn't prove who sent it.

- Set `maxPayloadBytes` to the largest thing your app expects. The default is 16 MiB, and the check happens before anything is allocated.
- Check `meta.kind` and `meta.mime`, but don't rely on them. A sender can claim anything.
- Parse and validate the payload as you would a file from the internet.
- Ask before applying anything that changes the app, and show people what they're about to accept.
- Clean any filename before you use it. Never build a path from one directly.

`onReceive` runs once per finished transfer. `TossReceiver` then shows **Receive another**, so to leave the screen, navigate away from inside `onReceive`.

## Sensitive data

toss sends nothing over a network and saves nothing to disk, which removes a lot of risk, but not all of it. Everything else is up to your app.

**On screen.** A transfer isn't encrypted, so anyone who can see or film the screen can read it, including a security camera in the background. For private data, encrypt before sending:

- Compress first, then encrypt, then pass `compress: false`, because encrypted data won't compress.
- `mime`, `kind` and the size stay readable in every header, so keep them generic. Put anything revealing, like a name in a filename, inside the encrypted data.
- Resuming needs identical bytes, so an interrupted transfer has to send the same encrypted data again. Keep it, or keep the salt and nonce, until the transfer's finished.
- A passphrase can be guessed offline by anyone who recorded the transfer, for as long as they like. Use a slow key derivation like Argon2 or scrypt, and prefer a long generated phrase to one people make up. Measure it on a real phone, as it can be slow in JavaScript.

If the same two people share data repeatedly, a one-time pairing avoids passphrases altogether. Each phone tosses its public key to the other in person. After that, the sender encrypts to the receiver's key and signs with its own, which also proves which device the data came from.

**At rest.** A received payload is only in memory until your app does something with it, so storing it safely is your app's job. If the data needs protecting, encrypt it before saving.

Frames you keep from `onFrame` count too. They're pieces of the transfer, as readable as the transfer itself. If a transfer takes only a few seconds, the simplest answer is not to keep them, and to start again if it's interrupted.

**Backups.** Android backup and iCloud can copy your app's files to the cloud without anyone noticing, which breaks a promise that data never leaves the device. On Android, set `android.allowBackup` to `false` in `app.json`, as File Toss does. On iOS, exclude those files from backup. Check the result on a real device.

**Other code in your app.** Analytics and crash reporting can pick up whatever they can see, so keep payloads out of logs and error reports. Saving through the system's share sheet hands the data to another app, and your app's promises stop there.

**Health and other regulated data.** Rules like HIPAA depend on who's handling the data and how, not just on the transfer, and an app can't be compliant on its own. Get legal advice for your case.

## Ending a transfer

There's no back-channel, so a sender never learns that the receiver finished. It loops until your app stops it, which is why `onStop` matters. In a custom UI, offer a clear **Done** button that calls `cancel()` and leaves the screen.

## Building your own UI

The sender needs a `TossSymbol`, and the receiver needs a `CameraView` from `expo-camera`:

```tsx
import { CameraView } from 'expo-camera'
import { TossSymbol, useTossReceive, useTossSend } from 'expo-toss'
import { Button, Text, View } from 'react-native'

function Send({ data }: { data: Uint8Array | null }) {
  const send = useTossSend(data, { mime: 'application/json', kind: 'my-app/theme' })

  if (send.status === 'failed') return <Text>{send.error?.message}</Text>
  if (!send.symbol) return <Text>Preparing</Text>

  return (
    <View>
      <TossSymbol symbol={send.symbol} />
      <Text>Shown {send.stats.loops} times</Text>
      <Button title="Done" onPress={send.cancel} />
    </View>
  )
}

function Receive() {
  const receive = useTossReceive({ maxPayloadBytes: 1024 * 1024 })
  const { permission, status, progress, stalledMs } = receive

  if (!permission) return null
  if (!permission.granted) return <Button title="Allow camera" onPress={() => void receive.requestPermission()} />
  if (status === 'failed') return <Text>Failed: {receive.error}</Text>
  if (status === 'done') return <Text>Received {receive.payload?.length} bytes</Text>

  return (
    <View style={{ flex: 1 }}>
      <CameraView style={{ flex: 1 }} {...receive.cameraProps} />
      <Text>{progress.total === null ? 'Looking for a code' : `${progress.received} of ${progress.total}`}</Text>
      {stalledMs > 2000 && <Text>Hold steady, with the whole code in view</Text>}
    </View>
  )
}
```

A few things are easy to miss:

- **Don't draw over the symbol, or crop it.** `TossSymbol` includes the white border that scanners need, and keeps its modules on whole pixels. Use `maxSide` to fit it to the space you have. Bigger is better.
- **The last few blocks are slow.** A missed block has to wait for the loop to come round again. In one test, the last 10% of blocks took 63% of the time. Tell people to hold steady, not that something's wrong. `stalledMs` is a good cue.
- **The hooks look after the screen.** `useTossSend` keeps the screen awake at full brightness while sending, and holds the sequence in the background. `useTossReceive` keeps the screen awake while scanning.
- **Your screen won't re-render at the frame rate.** Each new symbol goes straight to `TossSymbol`. `stats` updates once a second.

## Pausing and resuming

Both hooks have `pause()` and `resume()`. On the receiver, leave the `CameraView` out while `status` is `paused`, to save power. What's arrived is kept in memory.

A transfer can also survive the app closing, and `toss-core` needs no help to do it. The session ID comes from the transfer's content, so sending the same data again with the same settings is the same session.

**Receiver.** Save each frame from `onFrame`. When a header arrives, `meta.sessionId` tells you which saved frames to give back to `restore`:

```tsx
const [onFrame] = useState(() => (frame: Uint8Array) => log.add(frame))
const receive = useTossReceive({ onFrame })
const sessionId = receive.meta?.sessionId

useEffect(() => {
  if (sessionId === undefined) return
  log.open(sessionId).then(receive.restore)
}, [sessionId])
```

`log` is your own storage. `onFrame` runs before `meta` reaches your component, so `log` has to hold new frames until `open` tells it which session they belong to. Damaged frames are skipped, so a log cut short by a crash is safe to pass in. For a long log, restore in batches and yield between them, so the screen stays responsive.

**Sender.** Save `stats.position`, and pass it back as `startPosition` in the next run. Read it once and keep it, because `startPosition` is an option like any other, and changing it restarts the transfer. Starting from the same place only saves time. A receiver gets everything from any starting point.

Anything that changes the header changes the session: the data, `mime`, `kind`, `compress`, and the settings that decide the frame size. If you put anything like a timestamp in `kind`, a transfer can never resume.

For a full example, see [`examples/file-toss/src/lib/use-file-receive.ts`](../examples/file-toss/src/lib/use-file-receive.ts) and its [notes on resuming](../examples/file-toss/README.md#how-resuming-works).

## Tuning

Pass these to `useTossSend` or `TossSender`. The receiver needs no settings, as it reads whatever it sees.

| Option | Default | Notes |
|---|---|---|
| `version` | `30` | QR version, 1 to 40. Larger symbols carry much more and scan nearly as often. Nothing above 30 has been tested |
| `errorCorrection` | `'M'` | `L`, `M`, `Q` or `H`. M beat L at version 30, as L carries more but missed more |
| `fps` | `10` | Symbols per second. 10 gave the best results. Capture fell to 87% at 12 fps and 78% at 15 |
| `mask` | `0` | QR mask, 0 to 7. Must be fixed, because searching for the best one takes too long while sending. Only 0 has been tested |

The defaults are the best settings measured, so change them only with a reason, and measure on real phones, as results depend on the camera and the screen. The `fps` figures come from version 10. The numbers are in [`docs/qr.md`, section 4](qr.md#4-device-spike-results).

A large payload blocks the JS thread while it's prepared, for 0.7-0.9 s at 1 MB, and `preparing` reaches the screen first. Both phones hold the whole payload in memory.

## Permissions

The `expo-toss` plugin sets up the camera and leaves out what toss doesn't use:

- No microphone permission on Android, and no microphone text on iOS.
- No `WRITE_SETTINGS`. Expo adds it for any app with `expo-brightness`, but toss only changes its own window's brightness. An app that calls `setSystemBrightnessAsync` itself can't use this plugin as it stands.

Set your own iOS camera prompt like this:

```json
{ "expo": { "plugins": [["expo-toss", { "cameraPermission": "Scan a theme from another phone" }]] } }
```

Don't list `expo-camera` in `plugins` as well. It only runs once, so an entry above `expo-toss` replaces these settings, and one below it is ignored.

toss itself never uses the network. If your app doesn't either, you can block `INTERNET` with `android.blockedPermissions` in `app.json`, as File Toss does.

## Troubleshooting

**The receiver sees nothing, or stays on `searching`.** Get the whole symbol in view, including its white border, and look out for glare. Check `scansPerSecond`: if it's 0, the camera isn't reading anything.

**It stops short of 100%.** That's usually the loop coming back round. Holding the phone still makes a big difference: in File Toss, a 160 KB file took a couple of minutes with the phone moving around, and a 166 KB file took 30 s held steady.

**`status` is `failed` on the receiver.** `error` says why:

| `error` | Meaning |
|---|---|
| `payload-too-large`, `too-many-frames` | The transfer is over your caps |
| `unsupported-compression`, `unsupported-redundancy` | The sender is on a newer version |
| `hash-mismatch` and the inflate errors | The data didn't survive. `reset()` and try again |

**`status` is `failed` on the sender.** `error` holds the reason. It's usually a `mime` or `kind` that isn't printable ASCII, or too long to fit the symbol.

**`otherSessionFrames` is rising.** The camera sees valid frames from a different transfer, so the sender has probably changed its data. Call `reset()` to follow it.

**`rejectedScans` is rising.** Other QR codes are in view. They're ignored, so this is harmless.

**A permission you removed is back.** Check that `expo-camera` isn't also in `plugins`, then make a new native build. To see what an APK really asks for, run `aapt dump permissions app.apk`.

## Testing without a device

To test how your app handles a payload, call your `onReceive` function directly with the bytes you want to try, including bad ones.

To run a whole transfer, use [`toss-core`](../packages/core) and [`toss-qr`](../packages/qr), which need no device and no React Native. This one loses a third of its symbols:

```ts
import { Decoder, Encoder } from 'toss-core'
import { frameToText, maxFrameBytes, textToFrame } from 'toss-qr'

const encoder = new Encoder(bytes, {
  maxFrameBytes: maxFrameBytes({ version: 30, errorCorrection: 'M' }),
  mime: 'application/json',
  kind: 'my-app/theme',
})
const decoder = new Decoder()

let payload: Uint8Array | undefined
for (let t = 0; !payload; t++) {
  const text = frameToText(encoder.nextFrame())
  if (t % 3 === 0) continue

  const read = textToFrame(text)
  if (read.ok) payload = decoder.push(read.frame).payload
}
```

`SendSession` and `ReceiveSession`, the logic behind the hooks, also take the clock as an argument. They're exported from `toss-react-native`, so your test runner has to be able to load or mock its native modules.
