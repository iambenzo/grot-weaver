import { browserSavedResults, noSavedResults, viewerId } from './savedResults';

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
  it('saves nothing without a signed-in viewer or without IndexedDB', () => {
    expect(browserSavedResults({ isSignedIn: false, orgId: 1, uid: 'u1' }, Date.now, {} as IDBFactory)).toBe(
      noSavedResults
    );
    expect(browserSavedResults({ isSignedIn: true, orgId: 1, uid: 'u1' }, Date.now, undefined)).toBe(noSavedResults);
  });

  it('reads nothing back when the database cannot be opened', async () => {
    const failing = {
      open: () => {
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onerror?.(new Event('error')), 0);
        return request;
      },
    } as unknown as IDBFactory;
    const saved = browserSavedResults({ isSignedIn: true, orgId: 1, uid: 'u1' }, Date.now, failing);

    await expect(saved.load('a')).resolves.toBeUndefined();
    await expect(saved.save('a', {} as never)).resolves.toBeUndefined();
  });
});
