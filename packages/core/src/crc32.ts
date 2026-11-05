let table: Int32Array | undefined;

function crcTable(): Int32Array {
  if (table) return table;
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  table = t;
  return t;
}

/** CRC-32 (IEEE 802.3 / zlib). */
export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = -1;
  for (let i = 0; i < bytes.length; i++) {
    c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}
