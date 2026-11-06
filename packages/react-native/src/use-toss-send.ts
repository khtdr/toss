import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { DEFAULT_SEND_SETTINGS, SendSession } from './send-session.js';
import type { SendSessionOptions, SendSettings, SendStats } from './send-session.js';
import { useFullBrightness, useScreenAwake } from './screen.js';
import type { SymbolSource } from './symbol.js';

export interface TossSendOptions extends Partial<SendSettings> {
  mime: string;
  kind: string;
  /** Compress when that makes the transfer smaller. Defaults to true. */
  compress?: boolean;
  /** Where in the cycle to start. An earlier `stats.position` carries on from there. */
  startPosition?: number;
}

export type TossSendStatus = 'idle' | 'preparing' | 'sending' | 'paused' | 'cancelled' | 'failed';

export interface TossSend {
  status: TossSendStatus;
  /** Pass this to `TossSymbol`. Set while `status` is `sending` or `paused`. */
  symbol: SymbolSource | null;
  /** Data frames in the transfer. Set while `status` is `sending` or `paused`. */
  frameCount: number | null;
  /** Updated once a second. */
  stats: SendStats;
  /** Set when `status` is `failed`. */
  error: Error | null;
  /** Stops sending. A sender can't tell when a receiver finishes, so this is always up to the app. */
  cancel(): void;
  /** Starts again after `cancel`. */
  restart(): void;
  /** Holds the sequence, and lets the screen dim and sleep. */
  pause(): void;
  /** Carries on from the same symbol. */
  resume(): void;
}

const NO_STATS: SendStats = { loops: 0, position: 0, shownFps: 0, skippedSlots: 0 };
const STATS_INTERVAL_MS = 1000;

/** What to send. A new one of these is a new transfer. */
interface Transfer {
  data: Uint8Array;
  options: SendSessionOptions;
}

type Run = { transfer: Transfer } & ({ session: SendSession; error?: never } | { session?: never; error: Error });

interface Player {
  /** Holds or releases the sequence, on top of the app's own state. */
  hold(held: boolean): void;
  stop(): void;
}

/** Shows `session` until `stop` is called. */
function play(session: SendSession, held: boolean, onStats: (stats: SendStats) => void): Player {
  let hidden = false;
  const sync = () => {
    if (held || hidden) session.pause(performance.now());
    else session.resume(performance.now());
  };
  // The state can be unknown at startup, so only a known background state pauses.
  const followApp = (state: string | null | undefined) => {
    hidden = state === 'background' || state === 'inactive';
    sync();
  };
  followApp(AppState.currentState);
  const appState = AppState.addEventListener('change', followApp);

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
  const statsTimer = setInterval(() => onStats(session.stats(performance.now())), STATS_INTERVAL_MS);

  return {
    hold(next) {
      held = next;
      sync();
    },
    stop() {
      appState.remove();
      cancelAnimationFrame(frame);
      clearTimeout(prepareTimer);
      clearInterval(statsTimer);
    },
  };
}

/**
 * Flashes `data` as a looping sequence of QR symbols until it's cancelled, or
 * `data` becomes null. Pass null until the app is ready to send.
 *
 * Any change to `data` or an option starts a new transfer, so keep `data` stable
 * between renders. The new symbols go straight to `TossSymbol`, so the calling
 * component only re-renders for status and stats.
 *
 * `startPosition` counts as an option too, so read it once and keep it.
 *
 * A large payload blocks the JS thread while it's prepared, for 0.7-0.9 s at
 * 1 MB. `preparing` reaches the screen first, but only native animation runs
 * during that time.
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
    startPosition = 0,
  } = options;

  const [run, setRun] = useState<Run | null>(null);
  const [stats, setStats] = useState<SendStats>({ ...NO_STATS, position: startPosition });
  // New data isn't cancelled, so this remembers what was.
  const [cancelledData, setCancelledData] = useState<Uint8Array | null>(null);
  const cancelled = data !== null && data === cancelledData;
  const [pausedData, setPausedData] = useState<Uint8Array | null>(null);
  const paused = data !== null && data === pausedData;
  const pausedNow = useRef(paused);
  const player = useRef<Player | null>(null);

  const transfer = useMemo<Transfer | null>(
    () =>
      data === null || cancelled
        ? null
        : { data, options: { mime, kind, compress, version, errorCorrection, fps, mask, startPosition } },
    [data, cancelled, mime, kind, compress, version, errorCorrection, fps, mask, startPosition],
  );

  useEffect(() => {
    setStats({ ...NO_STATS, position: transfer?.options.startPosition ?? 0 });
    if (transfer === null) {
      setRun(null);
      return;
    }

    let playing: Player | undefined;
    // A separate task, so the `preparing` render reaches the screen before this blocks.
    const startTimer = setTimeout(() => {
      let session: SendSession;
      try {
        session = new SendSession(transfer.data, transfer.options);
      } catch (error) {
        setRun({ transfer, error: error instanceof Error ? error : new Error(String(error)) });
        return;
      }
      setRun({ transfer, session });
      playing = play(session, pausedNow.current, setStats);
      player.current = playing;
    });

    return () => {
      clearTimeout(startTimer);
      playing?.stop();
      player.current = null;
    };
  }, [transfer]);

  useEffect(() => {
    pausedNow.current = paused;
    player.current?.hold(paused);
  }, [paused]);

  // A run left over from an earlier transfer says nothing about this one.
  const current = run?.transfer === transfer ? run : null;
  const session = current?.session ?? null;

  let status: TossSendStatus;
  if (transfer === null) status = cancelled ? 'cancelled' : 'idle';
  else if (current === null) status = 'preparing';
  else if (!session) status = 'failed';
  else status = paused ? 'paused' : 'sending';

  const sending = status === 'sending';
  useScreenAwake(sending);
  useFullBrightness(sending);

  const cancel = useCallback(() => {
    setCancelledData(data);
    setPausedData(null);
  }, [data]);
  const restart = useCallback(() => setCancelledData(null), []);
  const pause = useCallback(() => setPausedData(data), [data]);
  const resume = useCallback(() => setPausedData(null), []);

  return {
    status,
    symbol: session,
    frameCount: session?.frameCount ?? null,
    stats,
    error: current?.error ?? null,
    cancel,
    restart,
    pause,
    resume,
  };
}
