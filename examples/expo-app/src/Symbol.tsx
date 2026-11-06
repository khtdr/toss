import { Canvas, Fill, Group, Path as SkiaPath, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import type { Renderer } from './run';

interface Props {
  paths: string[];
  slot: number;
  modules: number;
  /** Side in layout units. */
  side: number;
  renderer: Renderer;
}

function SvgSymbol({ paths, slot, modules, side }: Omit<Props, 'renderer'>) {
  return (
    <Svg width={side} height={side} viewBox={`0 0 ${modules} ${modules}`} style={{ backgroundColor: '#fff' }}>
      <Path d={paths[slot]} fill="#000" />
    </Svg>
  );
}

function SkiaSymbol({ paths, slot, modules, side }: Omit<Props, 'renderer'>) {
  const parsed = useMemo(() => paths.map((path) => Skia.Path.MakeFromSVGString(path)!), [paths]);
  return (
    <Canvas style={{ width: side, height: side }}>
      <Fill color="#fff" />
      <Group transform={[{ scale: side / modules }]}>
        <SkiaPath path={parsed[slot]!} color="#000" antiAlias={false} />
      </Group>
    </Canvas>
  );
}

export function Symbol({ renderer, ...props }: Props) {
  return renderer === 'skia' ? <SkiaSymbol {...props} /> : <SvgSymbol {...props} />;
}
