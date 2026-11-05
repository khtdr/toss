# toss-core protocol, version 1

**Status: approved.** Section 1 records the decisions behind this format.

This spec defines how `toss-core` turns bytes into frames and back. It says nothing about QR, cameras, or text encodings. A frame is a `Uint8Array`, and getting it across the gap is the carrier's job.

## 1. Decisions

### D1. Redundancy: plain looping or fountain codes?

**Decided: plain looping for v1, using the prime-length cycle in section 8. Revisit after the device spike.**

Loss rate decides this, and only the spike can measure it. Plain looping is also a subset of the fountain code we'd pick, so nothing built now gets thrown away. Appendix B has the full trade-off and what would trigger adding one.

### D2. Session ID: derived from content, or random?

**Decided: derived.** The session ID is the first 4 bytes of a SHA-256 over the header's content (section 5).

| | Derived | Random |
|---|---|---|
| Encoder stays pure and deterministic | Yes | No, needs an injected RNG (Hermes has no default `crypto`) |
| Sender restarts with the same data | Receiver keeps its progress | Receiver must start over |
| Two senders, same data and settings | Frames are interchangeable, which is harmless | Treated as separate sessions |
| Same data sent twice on purpose | Looks like one session | Separate sessions |

The last row is the only cost, and the receiver is a fresh `Decoder` per transfer anyway.

### D3. Compression policy

**Decided: on by default, kept only if it makes the body smaller, with `compress: false` to opt out.** The algorithm is raw DEFLATE using `fflate`, as a direct dependency of `toss-core`.

At a few KB/s, compression is likely the cheapest speedup available, because JSON-like data usually shrinks severalfold. Hermes has no built-in `CompressionStream`, so it needs a pure-JS library. Injecting a compressor through config would keep core dependency-free, but a sender could then emit something a receiver can't decode. A fixed algorithm per wire ID rules that out. `fflate` is pure computation, so core stays sans-IO.

### D4. Where the frame text codec lives

**Decided: the carrier layer, as the README leans.** Core emits raw bytes and this spec assumes that. Audio has no text step, so a codec in core would be dead config for that carrier.

### Defaults

- **Payload hash:** SHA-256 truncated to 128 bits. It detects errors but authenticates nothing, because a forger can recompute it. The other 16 bytes would only cost frame space.
- **SHA-256 implementation:** `@noble/hashes`. `Decoder.push` is synchronous, and WebCrypto is async and absent on Hermes by default.
- **`mime` and `kind`:** printable ASCII only, so core never has to validate UTF-8 from untrusted input or depend on `TextDecoder`.
- **Header size:** one header must fit in one frame. Multi-frame headers would add a lot of state to save only very small frames.
- **Encryption:** no wire support. Apps can encrypt before calling `Encoder`, since payloads are opaque. `mime` and `kind` stay visible.

Camera and QR drawing libraries don't affect this spec.

## 2. Conventions

- All multi-byte integers are unsigned big-endian.
- `||` means concatenation.
- CRC-32 is the IEEE 802.3 / zlib variant. Its check value for ASCII `123456789` is `cbf43926`.
- `SHA-256/128` means the first 16 bytes of the SHA-256 digest.

Terms:

- **Payload:** the bytes the app handed to the encoder.
- **Body:** the bytes actually sent, which is the payload after any compression.
- **Block:** one slice of the body, carried by one data frame.

## 3. Carrier contract

A carrier must deliver each frame whole, with its exact length, or not at all. It may lose, duplicate, or reorder frames freely. If it can't preserve length, it must add its own framing.

A carrier sets `maxFrameBytes`, and no frame exceeds it. Frames vary in length, so a carrier that needs uniform symbols (for example, a fixed QR version) pads them itself and strips the padding on receipt.

## 4. Frame envelope

Every frame in every version follows this shape:

```
byte 0        version (high 4 bits) | type (low 4 bits)
bytes 1..     type-specific fields
last 4 bytes  CRC-32 of all preceding bytes
```

Byte 0 and the trailing CRC never move, in any future version. That lets an old decoder tell "a valid frame from a newer protocol" apart from noise and report it clearly.

- **Version:** `1` for this spec. `0` is invalid.
- **Type:** `0` is header, `1` is data, and `2`-`15` are reserved. Decoders ignore frames with a reserved type.

There is no magic number. The CRC already rejects foreign data, with a false-accept rate of about 1 in 4 billion.

## 5. Header frame

Byte 0 is `0x10`. The size is 41 bytes plus `mime` and `kind`.

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 1 | version, type | `0x10` |
| 1 | 4 | `sessionId` | See below |
| 5 | 1 | `compression` | `0` none, `1` raw DEFLATE |
| 6 | 1 | `redundancy` | `0` plain indexed frames |
| 7 | 4 | `frameCount` | `n`, the number of blocks |
| 11 | 4 | `bodySize` | Bytes sent |
| 15 | 4 | `payloadSize` | Bytes after decompression |
| 19 | 16 | `payloadHash` | `SHA-256/128(payload)` |
| 35 | 1 | `mimeLen` | |
| 36 | `mimeLen` | `mime` | Printable ASCII |
| | 1 | `kindLen` | |
| | `kindLen` | `kind` | Printable ASCII, app-defined |
| end-4 | 4 | `crc` | |

**Session ID:** the first 4 bytes of `SHA-256(frame[5 .. end-4])`, meaning everything from `compression` through `kind`. Decoders recompute and verify it.

**Hash scope:** `payloadHash` covers the original payload, so it also catches decompression faults.

**Size relationships.** A header that breaks any of these is rejected:

- `compression = 0` requires `bodySize = payloadSize`.
- `compression ≠ 0` requires `0 < bodySize < payloadSize`.
- `bodySize = 0` if and only if `frameCount = 0`.
- If `bodySize > 0`: `1 ≤ frameCount ≤ bodySize`, and `(frameCount - 1) × blockSize < bodySize` (see section 7).

## 6. Data frame

Byte 0 is `0x11`. Overhead is 13 bytes per frame, or 1.9% at 700-byte frames.

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 1 | version, type | `0x11` |
| 1 | 4 | `sessionId` | |
| 5 | 4 | `index` | `0 ≤ index < n` |
| 9 | rest | `block` | Length is `frame length - 13` |
| end-4 | 4 | `crc` | |

`index` is 32 bits even though the default cap is far lower, because a fountain code needs an ever-growing symbol ID (section 11).

## 7. Chunking

The encoder picks the fewest frames that fit, then spreads the body evenly:

```
maxBlock  = maxFrameBytes - 13
n         = ceil(bodySize / maxBlock)
blockSize = ceil(bodySize / n)
```

Block `i` is `body[i × blockSize .. min((i + 1) × blockSize, bodySize))`. All blocks are `blockSize` long, except that the last may be shorter.

Because `blockSize` is derived from `bodySize` and `frameCount`, the header doesn't need to carry it. A decoder checks every block's length against this formula.

An empty payload has `bodySize = 0` and `n = 0`. The header alone completes the transfer.

The encoder throws at construction if the header doesn't fit in `maxFrameBytes`, or if `maxFrameBytes` is under 14.

## 8. Sender schedule

Decoders accept frames in any order, so this section isn't needed for interoperability. It matters for speed, and for avoiding transfers that never finish.

**The problem:** display and camera can phase-lock, for example when the scanner catches exactly every 2nd frame. If the loop length shares a factor with that period, some frames are never seen. In simulation, a fixed header every 16 slots failed about half of all runs at "every 2nd frame", and all of them at `n = 128`, "every 7th frame". Shuffling each loop didn't help. It was somewhat slower under random loss and up to twice as slow under periodic capture.

**The fix:** make the cycle length prime, so no capture period can stay aligned with it.

```
L = smallest prime ≥ max(11, n + ceil(n / 16))
```

- **`n ≥ 8`:** the cycle has `n` data frames in index order, plus `h = L - n` headers. Header `i` goes at slot `floor(i × L / h)`.
- **`1 ≤ n < 8`:** repeat `[header, 0, 1, ..., n-1]` and cut the sequence at `L` slots.
- **`n = 0`:** emit the header forever.

Slot 0 is always a header. Header overhead is about 6% at large `n`. Small transfers pay more, up to 27% at `n = 8`, but that's only a few extra frames in absolute terms. `nextFrame()` is a pure walk through this cycle, so frame `t` depends only on `t`.

The floor of 11 keeps the cycle from equalling a realistic capture period. A prime cycle of 5, for instance, locks up against "every 5th frame".

## 9. Decoder behaviour

`push()` never throws on bad input. It reports what happened and stays usable.

### States

```
searching --valid header--> locked --all blocks + hash ok--> done
                              |
                              +------hash mismatch---------> failed
```

- **`searching`:** no header yet. Valid data frames from any session are held in a capped pending buffer, so joining mid-loop wastes nothing.
- **`locked`:** the decoder is bound to the first valid header's session. Pending frames for that session are validated and promoted, and all others are dropped. Frames from other sessions are counted and surfaced, so an app can offer "another sender is nearby".
- **`done`:** the payload and metadata are available. Further pushes change nothing and return the same result.
- **`failed`:** terminal. The bad block can't be identified, so the app must call `reset()` to start again. With per-frame CRCs this should only happen through a bug or a hostile sender.

If a sender restarts with different data, the session changes, and the decoder stays locked on the old one. Sans-IO core has no timers, so the app decides when to give up and `reset()`, using the other-session count as a signal.

### Order of checks

Each frame goes through these in order, and the first failure rejects it:

1. Length is at least 14 bytes, and at most `maxFrameBytes` if the app set one.
2. CRC matches.
3. Version is supported. If not, report `unsupported-version`.
4. Type is known. If not, ignore.
5. **Header:** parse with bounds checks, verify the size relationships and ASCII, and recompute the session ID.
6. **Header:** enforce the caps below, and reject unknown values as `unsupported-compression` or `unsupported-redundancy`.
7. **Data, when locked:** session matches, `index < n`, and the block length is exact.

Duplicate indices keep the first copy. A repeated header for the locked session is a no-op.

### Caps

These are checked before any allocation that depends on a received value.

| Option | Default | Applies to |
|---|---|---|
| `maxPayloadBytes` | 16 MiB | `payloadSize` and `bodySize` |
| `maxFrameCount` | 65,536 | `frameCount` |
| `maxPendingBytes` | 256 KiB | Pending buffer, total |
| `maxPendingFrames` | 256 | Pending buffer, total |

Blocks are stored as they arrive, so a hostile header can't force a large allocation by claiming a big size. Memory grows only with data actually received, and the body is assembled at completion.

When the pending buffer is full, new frames are dropped. This can't deadlock, because a header needs no pending space and dropped frames come around again on the next cycle.

### Completion

Once all `n` blocks are held:

1. Assemble the body.
2. Inflate it if `compression = 1`, as a stream that stops once output passes `payloadSize`, and fail unless exactly `payloadSize` bytes come out. This stops a decompression bomb's CPU cost as well as its memory. A capped output buffer alone isn't enough, because `inflateSync` in `fflate` keeps working and truncates silently.
3. Verify the length and `payloadHash`.

### Progress

Before a header arrives, the total is unknown, so `progress` reports `{ received, total: null }`. Afterwards it reports `{ received, total: n }`. With headers at least every 17 slots or so, the unknown period is short.

## 10. Security

Anyone who can see the screen can read the payload, and anyone who can show a screen can forge a transfer. CRCs and hashes detect errors, and authenticate nothing. Apps must treat received payloads, `mime`, and `kind` as untrusted.

## 11. Extension points

- **New compression:** add a value to `compression`. Old decoders report `unsupported-compression`.
- **Fountain code:** add a `redundancy` value. Frames below `n` stay plain blocks. Frames at or above `n` are coded, with `index` acting as the symbol ID that seeds the coefficients. Old decoders report `unsupported-redundancy` instead of stalling. See Appendix B.
- **New frame types:** use a reserved type where old decoders can safely ignore it.
- **Breaking layout changes:** bump the version.

## 12. Worked example

These bytes come from a script using Node's `crypto` and `zlib`. They become the first test vector.

Inputs:

- Payload: the ASCII string `toss across the air gap. ` repeated 4 times, 100 bytes in total
- `mime`: `text/plain`
- `kind`: `demo`
- `maxFrameBytes`: 64
- Compression: none

This gives `maxBlock = 51`, `n = 2`, and `blockSize = 50`.

Header, 55 bytes:

```
10                                  version 1, type header
dc808247                            sessionId
00                                  compression: none
00                                  redundancy: plain
00000002                            frameCount
00000064                            bodySize
00000064                            payloadSize
e44a178d56cce2e43fcaf9a7ffe990dd    payloadHash
0a 746578742f706c61696e             mime
04 64656d6f                         kind
5b4c2c32                            crc
```

Data frame 0, 63 bytes:

```
11 dc808247 00000000
746f7373206163726f73732074686520616972206761702e20
746f7373206163726f73732074686520616972206761702e20
1565dbad
```

Data frame 1, 63 bytes:

```
11 dc808247 00000001
746f7373206163726f73732074686520616972206761702e20
746f7373206163726f73732074686520616972206761702e20
df5b283e
```

The two blocks hold the same text, so only `index` and `crc` differ.

## Appendix A. Simulation

This is a Monte Carlo run of each scheme. Every trial joins at a random point in the loop, and finishes only once it has a header and the full data. Each cell shows **frames displayed ÷ n**, as a mean over 800 trials at `n ≤ 32`, and fewer at larger `n` (down to 25 for RLNC at `n = 512`). Lower is better, and 1.0 is the unreachable ideal.

These are simulated channels, not measurements of real hardware.

| n | Channel | Plain, prime cycle | LT | RLNC |
|---|---|---|---|---|
| 8 | 10% random loss | 1.96 | 1.72 | 1.54 |
| 8 | 30% random loss | 3.39 | 2.41 | 2.16 |
| 8 | 30% loss, bursts of ~6 | 2.60 | 2.51 | 2.10 |
| 32 | 10% random loss | 2.24 | 1.62 | 1.24 |
| 32 | 30% random loss | 3.98 | 2.12 | 1.61 |
| 32 | 30% loss, bursts of ~6 | 3.12 | 2.13 | 1.63 |
| 128 | 10% random loss | 2.70 | 1.57 | 1.20 |
| 128 | 30% random loss | 5.00 | 2.02 | 1.53 |
| 128 | 30% loss, bursts of ~6 | 4.33 | 2.03 | 1.54 |
| 512 | 10% random loss | 3.46 | 1.54 | 1.19 |
| 512 | 30% random loss | 6.16 | 1.97 | 1.52 |
| 512 | 30% loss, bursts of ~6 | 5.61 | 1.95 | 1.54 |

Periodic capture, comparing the prime cycle to a plain loop with a header every 16 slots:

| n | Capture | Header every 16 | Prime cycle |
|---|---|---|---|
| 32 | Every 2nd frame | 9.38, and 50% never finish | 2.27 |
| 128 | Every 2nd frame | 3.17, and 58% never finish | 2.13 |
| 128 | Every 3rd frame | 17.96 | 3.21 |
| 128 | Every 7th frame | All runs never finish | 7.47 |
| 512 | Every 7th frame | 49.01 | 7.47 |

The prime cycle finished every run at every period tested (2, 3, 5, 7), for `n` from 1 to 512. Against random loss it stays within about 10% of the plain loop, and is sometimes slightly slower.

"LT" is a systematic LT code with a robust soliton distribution (`c = 0.1`, `δ = 0.05`) and a peeling decoder. "RLNC" is a systematic dense random linear code over GF(2).

## Appendix B. Fountain code considerations

Plain looping was chosen for v1. This appendix keeps the reasoning for when the question comes back.

**How it works:** with plain looping, the receiver needs every specific frame, so the last missing one can cost a full extra loop. A fountain code sends the plain frames once, then sends frames that each combine a random subset of the blocks. Any set of about `n` independent frames rebuilds the data, so no single frame matters.

**What it would buy** (estimated from Appendix A at 10 fps, about 687 bytes per block):

| Transfer | Loss | Plain | RLNC |
|---|---|---|---|
| 20 KB | 10% | 7 s | 4 s |
| 20 KB | 30% | 12 s | 5 s |
| 300 KB | 30% | 4.5 min | 1.1 min |

At 8 frames or fewer it saves about a second at most.

**Why it wasn't the starting point:**

1. **It may not help real loss.** It only wins when loss is random. Under periodic capture it gains nothing: at `n = 512`, both take 2.13× at every 2nd frame and 3.20× at every 3rd.
2. **More live work on the sender.** A plain loop has a fixed set of frames, so QR codes can be rendered once and flipped through. A fountain sender makes new frames indefinitely, each needing XOR, text encoding, and QR encoding on the JS thread. Precomputing a pool of about `4n` frames and looping it would avoid most of that.
3. **Receiver CPU grows with the square of the frame count.** A rough estimate is 90 MB of XOR in total at `n = 512`, competing with the camera and QR scanning. This is unmeasured on Hermes.
4. **The frame cap would have to drop.** At the default 65,536-frame cap, the coefficient matrix alone would be about 512 MiB. A dense code needs a cap of a few thousand frames, or big transfers split into groups, which is further design work.
5. **The generator joins the wire format.** Sender and receiver must derive identical coefficients from each frame's `index`, permanently.
6. **Harder debugging.** A plain frame is a readable slice of the body, while a coded frame is noise until the whole transfer decodes.

**Add one if** the spike shows sustained random-looking loss above about 20%, or real transfers run above about 50 KB. Estimated size is 150-200 lines.

**If we do:**

- Use a systematic random linear code rather than LT. It needed about 23% fewer frames than LT from `n = 32` up, and has no degree distribution or peeling logic.
- Keep the plain cycle as the first pass, so existing code is reused.
- Use a coefficient generator that isn't linear over GF(2). The first simulation run used xorshift, rows stopped being independent at around 32 frames, and large transfers never completed.
- Add a size-appropriate `maxFrameCount` for the new `redundancy` value.
