/** RFC 9285. Every character is in the QR alphanumeric set. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET.charCodeAt(i)] = i;

function char(value: number): string {
  return ALPHABET.charAt(value);
}

export function encodeBase45(bytes: Uint8Array): string {
  let text = '';
  const pairs = bytes.length - (bytes.length % 2);
  for (let i = 0; i < pairs; i += 2) {
    const value = bytes[i]! * 256 + bytes[i + 1]!;
    text += char(value % 45) + char(Math.floor(value / 45) % 45) + char(Math.floor(value / 2025));
  }
  if (pairs < bytes.length) {
    const value = bytes[pairs]!;
    text += char(value % 45) + char(Math.floor(value / 45));
  }
  return text;
}

/** The value of the character at `index`, or -1 if it isn't in the alphabet. */
function digit(text: string, index: number): number {
  return VALUES[text.charCodeAt(index)] ?? -1;
}

/** Returns undefined for anything RFC 9285 forbids. Never throws. */
export function decodeBase45(text: string): Uint8Array | undefined {
  const tail = text.length % 3;
  if (tail === 1) return undefined;

  const groups = (text.length - tail) / 3;
  const bytes = new Uint8Array(groups * 2 + (tail === 2 ? 1 : 0));
  for (let group = 0; group < groups; group++) {
    const a = digit(text, group * 3);
    const b = digit(text, group * 3 + 1);
    const c = digit(text, group * 3 + 2);
    const value = a + b * 45 + c * 2025;
    if (a < 0 || b < 0 || c < 0 || value > 0xffff) return undefined;
    bytes[group * 2] = value >> 8;
    bytes[group * 2 + 1] = value & 0xff;
  }
  if (tail === 2) {
    const a = digit(text, groups * 3);
    const b = digit(text, groups * 3 + 1);
    const value = a + b * 45;
    if (a < 0 || b < 0 || value > 0xff) return undefined;
    bytes[groups * 2] = value;
  }
  return bytes;
}
