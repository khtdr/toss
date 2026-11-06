import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SendSession } from '../src/send-session.js';
import { TossSymbol } from '../src/TossSymbol.js';
import { noise } from './helpers.js';

const skia = vi.hoisted(() => ({ parse: vi.fn((path: string) => ({ path })) }));

vi.mock('@shopify/react-native-skia', () => ({
  Canvas: 'Canvas',
  Fill: 'Fill',
  Group: 'Group',
  Path: 'Path',
  Skia: { Path: { MakeFromSVGString: skia.parse } },
}));
vi.mock('react-native', () => ({
  PixelRatio: { get: () => 3 },
  useWindowDimensions: () => ({ width: 360 }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function session() {
  return new SendSession(noise(3000), {
    version: 10,
    errorCorrection: 'M',
    fps: 10,
    mask: 0,
    mime: 'text/plain',
    kind: 'test',
  });
}

function render(element: React.ReactElement) {
  let root: ReactTestRenderer;
  act(() => {
    root = create(element);
  });
  return root!;
}

describe('TossSymbol', () => {
  beforeEach(() => skia.parse.mockClear());

  it('sizes itself to whole pixels, and scales modules to fit', () => {
    const source = session();
    const root = render(<TossSymbol symbol={source} />);
    const { width } = root.root.findByType('Canvas' as never).props.style;
    expect(width * 3).toBe(16 * 65);
    expect(root.root.findByType('Group' as never).props.transform).toEqual([{ scale: width / 65 }]);
  });

  it('keeps to the room it is given', () => {
    const root = render(<TossSymbol symbol={session()} maxSide={200} />);
    expect(root.root.findByType('Canvas' as never).props.style.width).toBeLessThanOrEqual(200);
  });

  it('turns off anti-aliasing, so module edges stay sharp', () => {
    const root = render(<TossSymbol symbol={session()} />);
    expect(root.root.findByType('Path' as never).props.antiAlias).toBe(false);
  });

  it('follows the session, parsing each symbol once', () => {
    const source = session();
    const root = render(<TossSymbol symbol={source} />);
    source.advance(0);
    act(() => {
      source.advance(100);
    });
    expect(skia.parse).toHaveBeenCalledTimes(2);
    expect(root.root.findByType('Path' as never).props.path).toEqual({ path: source.getSymbol().path });
  });
});
