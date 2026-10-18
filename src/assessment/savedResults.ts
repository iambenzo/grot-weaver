import { config } from '@grafana/runtime';
import { StackAssessment } from './stackAssessment';

export const MAX_SAVED_RESULTS = 5;
export const MAX_SAVED_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DATABASE = 'semconv-compliance';
const STORE = 'assessments';

export interface SavedResult {
  assessment: StackAssessment;
  savedAtMs: number;
}

export interface SavedResults {
  load(key: string): Promise<SavedResult | undefined>;
  save(key: string, assessment: StackAssessment): Promise<void>;
}

interface Entry extends SavedResult {
  key: string;
  viewer: string;
}

export interface Viewer {
  isSignedIn: boolean;
  orgId: number;
  uid: string;
}

export const noSavedResults: SavedResults = {
  load: async () => undefined,
  save: async () => undefined,
};

export function viewerId(viewer: Viewer | undefined): string | undefined {
  return viewer?.isSignedIn && viewer.uid ? `${viewer.orgId}:${viewer.uid}` : undefined;
}

export function currentViewer(): Viewer | undefined {
  return config.bootData?.user;
}

export function browserSavedResults(
  viewer: () => Viewer | undefined = currentViewer,
  nowMs: () => number = Date.now,
  database: IDBFactory | undefined = globalThis.indexedDB
): SavedResults {
  if (!database) {
    return noSavedResults;
  }
  return {
    async load(key) {
      const id = viewerId(viewer());
      if (!id) {
        return undefined;
      }
      try {
        const entry = await withStore<Entry | undefined>(database, 'readonly', (store) => store.get(`${id}|${key}`));
        void prune(database, nowMs()).catch(() => undefined);
        if (!entry || entry.viewer !== id || nowMs() - entry.savedAtMs > MAX_SAVED_AGE_MS) {
          return undefined;
        }
        return { assessment: entry.assessment, savedAtMs: entry.savedAtMs };
      } catch {
        return undefined;
      }
    },
    async save(key, assessment) {
      const id = viewerId(viewer());
      if (!id) {
        return;
      }
      try {
        const entry: Entry = { key: `${id}|${key}`, viewer: id, assessment, savedAtMs: nowMs() };
        await withStore(database, 'readwrite', (store) => store.put(entry));
        await prune(database, nowMs());
      } catch {
        return;
      }
    },
  };
}

async function prune(database: IDBFactory, nowMs: number): Promise<void> {
  const opened = await openDatabase(database);
  return new Promise((resolve, reject) => {
    const transaction = opened.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const newestFirst = [...(request.result as Entry[])].sort((a, b) => b.savedAtMs - a.savedAtMs);
      newestFirst
        .filter((entry, index) => index >= MAX_SAVED_RESULTS || nowMs - entry.savedAtMs > MAX_SAVED_AGE_MS)
        .forEach((entry) => store.delete(entry.key));
    };
    transaction.oncomplete = () => {
      opened.close();
      resolve();
    };
    transaction.onerror = () => {
      opened.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      opened.close();
      reject(transaction.error ?? new Error('saved results cleanup was aborted'));
    };
  });
}

function withStore<T>(
  database: IDBFactory,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openDatabase(database).then(
    (opened) =>
      new Promise<T>((resolve, reject) => {
        const request = operation(opened.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => {
          opened.close();
          resolve(request.result as T);
        };
        request.onerror = () => {
          opened.close();
          reject(request.error);
        };
      })
  );
}

function openDatabase(database: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = database.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
