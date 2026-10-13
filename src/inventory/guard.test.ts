import { guardStep, isPermissionDenied, toCollectionError } from './guard';
import { CollectionError } from './types';

describe('toCollectionError', () => {
  it.each([
    [{ status: 403, data: { message: 'Access denied to this data source' } }, 'Access denied to this data source', 403],
    [{ status: 422, data: { error: 'too many series' } }, 'too many series', 422],
    [{ status: 400, data: 'range too long' }, 'range too long', 400],
    [{ status: 502 }, 'request failed with status 502', 502],
    [new Error('network down'), 'network down', undefined],
  ])('reads %p', (error, message, status) => {
    expect(toCollectionError('ds', 'step', error)).toEqual({
      datasource: 'ds',
      step: 'step',
      message,
      ...(status === undefined ? {} : { status }),
    });
  });
});

describe('isPermissionDenied', () => {
  it.each([
    [401, true],
    [403, true],
    [500, false],
    [undefined, false],
  ])('status %p is %p', (status, expected) => {
    expect(isPermissionDenied({ datasource: 'ds', step: 's', message: 'm', status })).toBe(expected);
  });
});

describe('guardStep', () => {
  it('records the failure and returns undefined', async () => {
    const errors: CollectionError[] = [];

    const value = await guardStep(errors, 'ds', 'names', async () => {
      throw { status: 403, data: { message: 'denied' } };
    });

    expect(value).toBeUndefined();
    expect(errors).toEqual([{ datasource: 'ds', step: 'names', message: 'denied', status: 403 }]);
  });
});
