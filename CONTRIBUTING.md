# Contributing

toss is a monorepo using npm workspaces, with one package per layer. [`docs/architecture.md`](docs/architecture.md) explains how they fit together.

```
packages/
  core/              toss-core
  qr/                toss-qr
  react-native/      toss-react-native
  expo/              expo-toss
  cli/               toss-cli, an end-to-end harness
examples/
  file-toss/         File Toss, a file transfer app built on all of the above
docs/
```

## Build and test

```sh
npm install
npm run build
npm test
npm run typecheck
```

None of this needs a device. Tests simulate loss, duplicate frames, reordering and joining mid-loop. File Toss isn't a workspace package, and has its own install and scripts. See [its README](examples/file-toss/README.md).

Unit tests can't cover the real path from screen to camera, so changes to how symbols are drawn or scanned need a run on two phones.

## `toss-cli`

Round-trips a file through QR images, so the whole path runs without a device. See [its README](packages/cli/README.md).

## Ground rules

- `docs/protocol.md` is an approved spec. Open a discussion before changing the frame format.
- Each layer depends only on the ones below it, and `toss-core` stays free of I/O.
- Treat received data as untrusted. Enforce caps before allocating.
