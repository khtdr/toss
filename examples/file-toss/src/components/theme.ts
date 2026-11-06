import { useColorScheme } from 'react-native';

const light = {
  background: '#F7F6F2',
  surface: '#FFFFFF',
  text: '#1B1F3B',
  muted: '#5C6079',
  border: '#E3E1DA',
  accent: '#E8552F',
  onAccent: '#FFFFFF',
  warning: '#FFF1DC',
  onWarning: '#6B4300',
  danger: '#B3261E',
};

const dark: typeof light = {
  background: '#12142A',
  surface: '#1E2140',
  text: '#F2F1EC',
  muted: '#A4A7C0',
  border: '#31355C',
  accent: '#FF7A54',
  onAccent: '#1B1F3B',
  warning: '#3D2E12',
  onWarning: '#FFD79A',
  danger: '#FFB4AB',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
