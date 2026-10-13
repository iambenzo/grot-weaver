import { withLists } from './score';
import { AssessmentResult } from './types';

describe('withLists', () => {
  it('turns null lists from the backend into empty lists', () => {
    const fromBackend = {
      semconv_version: 'v1.44.0',
      window: { start: 0, end: 1 },
      findings: null,
      attributions: null,
      owners: null,
      namespaces: null,
      signals: null,
    } as unknown as AssessmentResult;

    const result = withLists(fromBackend);

    expect(result.attributions).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.metric_attributions).toEqual([]);
  });
});
