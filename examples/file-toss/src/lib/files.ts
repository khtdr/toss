import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { HistoryEntry, HistoryFile } from './history';
import type { JournalFiles } from './journal';

function folder(...names: string[]): Directory {
  const directory = new Directory(Paths.document, ...names);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function deleteFile(file: File): void {
  if (file.exists) file.delete();
}

/** The app's own copy of a file being sent, kept so a paused transfer can resume. */
export function outgoingFile(id: string): File {
  return new File(folder('outgoing'), id);
}

function receivedFile(entry: Pick<HistoryEntry, 'id' | 'name'>): File {
  return new File(folder('received', entry.id), entry.name);
}

export function writeReceived(entry: Pick<HistoryEntry, 'id' | 'name'>, payload: Uint8Array): void {
  receivedFile(entry).write(payload);
}

const logFile = (session: string) => new File(folder('partial'), `${session}.log`);

export const journalFiles: JournalFiles = {
  async read(session) {
    const file = logFile(session);
    return file.exists ? file.bytes() : null;
  },
  async append(session, bytes) {
    logFile(session).write(bytes, { append: true });
  },
  async remove(session) {
    deleteFile(logFile(session));
  },
};

/** Removes everything on disk that belongs to a history entry. */
export function deleteEntryFiles(entry: HistoryEntry): void {
  if (entry.direction === 'sent') {
    deleteFile(outgoingFile(entry.id));
    return;
  }
  if (entry.session !== null) deleteFile(logFile(entry.session));
  const directory = folder('received', entry.id);
  if (directory.exists) directory.delete();
}

/**
 * Saves through a temporary file and a move, so closing the app halfway through
 * a write can't lose the history. A move is async, so writes queue up.
 */
export function historyFile(): HistoryFile {
  const target = () => new File(Paths.document, 'history.json');
  const temporary = () => new File(Paths.document, 'history.json.tmp');
  let queue: Promise<void> = Promise.resolve();
  let latest: string | null = null;

  return {
    read() {
      for (const file of [target(), temporary()]) {
        if (file.exists) return file.textSync();
      }
      return null;
    },
    write(text) {
      latest = text;
      queue = queue.then(async () => {
        if (latest === null) return;
        const next = latest;
        latest = null;
        try {
          // A move repoints the `File` it's called on, so each save needs a new one.
          const file = temporary();
          file.write(next);
          await file.move(target(), { overwrite: true });
        } catch (error) {
          console.warn('Could not save the history', error);
        }
      });
    },
  };
}

/** Hands a received file to the system. It's never opened here, because it's untrusted. */
export async function shareReceived(entry: HistoryEntry): Promise<void> {
  await Sharing.shareAsync(receivedFile(entry).uri, { mimeType: entry.mime, dialogTitle: entry.name });
}

/** Copies a received file to a folder the person picks. Returns false if they back out. */
export async function saveReceived(entry: HistoryEntry): Promise<boolean> {
  let destination: Directory;
  try {
    destination = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }
  const copy = destination.createFile(entry.name, entry.mime);
  copy.write(await receivedFile(entry).bytes());
  return true;
}
