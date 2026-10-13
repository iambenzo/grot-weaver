import { readSettings } from './settings';

describe('readSettings', () => {
  it.each([
    [undefined, {}],
    [null, {}],
    ['text', {}],
    [{ defaultWindow: 'now-7d' }, { defaultWindow: 'now-7d' }],
    [{ defaultWindow: 7 }, {}],
  ])('reads %p', (jsonData, expected) => {
    expect(readSettings(jsonData)).toEqual(expected);
  });
});
