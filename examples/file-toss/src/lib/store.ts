import { useSyncExternalStore } from 'react';
import { historyFile } from './files';
import { HistoryStore } from './history';
import type { HistoryEntry } from './history';

export const history = new HistoryStore(historyFile());

export function useHistory(): readonly HistoryEntry[] {
  return useSyncExternalStore(history.subscribe, history.getEntries);
}

export function useEntry(id: string): HistoryEntry | undefined {
  return useHistory().find((entry) => entry.id === id);
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
