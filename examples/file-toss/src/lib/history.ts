export type Direction = 'sent' | 'received';

/** `active` only lasts while a screen is open. A crash leaves it behind, and loading fixes that. */
export type TransferStatus = 'active' | 'paused' | 'done' | 'failed';

export interface HistoryEntry {
  id: string;
  direction: Direction;
  name: string;
  mime: string;
  /** The file's size in bytes. */
  size: number;
  status: TransferStatus;
  /** Epoch milliseconds. */
  startedAt: number;
  updatedAt: number;
  /** Time actually spent transferring, leaving out pauses. */
  activeMs: number;
  /** Which transfer on the air this is, as hex. Null until it's known. */
  session: string | null;
  /** Receiver: blocks held and blocks needed. */
  received: number;
  total: number;
  /** Sender: the place in the loop, to pick up from. */
  position: number;
}

const STATUSES: readonly string[] = ['active', 'paused', 'done', 'failed'];
const DIRECTIONS: readonly string[] = ['sent', 'received'];

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    /^[\w-]+$/.test(entry.id) &&
    DIRECTIONS.includes(entry.direction as string) &&
    STATUSES.includes(entry.status as string) &&
    typeof entry.name === 'string' &&
    typeof entry.mime === 'string' &&
    (entry.session === null || typeof entry.session === 'string') &&
    ['size', 'startedAt', 'updatedAt', 'activeMs', 'received', 'total', 'position'].every(
      (key) => typeof entry[key] === 'number' && Number.isFinite(entry[key]),
    )
  );
}

/** Reads saved history. Anything unreadable is dropped, so a bad file can't stop the app opening. */
export function parseHistory(text: string | null): HistoryEntry[] {
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isEntry)
    .map((entry) => (entry.status === 'active' ? { ...entry, status: 'paused' as const } : entry));
}

/** Newest first, with anything unfinished above the rest. */
export function displayOrder(entries: readonly HistoryEntry[]): HistoryEntry[] {
  const waiting = (entry: HistoryEntry) => (entry.status === 'paused' || entry.status === 'active' ? 0 : 1);
  return [...entries].sort((a, b) => waiting(a) - waiting(b) || b.updatedAt - a.updatedAt);
}

/** The unfinished receive for a transfer on the air, if there is one. */
export function findUnfinished(entries: readonly HistoryEntry[], session: string): HistoryEntry | undefined {
  return entries.find(
    (entry) =>
      entry.direction === 'received' &&
      entry.session === session &&
      (entry.status === 'paused' || entry.status === 'active'),
  );
}

export interface HistoryFile {
  read(): string | null;
  write(text: string): void;
}

/** Holds the history, and saves each change. Fits `useSyncExternalStore`. */
export class HistoryStore {
  private entries: HistoryEntry[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly file: HistoryFile) {
    this.entries = parseHistory(file.read());
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getEntries = (): readonly HistoryEntry[] => this.entries;

  get(id: string): HistoryEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  add(entry: HistoryEntry): void {
    this.commit([...this.entries, entry]);
  }

  update(id: string, changes: Partial<Omit<HistoryEntry, 'id'>>, now: number): void {
    this.commit(
      this.entries.map((entry) => (entry.id === id ? { ...entry, ...changes, updatedAt: now } : entry)),
    );
  }

  remove(id: string): void {
    this.commit(this.entries.filter((entry) => entry.id !== id));
  }

  private commit(entries: HistoryEntry[]): void {
    this.entries = entries;
    this.file.write(JSON.stringify(entries));
    for (const listener of this.listeners) listener();
  }
}
