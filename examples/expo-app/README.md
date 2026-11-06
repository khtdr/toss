# toss spike

A throwaway Android app that measures real screen-to-camera throughput. One phone flashes a looping transfer and the other scans it. It isn't the planned example app, and it isn't a workspace package, so its dependencies stay out of the root install.

## Build

Needs the Android SDK and JDK 21.

```sh
cd examples/expo-app
npm install
npm run apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Install it on both phones. It needs no server or network. The APK is signed with the debug key, so it's for your own devices only.

## Run a test

1. On one phone, tap **Send**, choose settings, and tap **Start**. Tap the screen to stop.
2. On the other, tap **Receive** and allow the camera. Hold it so the code fills most of the view.
3. The run ends by itself when the transfer finishes. Tap **End run** to give up on one that stalls.
4. For the next run, stop and restart the sender with new settings. The receiver needs no settings, because it reads them from the transfer.
5. When you're done, tap **Share results** and save or send the JSON. With a cable, `adb logcat -s ReactNativeJS | grep TOSS_SPIKE` shows each run too.

Use the same distance and lighting throughout, or note when they change. Prop the phones up if you can, since a steady hand is hard to repeat.

## What to run

Do these in order, and stop a stage early once results stop improving. Use 20 KB unless noted.

1. **Scanner check, once.** On the sender, tap **Show scanner check**. The receiver should say `exact`. `CHANGED` means the scanner altered spaces, which matters for `docs/qr.md`.
2. **Find the scan rate ceiling.** Version 10, level M, SVG. Run 5, 10, 15 and 20 fps. Watch `scans/s` on the receiver: this is how fast the camera path can go, whatever the sender does.
3. **Find the largest reliable symbol.** At the best rate from step 2, run versions 10, 15, 20, 25 and 30. Larger symbols carry more per frame but scan less reliably.
4. **Compare error correction.** With the best version so far, run L, M and Q.
5. **Compare renderers.** Repeat the best setting with Skia. Note the sender's `fps shown` and `slots skipped` for each.
6. **Check a large transfer.** Run the best setting at 200 KB. Note the `drew` figure on the sender, which is the startup cost on Hermes.
7. **Swap the phones**, then repeat the best setting.

## Reading the results

| Field | Meaning |
|---|---|
| `payloadBytesPerSecond` | The headline number, for comparison with the README's guess of a few KB/s |
| `scansPerSecond` | Scanner callbacks per second, including repeats of the same symbol |
| `captured` | Share of displayed symbols seen. `1 - captured` is the loss |
| `steps` | Distance between successive frames. One dominant step suggests phase lock, and a spread of small steps suggests random loss |
| `msTo` | Time to the first header and to 50%, 90% and 100% of the blocks. A long gap from 90% to 100% is the case a fountain code helps |
| `longestStallMs` | Longest wait between new blocks |
| `displayValueDiffers` | Times ML Kit's display value differed from its raw value. The app decodes the raw value |
| `rejected` | Why scans were refused. `bad-crc` or `bad-base45` would mean a scanner returned damaged text |
| `verified` | The payload matched what the sender should have sent |

`captured` is an estimate. It assumes the sender kept to its rate, so check `slots skipped` on the sender.
