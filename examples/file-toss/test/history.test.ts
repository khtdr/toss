import { describe, expect, it, vi } from 'vitest';
import { HistoryStore, displayOrder, findUnfinished, parseHistory } from '../src/lib/history';
import type { HistoryEntry } from '../src/lib/history';

function entry(changes: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'a1',
    direction: 'received',
    name: 'a.txt',
    mime: 'text/plain',
    size: 10,
    status: 'done',
    startedAt: 1,
    updatedAt: 2,
    activeMs: 0,
    session: 'abcd',
    received: 0,
    total: 0,
    position: 0,
    ...changes,
  };
}

function memoryFile(text: string | null = null) {
  const file = { text, read: () => file.text, write: vi.fn((next: string) => void (file.text = next)) };
  return file;
}

describe('parseHistory', () => {
  it('reads what was saved', () => {
    expect(parseHistory(JSON.stringify([entry()]))).toEqual([entry()]);
  });

  it.each([null, '', 'not json', '{}', '3', 'null'])('starts empty from %j', (text) => {
    expect(parseHistory(text)).toEqual([]);
  });

  it('drops only the entries it cannot use', () => {
    const bad = [
      entry({ id: '../evil' }),
      { ...entry(), size: 'big' },
      { ...entry(), status: 'odd' },
      { ...entry(), direction: 'up' },
      { ...entry(), activeMs: null },
      null,
      7,
    ];
    expect(parseHistory(JSON.stringify([...bad, entry({ id: 'ok' })]))).toEqual([entry({ id: 'ok' })]);
  });

  it('treats a transfer left active by a crash as paused', () => {
    expect(parseHistory(JSON.stringify([entry({ status: 'active' })]))[0]!.status).toBe('paused');
  });
});

describe('displayOrder', () => {
  it('puts unfinished transfers first, then newest first', () => {
    const list = [
      entry({ id: 'old', updatedAt: 1 }),
      entry({ id: 'new', updatedAt: 9 }),
      entry({ id: 'waiting', updatedAt: 0, status: 'paused' }),
    ];
    expect(displayOrder(list).map(({ id }) => id)).toEqual(['waiting', 'new', 'old']);
  });
});

describe('findUnfinished', () => {
  it('finds a paused receive for this session only', () => {
    const paused = entry({ id: 'p', status: 'paused' });
    const list = [entry({ id: 'd' }), entry({ id: 's', status: 'paused', direction: 'sent' }), paused];
    expect(findUnfinished(list, 'abcd')).toBe(paused);
    expect(findUnfinished(list, 'ffff')).toBeUndefined();
  });

  it('starts afresh when the same file arrives again after finishing', () => {
    expect(findUnfinished([entry()], 'abcd')).toBeUndefined();
  });
});

describe('HistoryStore', () => {
  it('loads, saves each change, and tells listeners', () => {
    const file = memoryFile(JSON.stringify([entry()]));
    const store = new HistoryStore(file);
    const listener = vi.fn();
    store.subscribe(listener);

    store.add(entry({ id: 'b2' }));
    store.update('a1', { status: 'failed' }, 50);
    expect(store.get('a1')).toMatchObject({ status: 'failed', updatedAt: 50 });
    store.remove('b2');

    expect(listener).toHaveBeenCalledTimes(3);
    expect(new HistoryStore(file).getEntries().map(({ id }) => id)).toEqual(['a1']);
  });

  it('gives React a new list only when something changed', () => {
    const store = new HistoryStore(memoryFile());
    const before = store.getEntries();
    expect(store.getEntries()).toBe(before);
    store.add(entry());
    expect(store.getEntries()).not.toBe(before);
  });
});
