import { createLimiter } from './limiter';

describe('createLimiter', () => {
  it('never runs more tasks at once than allowed', async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const task = () =>
      limit(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
      });

    await Promise.all(Array.from({ length: 7 }, task));

    expect(peak).toBe(2);
  });

  it('keeps going after a task fails', async () => {
    const limit = createLimiter(1);

    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(() => Promise.resolve('next'))).resolves.toBe('next');
  });
});
