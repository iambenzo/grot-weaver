import { StackAssessment, StackDependencies, assessStack, retryDatasource } from './stackAssessment';
import { ABANDON_GRACE_MS, DependencyFactory, MAX_REUSE_MS, createAssessmentStore } from './assessmentStore';

jest.mock('./stackAssessment', () => ({
  assessStack: jest.fn(),
  retryDatasource: jest.fn(),
  discoverStack: () => ({ metrics: [], traces: [], logs: [] }),
}));

const window = { startSeconds: 0, endSeconds: 3600 };
const settings = {};
const assessment = { progress: [] } as unknown as StackAssessment;

interface Pending {
  deps: StackDependencies;
  resolve: (value: StackAssessment) => void;
}

function controlledRuns(mock: jest.Mock): Pending[] {
  const runs: Pending[] = [];
  mock.mockImplementation(
    (...args: unknown[]) =>
      new Promise<StackAssessment>((resolve) =>
        runs.push({ deps: args[args.length - 1] as StackDependencies, resolve })
      )
  );
  return runs;
}

function storeAt(clock: { nowMs: number }) {
  const signals: AbortSignal[] = [];
  const store = createAssessmentStore(
    (_settings, signal) => {
      signals.push(signal);
      return {} as ReturnType<DependencyFactory>;
    },
    () => clock.nowMs
  );
  return { store, signals };
}

const settle = () => new Promise((resolve) => jest.requireActual('timers').setImmediate(resolve));

beforeEach(() => {
  jest.useRealTimers();
  (assessStack as jest.Mock).mockReset();
  (retryDatasource as jest.Mock).mockReset();
});

describe('assessment store', () => {
  it('shares one run between pages asking for the same range and settings', () => {
    controlledRuns(assessStack as jest.Mock);
    const { store } = storeAt({ nowMs: 0 });

    const first = store.acquire('a', window, settings);
    const second = store.acquire('a', window, settings);

    expect(second).toBe(first);
    expect(assessStack).toHaveBeenCalledTimes(1);
  });

  it('reuses a finished run until it is older than the reuse limit', async () => {
    const runs = controlledRuns(assessStack as jest.Mock);
    const clock = { nowMs: 0 };
    const { store } = storeAt(clock);
    const first = store.acquire('a', window, settings);
    runs[0].resolve(assessment);
    await settle();

    clock.nowMs = MAX_REUSE_MS - 1;
    expect(store.acquire('a', window, settings)).toBe(first);
    clock.nowMs = MAX_REUSE_MS;
    expect(store.acquire('a', window, settings)).not.toBe(first);
    expect(assessStack).toHaveBeenCalledTimes(2);
  });

  it('aborts the superseded run and ignores its late updates', async () => {
    const runs = controlledRuns(assessStack as jest.Mock);
    const { store, signals } = storeAt({ nowMs: 0 });
    const first = store.acquire('a', window, settings);

    store.acquire('b', window, settings);
    runs[0].deps.onProgress?.([{} as never]);
    runs[0].resolve(assessment);
    await settle();

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(first.state).toEqual({ progress: [] });
  });

  it('abandons an unfinished run nobody watches after the grace period', () => {
    jest.useFakeTimers();
    controlledRuns(assessStack as jest.Mock);
    const { store, signals } = storeAt({ nowMs: 0 });
    const run = store.acquire('a', window, settings);

    store.subscribe(run, jest.fn())();
    jest.advanceTimersByTime(ABANDON_GRACE_MS);

    expect(signals[0].aborted).toBe(true);
    expect(store.acquire('a', window, settings)).not.toBe(run);
  });

  it('keeps an unfinished run when the next page subscribes within the grace period', () => {
    jest.useFakeTimers();
    controlledRuns(assessStack as jest.Mock);
    const { store, signals } = storeAt({ nowMs: 0 });
    const run = store.acquire('a', window, settings);

    store.subscribe(run, jest.fn())();
    const next = store.acquire('a', window, settings);
    store.subscribe(next, jest.fn());
    jest.advanceTimersByTime(ABANDON_GRACE_MS);

    expect(next).toBe(run);
    expect(signals[0].aborted).toBe(false);
  });

  it('retries one datasource on the shared run and notifies its watchers', async () => {
    const runs = controlledRuns(assessStack as jest.Mock);
    const retries = controlledRuns(retryDatasource as jest.Mock);
    const { store } = storeAt({ nowMs: 0 });
    const run = store.acquire('a', window, settings);
    const listener = jest.fn();
    store.subscribe(run, listener);
    runs[0].resolve(assessment);
    await settle();

    store.retry(run, 'prom');
    const retried = { progress: [], partial: false } as unknown as StackAssessment;
    retries[0].resolve(retried);
    await settle();

    expect(retryDatasource).toHaveBeenCalledWith(assessment, 'prom', window, settings, expect.anything());
    expect(run.state.assessment).toBe(retried);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('runs a retry clicked during the main run only after it, starting from its final result', async () => {
    const runs = controlledRuns(assessStack as jest.Mock);
    const retries = controlledRuns(retryDatasource as jest.Mock);
    const { store } = storeAt({ nowMs: 0 });
    const run = store.acquire('a', window, settings);
    const partial = { progress: [], partial: true } as unknown as StackAssessment;
    runs[0].deps.onPartial?.(partial);

    store.retry(run, 'loki');
    await settle();
    expect(retryDatasource).not.toHaveBeenCalled();

    const complete = { progress: [], partial: false } as unknown as StackAssessment;
    runs[0].resolve(complete);
    await settle();
    expect(retryDatasource).toHaveBeenCalledWith(complete, 'loki', window, settings, expect.anything());

    const retried = { progress: [], partial: false } as unknown as StackAssessment;
    retries[0].resolve(retried);
    await settle();
    expect(run.state.assessment).toBe(retried);
  });

  it('chains concurrent retries so the second starts from the first one result', async () => {
    const runs = controlledRuns(assessStack as jest.Mock);
    const retries = controlledRuns(retryDatasource as jest.Mock);
    const { store } = storeAt({ nowMs: 0 });
    const run = store.acquire('a', window, settings);
    runs[0].resolve(assessment);
    await settle();

    store.retry(run, 'loki');
    store.retry(run, 'tempo');
    await settle();
    expect(retryDatasource).toHaveBeenCalledTimes(1);

    const afterLoki = { progress: [] } as unknown as StackAssessment;
    retries[0].resolve(afterLoki);
    await settle();
    expect((retryDatasource as jest.Mock).mock.calls[1].slice(0, 2)).toEqual([afterLoki, 'tempo']);
  });

  it('ignores a second click on a retry that is still queued', async () => {
    const runs = controlledRuns(assessStack as jest.Mock);
    controlledRuns(retryDatasource as jest.Mock);
    const { store } = storeAt({ nowMs: 0 });
    const run = store.acquire('a', window, settings);

    store.retry(run, 'loki');
    store.retry(run, 'loki');
    runs[0].resolve(assessment);
    await settle();

    expect(retryDatasource).toHaveBeenCalledTimes(1);
  });

  it('ignores a click on a retry that is already running', async () => {
    const runs = controlledRuns(assessStack as jest.Mock);
    const retries = controlledRuns(retryDatasource as jest.Mock);
    const { store } = storeAt({ nowMs: 0 });
    const run = store.acquire('a', window, settings);
    runs[0].resolve(assessment);
    await settle();

    store.retry(run, 'loki');
    await settle();
    store.retry(run, 'loki');
    retries[0].resolve(assessment);
    await settle();
    store.retry(run, 'loki');
    await settle();

    expect(retryDatasource).toHaveBeenCalledTimes(2);
  });
});
