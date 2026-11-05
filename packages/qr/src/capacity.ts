export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrConfig {
  /** QR symbol version, 1 to 40. A symbol is `17 + 4 × version` modules wide. */
  version: number;
  errorCorrection: ErrorCorrection;
}

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

const LEVELS: readonly string[] = ['L', 'M', 'Q', 'H'];

/** Alphanumeric-mode capacity in characters, indexed by `version - 1`. */
const TEXT_CAPACITY: Record<ErrorCorrection, readonly number[]> = {
  L: [
    25, 47, 77, 114, 154, 195, 224, 279, 335, 395, 468, 535, 619, 667, 758, 854, 938, 1046, 1153,
    1249, 1352, 1460, 1588, 1704, 1853, 1990, 2132, 2223, 2369, 2520, 2677, 2840, 3009, 3183, 3351,
    3537, 3729, 3927, 4087, 4296,
  ],
  M: [
    20, 38, 61, 90, 122, 154, 178, 221, 262, 311, 366, 419, 483, 528, 600, 656, 734, 816, 909, 970,
    1035, 1134, 1248, 1326, 1451, 1542, 1637, 1732, 1839, 1994, 2113, 2238, 2369, 2506, 2632, 2780,
    2894, 3054, 3220, 3391,
  ],
  Q: [
    16, 29, 47, 67, 87, 108, 125, 157, 189, 221, 259, 296, 352, 376, 426, 470, 531, 574, 644, 702,
    742, 823, 890, 963, 1041, 1094, 1172, 1263, 1322, 1429, 1499, 1618, 1700, 1787, 1867, 1966,
    2071, 2181, 2298, 2420,
  ],
  H: [
    10, 20, 35, 50, 64, 84, 93, 122, 143, 174, 200, 227, 259, 283, 321, 365, 408, 452, 493, 557,
    587, 640, 672, 744, 779, 864, 910, 958, 1016, 1080, 1150, 1226, 1307, 1394, 1431, 1530, 1591,
    1658, 1774, 1852,
  ],
};

/** The longest text any symbol holds. Scanned text beyond this can't be ours. */
export const MAX_TEXT_LENGTH = 4296;

/** Characters added to every frame's text. See docs/qr.md. */
export const PREFIX_LENGTH = 1;

export function isErrorCorrection(value: string): value is ErrorCorrection {
  return LEVELS.includes(value);
}

/** The most characters a symbol holds, in alphanumeric mode. */
export function textCapacity({ version, errorCorrection }: QrConfig): number {
  if (!isErrorCorrection(errorCorrection)) {
    throw new RangeError(`unknown error correction level: ${errorCorrection}`);
  }
  const capacity = TEXT_CAPACITY[errorCorrection][version - MIN_VERSION];
  if (capacity === undefined) throw new RangeError(`QR version must be 1 to 40, got ${version}`);
  return capacity;
}

/**
 * The largest frame a symbol carries: the value to give `Encoder` as
 * `maxFrameBytes`. Small symbols return less than a toss frame needs, and
 * `Encoder` throws for those.
 */
export function maxFrameBytes(config: QrConfig): number {
  const chars = textCapacity(config) - PREFIX_LENGTH;
  // Base45 turns 2 bytes into 3 characters, and a last odd byte into 2.
  return Math.floor(chars / 3) * 2 + (chars % 3 === 2 ? 1 : 0);
}

/** The smallest version that holds a frame of `frameBytes`. Throws if none does. */
export function smallestVersion(frameBytes: number, errorCorrection: ErrorCorrection): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    if (maxFrameBytes({ version, errorCorrection }) >= frameBytes) return version;
  }
  throw new RangeError(`no QR version holds ${frameBytes} bytes at level ${errorCorrection}`);
}
