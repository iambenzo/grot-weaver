import { StackAssessment } from './stackAssessment';
import { Load, chooseServiceLoad } from './useStackAssessment';

const ready = (partial: boolean): Load => ({
  status: 'ready',
  assessment: { partial } as StackAssessment,
  window: { startSeconds: 0, endSeconds: 1 },
  progress: [],
  retry: () => undefined,
});
const loading: Load = { status: 'loading', progress: [] };

describe('chooseServiceLoad', () => {
  it('shows the quick view while the full scan is still running', () => {
    expect(chooseServiceLoad(loading, ready(false)).quick).toBe(true);
    expect(chooseServiceLoad(ready(true), ready(false)).quick).toBe(true);
  });

  it('switches to the full scan once it is complete', () => {
    const full = ready(false);

    expect(chooseServiceLoad(full, ready(false))).toEqual({ load: full, quick: false });
  });

  it('keeps the full scan while the quick view is unfinished, and surfaces a failed full scan', () => {
    expect(chooseServiceLoad(ready(true), ready(true)).quick).toBe(false);
    expect(chooseServiceLoad(loading, loading).quick).toBe(false);
    const failed: Load = { status: 'failed', message: 'boom', progress: [] };
    expect(chooseServiceLoad(failed, ready(false))).toEqual({ load: failed, quick: false });
  });
});

describe('chooseServiceLoad with a saved scan that lacks the service', () => {
  it('prefers a complete quick view over the saved full scan', () => {
    const quick = ready(false);

    expect(chooseServiceLoad(ready(false), quick, true)).toEqual({ load: quick, quick: true });
    expect(chooseServiceLoad(ready(false), loading, true).quick).toBe(false);
  });
});
