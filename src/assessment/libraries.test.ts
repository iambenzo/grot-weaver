import { Finding } from '../api/types';
import { LibraryEvidence } from '../inventory/traceLibraries';
import { findingKey } from './traceAssessment';
import { libraryInfo } from './libraries';

const checkout = { kind: 'service' as const, name: 'checkout' };
const traceFinding: Finding = {
  type: 'deprecated',
  signal: 'traces',
  owner: checkout,
  observed: 'http.method',
  matched: 'http.method',
  scope: 'spans',
  volume: 0,
  impact_share: 0,
};
const metricFinding: Finding = { ...traceFinding, signal: 'metrics', observed: 'http_method', scope: 'metrics' };
const evidence = (confidence: 'high' | 'medium'): LibraryEvidence => ({
  libraries: [{ name: '@opentelemetry/instrumentation-http', version: '0.218.0' }],
  confidence,
  method: 'metrics',
});

describe('libraryInfo', () => {
  it('uses the trace lookup for trace findings', () => {
    const info = libraryInfo(traceFinding, new Map([[findingKey(traceFinding), evidence('high')]]), [traceFinding]);
    expect(info).toMatchObject({ confidence: 'high', description: 'from TraceQL metrics' });
  });

  it('uses the scope library for metric findings', () => {
    const scoped = {
      ...metricFinding,
      library: { name: 'flask', version: '1', evidence: 'otel_scope_name label', confidence: 'high' as const },
    };
    expect(libraryInfo(scoped, new Map(), [scoped])).toMatchObject({
      libraries: [{ name: 'flask', version: '1' }],
      description: 'from otel_scope_name label',
    });
  });

  it.each([
    ['high trace evidence gives a medium hint', 'high', 'medium'],
    ['medium trace evidence gives a low hint', 'medium', 'low'],
  ] as const)('%s', (_name, traceConfidence, hintConfidence) => {
    const info = libraryInfo(metricFinding, new Map([[findingKey(traceFinding), evidence(traceConfidence)]]), [
      traceFinding,
      metricFinding,
    ]);
    expect(info).toMatchObject({ likely: true, confidence: hintConfidence });
  });

  it('gives no hint for other services or other attributes', () => {
    const other = { ...traceFinding, owner: { kind: 'service' as const, name: 'payments' } };
    expect(
      libraryInfo(metricFinding, new Map([[findingKey(other), evidence('high')]]), [other, metricFinding])
    ).toBeUndefined();
  });
});
