import { messageOf } from './errors';

describe('messageOf', () => {
  it.each([
    ['the server error text', { status: 500, data: { error: 'plugin unavailable' } }, 'plugin unavailable'],
    [
      'the server message when error is not text',
      { status: 400, data: { error: { code: 1 }, message: 'Bad input' } },
      'Bad input',
    ],
    [
      'the error message when the body has none',
      { status: 502, data: { error: '' }, message: 'Bad Gateway' },
      'Bad Gateway',
    ],
    ['the status when nothing else is usable', { status: 403, data: {} }, 'request failed with status 403'],
    ['a plain error message', new Error('timed out'), 'timed out'],
    ['a thrown string', 'boom', 'boom'],
  ])('returns %s', (_, error, expected) => {
    expect(messageOf(error)).toBe(expected);
  });
});
