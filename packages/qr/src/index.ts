export {
  MAX_TEXT_LENGTH,
  MAX_VERSION,
  MIN_VERSION,
  isErrorCorrection,
  maxFrameBytes,
  smallestVersion,
  textCapacity,
} from './capacity.js';
export type { ErrorCorrection, QrConfig } from './capacity.js';
export { QUIET_ZONE_MODULES, textToMatrix } from './matrix.js';
export type { MatrixOptions, QrMask, QrMatrix } from './matrix.js';
export { frameToText, textToFrame } from './text.js';
export type { TextError, TextResult } from './text.js';
