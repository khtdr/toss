# File Toss

Send a file from one phone to another through the camera. The sender flashes a loop of QR codes and the receiver reads them. There's no network, no account and no pairing.

It's the first real user of `toss`, and it isn't a workspace package. Android only for now.

## What it does

- **Estimates first.** Before anything flashes, the sender shows the expected time, and warns about sore arms in proportion. The receiver shows a live time left.
- **Pause and resume.** Either side can pause. The receiver keeps what's arrived, even if the app is killed, and the sender can pick up from the same place in the loop.
- **History.** Everything sent and received, with paused transfers at the top. Received files stay in the app until they're saved or shared.

Files can be up to 64 MiB. Both phones hold the file in memory, and at 4 KB/s that's about 4.5 hours.

## How resuming works

Nothing here needs `toss-core` to save its state, and the wire format is unchanged.

- Session IDs come from the content, so sending the same file again is the same session. `planTransfer` is deterministic for this reason, and so is the filename in `kind`.
- The receiver logs each new frame to `partial/<session>.log`. When a header arrives, any log for that session is replayed through the new decoder. So resuming needs no choice from anyone: point the camera at the same file.
- The sender saves its loop position, and passes it back as `startPosition`.

A change to the send settings or to `kind`'s format changes the session, so a transfer paused on an older version won't resume.

## How the estimate works

`src/lib/estimate.ts` models the plain loop: each pass catches each block with chance `p`, so the time is the longest of `n` geometric waits. That's why the last few blocks take so long. The range uses the capture rates measured on real phones, 84-92%, and covers the 1 MB run on phones and the middle of a simulated run at every size tested. Compressibility comes from four slices of the file, which also decides whether to compress at all.

## Build

Needs the Android SDK and JDK 21.

```sh
npm install
cd examples/file-toss
npm install
npm run apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

The APK is signed with the debug key, so it's for your own devices only. Publishing needs a real signing key. `eas.json` has `preview` and `production` profiles, but they haven't been run, and EAS would also need to build the linked `packages/` first.

`npm test`, `npm run typecheck` and `npm run lint` need no device. The screen tests run the real screens and hooks in Node, on an in-memory file system in `test/shims.tsx`. `npm run icons` remakes every icon from `docs/logo.png` with `scripts/make-icons.py`, and needs Pillow and numpy.

`npx expo-doctor` reports two failures, both expected: `disableHierarchicalLookup` must stay (see `metro.config.js`), and the root's dev copies of Expo packages look like duplicates. Metro never reads those copies. That setting also hides anything nested in `node_modules/*/node_modules`, which is why `@expo/metro-runtime` is a direct dependency here.

## Check on the phones

Checked on the phones on 2026-11-06: items 1 to 7 passed. For item 1, `aapt dump permissions` on the release APK lists `CAMERA`, `ACCESS_NETWORK_STATE` and the app's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, with no `INTERNET`. For items 5 and 6, both phones were force-stopped mid-transfer and picked up where they left off. Item 8 is still to do. In rough order:

1. **Permissions.** This should list `CAMERA`, and none of the others. The About screen promises there's no internet access, so check this before showing it to anyone.

   ```sh
   adb shell dumpsys package com.khtdr.filetoss | grep -E 'android.permission.(CAMERA|INTERNET|WRITE_SETTINGS|RECORD_AUDIO|SYSTEM_ALERT_WINDOW|VIBRATE|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE)'
   ```

2. **It starts.** Removing `INTERNET` from a release build should be safe, but nothing has shown that yet.
3. **A small file, end to end.** Check full brightness without `WRITE_SETTINGS`, the icon, the splash screen and dark mode.
4. **Save and share.** Try **Save to a folder** and **Share** on a received file, and cancel the folder picker.
5. **Pause.** Pause each side, then resume. Then kill the receiver mid-transfer with `adb shell am force-stop com.khtdr.filetoss`, reopen it, and point it at the same file. The percentage should come back.
6. **Resume the sender** from the history after closing the app.
7. **Estimates.** Send a photo and a text file, and compare the time with the estimate. Real app JSON is still unmeasured.
8. **A large file**, 16 MB or more. Nothing above 1 MB has run on a phone. Watch how long **Preparing** takes on the sender, and whether the receiver freezes after the last block: hashing and writing the file block the JS thread, and there's no progress display for that yet.
