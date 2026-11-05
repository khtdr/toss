/** Marks a cycle slot that shows the header rather than a data frame. */
export const HEADER_SLOT = -1;

const MIN_CYCLE = 11;
const FRAMES_PER_HEADER = 16;
const SMALL_TRANSFER = 8;

function isPrime(value: number): boolean {
  if (value < 2) return false;
  for (let d = 2; d * d <= value; d++) {
    if (value % d === 0) return false;
  }
  return true;
}

function nextPrime(value: number): number {
  let candidate = value;
  while (!isPrime(candidate)) candidate++;
  return candidate;
}

/**
 * Builds one sender cycle: each slot holds a block index or HEADER_SLOT.
 * The length is prime so a camera that captures every k-th frame can't stay
 * aligned with it and miss the same frames forever. See docs/protocol.md section 8.
 */
export function buildCycle(frameCount: number): Int32Array {
  if (frameCount === 0) return Int32Array.of(HEADER_SLOT);

  const headers = Math.ceil(frameCount / FRAMES_PER_HEADER);
  const length = nextPrime(Math.max(MIN_CYCLE, frameCount + headers));
  const cycle = new Int32Array(length);

  if (frameCount < SMALL_TRANSFER) {
    for (let slot = 0; slot < length; slot++) {
      cycle[slot] = (slot % (frameCount + 1)) - 1;
    }
    return cycle;
  }

  const headerCount = length - frameCount;
  for (let i = 0; i < headerCount; i++) {
    cycle[Math.floor((i * length) / headerCount)] = HEADER_SLOT;
  }
  let index = 0;
  for (let slot = 0; slot < length; slot++) {
    if (cycle[slot] !== HEADER_SLOT) cycle[slot] = index++;
  }
  return cycle;
}
