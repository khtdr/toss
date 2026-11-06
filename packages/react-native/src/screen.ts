import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useId } from 'react';

/** Holds the screen on while `active`. Each caller gets its own tag. */
export function useScreenAwake(active: boolean): void {
  const tag = useId();
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(tag).catch(() => {});
    return () => {
      deactivateKeepAwake(tag).catch(() => {});
    };
  }, [active, tag]);
}

/** Runs the screen at full brightness while `active`. This only affects this app. */
export function useFullBrightness(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    Brightness.setBrightnessAsync(1).catch(() => {});
    return () => {
      Brightness.restoreSystemBrightnessAsync().catch(() => {});
    };
  }, [active]);
}
