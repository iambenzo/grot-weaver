export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimiter(concurrency: number): Limiter {
  let running = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    running--;
    waiting.shift()?.();
  };

  return async <T>(task: () => Promise<T>) => {
    if (running >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
