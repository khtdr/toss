# toss spike

A throwaway Android app that measures real screen-to-camera throughput. One phone flashes a looping transfer and the other scans it. It runs on the `toss-react-native` hooks, so it's also their first device test. It isn't the planned example app, and it isn't a workspace package.

## Build

Needs the Android SDK and JDK 21.

```sh
npm install
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
4. For the next run, stop and restart the sender with new settings, then tap **Next run** on the receiver. The receiver needs no settings, because it reads them from the transfer.
5. When you're done, tap **Share results** and save or send the JSON. With a cable, `adb logcat -s ReactNativeJS | grep TOSS_SPIKE` shows each run too.

Use the same distance and lighting throughout, or note when they change. Prop the phones up if you can, since a steady hand is hard to repeat.

## What to run

The sender starts at version 30, level M, 10 fps, 50 KB of JSON. Do these in order.

1. **Hooks work.** Run the default. It should finish with `done` and `verified`.
2. **Sender keeps up.** Run 50 KB of `noise`, and note `fps shown` and `slots skipped`. The target is about 10 fps with few skips. Symbols are now drawn and parsed during the run, which the earlier spike never measured. Compare the time with its 4.3-8.8 s.
3. **JSON with compression.** Run 50 KB and 200 KB of `json`, and compare frames and KB/s with `noise`. Rates count the payload's size, so compression should raise them.
4. **Large payload.** Start 1024 KB of `noise`, then of `json`, and note `started in`. That's how long the screen freezes before sending. Finish at least one run, for the 1 MB timing the file transfer app needs.
5. **Memory.** Leave a sender running for 10 minutes or more, and run `adb shell dumpsys meminfo com.khtdr.tossspike | grep TOTAL` every minute or so. It should level off.
6. **Swap the phones**, then repeat step 2.

If time allows, try versions 35 and 40.

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
| `hook` | What `useTossReceive` made of the same scans: its status, error, and whether its payload matched. `ScanLog` decodes separately, so the two should agree |

`captured` is an estimate. It assumes the sender kept to its rate, so check `slots skipped` on the sender.
