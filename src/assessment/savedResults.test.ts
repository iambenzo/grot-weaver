import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { MAX_SAVED_AGE_MS, MAX_SAVED_RESULTS, browserSavedResults, noSavedResults, viewerId } from './savedResults';
import { StackAssessment } from './stackAssessment';
import { deserialize, serialize } from 'v8';

globalThis.structuredClone ??= (value) => deserialize(serialize(value));

describe('viewerId', () => {
  it('identifies a signed-in viewer by org and user', () => {
    expect(viewerId({ isSignedIn: true, orgId: 2, uid: 'u1' })).toBe('2:u1');
  });

  it('gives no id to anonymous or unidentified viewers', () => {
    expect(viewerId({ isSignedIn: false, orgId: 1, uid: 'u1' })).toBeUndefined();
    expect(viewerId({ isSignedIn: true, orgId: 1, uid: '' })).toBeUndefined();
    expect(viewerId(undefined)).toBeUndefined();
  });
});

describe('browserSavedResults', () => {
  const untouched = { open: jest.fn() } as unknown as IDBFactory;

  it('saves nothing without IndexedDB', () => {
    expect(browserSavedResults(() => ({ isSignedIn: true, orgId: 1, uid: 'u1' }), Date.now, undefined)).toBe(
      noSavedResults
    );
  });

  it('never touches the database for a viewer who is not signed in, checked on every call', async () => {
    let viewer = { isSignedIn: true, orgId: 1, uid: 'u1' };
    const saved = browserSavedResults(() => viewer, Date.now, untouched);
    viewer = { isSignedIn: false, orgId: 1, uid: 'u1' };

    await expect(saved.load('a')).resolves.toBeUndefined();
    await saved.save('a', {} as never);

    expect(untouched.open).not.toHaveBeenCalled();
  });

  it('reads nothing back when the database cannot be opened', async () => {
    const failing = {
      open: () => {
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onerror?.(new Event('error')), 0);
        return request;
      },
    } as unknown as IDBFactory;
    const saved = browserSavedResults(() => ({ isSignedIn: true, orgId: 1, uid: 'u1' }), Date.now, failing);

    await expect(saved.load('a')).resolves.toBeUndefined();
    await expect(saved.save('a', {} as never)).resolves.toBeUndefined();
  });
});

describe('browserSavedResults with IndexedDB', () => {
  const viewer = () => ({ isSignedIn: true, orgId: 1, uid: 'u1' });
  const assessment = (marker: string) => ({ marker }) as unknown as StackAssessment;

  it('keeps the newest saved results and drops old ones without reading every saved scan', async () => {
    const database = new IDBFactory();
    let nowMs = 1_000_000;
    const saved = browserSavedResults(viewer, () => nowMs, database);
    for (let index = 0; index < MAX_SAVED_RESULTS + 2; index++) {
      nowMs += 1000;
      await saved.save(`run-${index}`, assessment(`run-${index}`));
    }
    const getAll = jest.spyOn(IDBObjectStore.prototype, 'getAll');

    await saved.save('latest', assessment('latest'));

    expect(getAll).not.toHaveBeenCalled();
    getAll.mockRestore();
    expect(await saved.load('run-0')).toBeUndefined();
    expect(await saved.load('run-2')).toBeUndefined();
    expect((await saved.load('run-3'))?.assessment).toEqual(assessment('run-3'));
    expect((await saved.load('latest'))?.assessment).toEqual(assessment('latest'));
  });

  it('drops results older than the maximum age', async () => {
    const database = new IDBFactory();
    let nowMs = 1_000_000;
    const saved = browserSavedResults(viewer, () => nowMs, database);
    await saved.save('old', assessment('old'));
    nowMs += MAX_SAVED_AGE_MS + 1;

    await saved.save('fresh', assessment('fresh'));
    nowMs -= MAX_SAVED_AGE_MS;

    expect(await saved.load('old')).toBeUndefined();
    expect((await saved.load('fresh'))?.assessment).toEqual(assessment('fresh'));
  });

  it('keeps results saved before the timestamp index existed, and prunes them', async () => {
    const database = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = database.open('semconv-compliance', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('assessments', { keyPath: 'key' });
        store.put({ key: '1:u1|legacy', viewer: '1:u1', assessment: assessment('legacy'), savedAtMs: 1_000_000 });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const saved = browserSavedResults(viewer, () => 1_000_500, database);

    expect((await saved.load('legacy'))?.assessment).toEqual(assessment('legacy'));
    await saved.save('next', assessment('next'));
    expect((await saved.load('legacy'))?.assessment).toEqual(assessment('legacy'));

    const expiring = browserSavedResults(viewer, () => 1_000_000 + MAX_SAVED_AGE_MS + 1, database);
    await expiring.save('later', assessment('later'));
    expect(await storedKeys(database)).toEqual(['1:u1|later', '1:u1|next']);
  });

  it('gives up on saved results, rather than waiting, while another tab holds an older version open', async () => {
    const database = new IDBFactory();
    const older = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = database.open('semconv-compliance', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('assessments', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const result = await browserSavedResults(viewer, () => 1, database).load('anything');

    expect(result).toBeUndefined();
    older.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = database.open('semconv-compliance', 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('the abandoned connection was left open'));
    });
    reopened.close();
  });
});

function storedKeys(database: IDBFactory): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const request = database.open('semconv-compliance');
    request.onsuccess = () => {
      const opened = request.result;
      const index = opened.transaction('assessments').objectStore('assessments').index('savedAtMs');
      const keys = index.getAllKeys();
      keys.onsuccess = () => {
        opened.close();
        resolve((keys.result as string[]).sort());
      };
      keys.onerror = () => reject(keys.error);
    };
    request.onerror = () => reject(request.error);
  });
}
