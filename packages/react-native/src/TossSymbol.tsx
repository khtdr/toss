import { Canvas, Fill, Group, Path, Skia } from '@shopify/react-native-skia';
import { useMemo, useSyncExternalStore } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';
import { crispSide } from './symbol.js';
import type { SymbolSource } from './symbol.js';

export interface TossSymbolProps {
  /** From `useTossSend`. */
  symbol: SymbolSource;
  /** The most room the symbol can take, in layout units. Defaults to the window's width. */
  maxSide?: number;
}

/** Draws the sender's current symbol, including its quiet zone. */
export function TossSymbol({ symbol, maxSide }: TossSymbolProps) {
  const frame = useSyncExternalStore(symbol.subscribe, symbol.getSymbol);
  const path = useMemo(() => Skia.Path.MakeFromSVGString(frame.path), [frame]);
  const { width } = useWindowDimensions();
  const side = crispSide(maxSide ?? width, frame.modules, PixelRatio.get());

  return (
    <Canvas style={{ width: side, height: side }}>
      <Fill color="#fff" />
      {path && (
        <Group transform={[{ scale: side / frame.modules }]}>
          <Path path={path} color="#000" antiAlias={false} />
        </Group>
      )}
    </Canvas>
  );
}
