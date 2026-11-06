import { useTossReceive } from 'expo-toss';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { SittingClock, estimateFrames, effortOf } from './estimate';
import type { Effort } from './estimate';
import { journalFiles, writeReceived } from './files';
import { kindToName, safeMime } from './filename';
import { findUnfinished } from './history';
import type { HistoryEntry } from './history';
import { FrameJournal, RESTORE_BATCH } from './journal';
import { LINK, MAX_FILE_BYTES } from './settings';
import { history, newId } from './store';

const SAVE_EVERY_MS = 3000;

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve));

/**
 * `useTossReceive` plus everything that makes it a file transfer: a journal on
 * disk, so it survives the app closing, and a history entry.
 *
 * Resuming needs no choice from anyone. When a transfer's header arrives, any
 * frames kept for that session are loaded, so pointing the camera at the same
 * file picks it up.
 */
export function useFileReceive() {
  const [journal] = useState(() => new FrameJournal(journalFiles));
  const [clock] = useState(() => new SittingClock());
  const [onFrame] = useState(() => (frame: Uint8Array) => journal.add(frame));
  const receive = useTossReceive({ maxPayloadBytes: MAX_FILE_BYTES, onFrame });
  const { status, meta, payload, progress, restore, pause: pauseScanning, resume: resumeScanning } = receive;

  const [entryId, setEntryId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  const session = meta?.sessionId.toString(16).padStart(8, '0') ?? null;
  const missing = progress.total === null ? 0 : progress.total - progress.received;

  // Read by timers and cleanups, which would otherwise see an old render.
  const latest = useRef({ entryId, progress, activeMs: 0, sittingFrom: null as number | null });
  useEffect(() => {
    latest.current.entryId = entryId;
    latest.current.progress = progress;
  });

  const saveProgress = useCallback((changes: Partial<HistoryEntry> = {}) => {
    const { entryId: id, progress: { received, total }, activeMs, sittingFrom } = latest.current;
    if (id === null) return;
    const sitting = sittingFrom === null ? 0 : performance.now() - sittingFrom;
    history.update(id, { received, total: total ?? 0, activeMs: activeMs + sitting, ...changes }, Date.now());
  }, []);

  // Find or start the history entry when a transfer locks, and load what's kept.
  useEffect(() => {
    if (session === null || meta === undefined) return;
    let stale = false;
    const load = async () => {
      const now = Date.now();
      const existing = findUnfinished(history.getEntries(), session);
      const id = existing?.id ?? newId();
      if (existing) {
        latest.current.activeMs = existing.activeMs;
        history.update(id, { status: 'active' }, now);
      } else {
        latest.current.activeMs = 0;
        history.add({
          id,
          direction: 'received',
          name: kindToName(meta.kind),
          mime: safeMime(meta.mime),
          size: meta.payloadSize,
          status: 'active',
          startedAt: now,
          updatedAt: now,
          activeMs: 0,
          session,
          received: 0,
          total: 0,
          position: 0,
        });
      }
      latest.current.entryId = id;
      setEntryId(id);

      setRestoring(true);
      const frames = await journal.open(session);
      for (let at = 0; at < frames.length && !stale; at += RESTORE_BATCH) {
        restore(frames.slice(at, at + RESTORE_BATCH));
        await nextTask();
      }
      if (stale) return;
      setRestoring(false);
    };
    load().catch((error: unknown) => {
      console.warn('Could not load the kept frames', error);
      if (!stale) setRestoring(false);
    });
    return () => {
      stale = true;
    };
    // `meta` arrives with `session`, and only a new session means new work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Each spell of scanning gets its own clock, so a pause doesn't drag the estimate down.
  const scanning = status === 'receiving' && !restoring;
  useEffect(() => {
    if (!scanning) return;
    clock.start(performance.now(), missing);
    const state = latest.current;
    state.sittingFrom = performance.now();
    return () => {
      if (state.sittingFrom !== null) state.activeMs += performance.now() - state.sittingFrom;
      state.sittingFrom = null;
    };
    // The clock starts from `missing` as it stood, and mustn't restart as it falls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, clock]);

  // Once a second is plenty, and it stops the figure flickering with each block.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const remaining = useRef({ missing, total: progress.total });
  useEffect(() => {
    remaining.current = { missing, total: progress.total };
  }, [missing, progress.total]);
  useEffect(() => {
    if (!scanning) return;
    const update = () => {
      const { missing: left, total } = remaining.current;
      if (total) setSecondsLeft(clock.secondsLeft(performance.now(), left, total, LINK));
    };
    const timer = setInterval(update, 1000);
    const first = setTimeout(update);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [scanning, clock]);

  // Save as it goes, as the system can close a backgrounded app without warning.
  useEffect(() => {
    if (!scanning) return;
    const save = () => {
      void journal.flush();
      saveProgress();
    };
    const timer = setInterval(save, SAVE_EVERY_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') save();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [scanning, journal, saveProgress]);

  // Leaving the screen is the same as pausing.
  useEffect(
    () => () => {
      const id = latest.current.entryId;
      void journal.close();
      if (id === null) return;
      if (history.get(id)?.status === 'active') saveProgress({ status: 'paused' });
    },
    [journal, saveProgress],
  );

  const finish = useCallback(async () => {
    const id = latest.current.entryId;
    const entry = id === null ? undefined : history.get(id);
    if (!entry || !payload) return;
    try {
      writeReceived(entry, payload);
    } catch (error) {
      console.warn('Could not save the file', error);
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    setSaved(true);
    saveProgress({ status: 'done', received: progress.total ?? 0, total: progress.total ?? 0 });
    await journal.discard();
  }, [journal, payload, progress.total, saveProgress]);

  useEffect(() => {
    if (status !== 'done' || entryId === null || restoring || saved) return;
    const timer = setTimeout(() => void finish());
    return () => clearTimeout(timer);
  }, [status, entryId, restoring, saved, finish]);

  // A failure means the kept frames can't be trusted either.
  useEffect(() => {
    if (status !== 'failed' || entryId === null) return;
    saveProgress({ status: 'failed' });
    void journal.discard();
  }, [status, entryId, journal, saveProgress]);

  const startOver = useCallback(() => {
    latest.current.entryId = null;
    latest.current.activeMs = 0;
    setEntryId(null);
    setSaved(false);
    setSaveFailed(false);
    setSecondsLeft(null);
    receive.reset();
    // `reset` is stable for the life of the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = useCallback(() => {
    pauseScanning();
    void journal.flush();
    saveProgress({ status: 'paused' });
  }, [journal, pauseScanning, saveProgress]);

  const resume = useCallback(() => {
    resumeScanning();
    saveProgress({ status: 'active' });
  }, [resumeScanning, saveProgress]);

  /** Keeps this transfer paused, and moves on to whatever the other phone is showing now. */
  const switchTransfer = useCallback(async () => {
    saveProgress({ status: 'paused' });
    await journal.close();
    startOver();
  }, [journal, saveProgress, startOver]);

  /** Throws away this transfer and what's arrived. */
  const discard = useCallback(async () => {
    const id = latest.current.entryId;
    await journal.discard();
    if (id !== null) history.remove(id);
    startOver();
  }, [journal, startOver]);

  const effort: Effort | null = progress.total && !restoring ? effortOf(estimateFrames(missing, LINK)) : null;

  return {
    receive,
    entry: entryId === null ? undefined : history.get(entryId),
    restoring,
    saved,
    saveFailed,
    secondsLeft,
    effort,
    pause,
    resume,
    retrySave: finish,
    switchTransfer,
    discard,
    startOver,
  };
}
