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
