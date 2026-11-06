# toss-cli

Encodes a file to QR PNG frames and decodes them back, so the whole [toss](../../README.md) path runs without a device. It's a test harness, not a layer: nothing depends on it.

```sh
npm run build
node packages/cli/dist/bin.js encode theme.json -o frames/ --mime application/json --kind theme
node packages/cli/dist/bin.js decode frames/ -o theme-copy.json
```

Each PNG holds one frame, drawn by `toss-qr`.

| Option | |
|---|---|
| `--frame-bytes` | Picks the smallest QR version that fits |
| `--qr-version` | Fills a chosen version instead |
| `--loops` | Writes more than one cycle, so you can delete images to simulate loss |

Scanning PNGs with `jsqr` stays here, because on a device the camera does that job.

## Licence

MIT
