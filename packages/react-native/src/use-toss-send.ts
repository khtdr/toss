import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SEND_SETTINGS, SendSession } from './send-session.js';
import type { SendSettings, SendStats } from './send-session.js';
import { useFullBrightness, useScreenAwake } from './screen.js';
import type { SymbolSource } from './symbol.js';

export interface TossSendOptions extends Partial<SendSettings> {
  mime: string;
  kind: string;
  /** Compress when that makes the transfer smaller. Defaults to true. */
  compress?: boolean;
}

export type TossSendStatus = 'idle' | 'sending' | 'cancelled' | 'failed';

export interface TossSend {
  status: TossSendStatus;
  /** Pass this to `TossSymbol`. Set while `status` is `sending`. */
  symbol: SymbolSource | null;
  /** Data frames in the transfer. Set while `status` is `sending`. */
  frameCount: number | null;
  /** Updated once a second. */
  stats: SendStats;
  /** Set when `status` is `failed`. */
  error: Error | null;
  /** Stops sending. A sender can't tell when a receiver finishes, so this is always up to the app. */
  cancel(): void;
  /** Starts again after `cancel`. */
  restart(): void;
}

const NO_STATS: SendStats = { loops: 0, shownFps: 0, skippedSlots: 0 };
const STATS_INTERVAL_MS = 1000;

type Run =
  | { status: 'idle' | 'cancelled' }
  | { status: 'sending'; session: SendSession }
  | { status: 'failed'; error: Error };

/**
 * Flashes `data` as a looping sequence of QR symbols until it's cancelled, or
 * `data` becomes null. Pass null until the app is ready to send.
 *
 * Any change to `data` or an option starts a new transfer, so keep `data` stable
 * between renders. The new symbols go straight to `TossSymbol`, so the calling
 * component only re-renders for status and stats.
 */
export function useTossSend(data: Uint8Array | null, options: TossSendOptions): TossSend {
  const {
    mime,
    kind,
    compress = true,
    version = DEFAULT_SEND_SETTINGS.version,
    errorCorrection = DEFAULT_SEND_SETTINGS.errorCorrection,
    fps = DEFAULT_SEND_SETTINGS.fps,
    mask = DEFAULT_SEND_SETTINGS.mask,
  } = options;

  const [run, setRun] = useState<Run>({ status: 'idle' });
  const [stats, setStats] = useState(NO_STATS);
  // New data isn't cancelled, so this remembers what was.
  const [cancelledData, setCancelledData] = useState<Uint8Array | null>(null);
  const cancelled = data !== null && data === cancelledData;

  useEffect(() => {
    setStats(NO_STATS);
    if (data === null || cancelled) {
      setRun({ status: cancelled ? 'cancelled' : 'idle' });
      return;
    }

    let session: SendSession;
    try {
      session = new SendSession(data, { mime, kind, compress, version, errorCorrection, fps, mask });
    } catch (error) {
      setRun({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
      return;
    }
    setRun({ status: 'sending', session });

    let prepareTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const tick = () => {
      if (session.advance(performance.now())) {
        // Later than this tick, so React can put the new symbol on screen first.
        prepareTimer = setTimeout(() => session.prepare());
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const statsTimer = setInterval(() => setStats(session.stats(performance.now())), STATS_INTERVAL_MS);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(prepareTimer);
      clearInterval(statsTimer);
    };
  }, [data, cancelled, mime, kind, compress, version, errorCorrection, fps, mask]);

  const sending = run.status === 'sending';
  useScreenAwake(sending);
  useFullBrightness(sending);

  const cancel = useCallback(() => setCancelledData(data), [data]);
  const restart = useCallback(() => setCancelledData(null), []);

  return {
    status: run.status,
    symbol: run.status === 'sending' ? run.session : null,
    frameCount: run.status === 'sending' ? run.session.frameCount : null,
    stats,
    error: run.status === 'failed' ? run.error : null,
    cancel,
    restart,
  };
}
