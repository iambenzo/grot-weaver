import { AssessmentResult, Finding, Owner } from '../api/types';
import { attributeSelector, escapeString, serviceFilterExpression } from '../inventory/traceql';
import { streamSelector } from '../inventory/loki';

export interface ExploreTarget {
  uid: string;
  type: string;
  query: string;
}

const PANE_ID = 'semconv';

export function exploreUrl(target: ExploreTarget, from: string, to: string): string {
  const query =
    target.type === 'tempo'
      ? { refId: 'A', queryType: 'traceql', query: target.query }
      : { refId: 'A', expr: target.query };
  const panes = {
    [PANE_ID]: {
      datasource: target.uid,
      queries: [{ ...query, datasource: { type: target.type, uid: target.uid } }],
      range: { from, to },
    },
  };
  return `/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}

export function evidenceTarget(
  finding: Finding,
  result: AssessmentResult,
  typeOf: (uid: string) => string | undefined
): ExploreTarget | undefined {
  const uid = datasourceFor(finding, result);
  const type = uid ? typeOf(uid) : undefined;
  if (!uid || !type) {
    return undefined;
  }
  const query = evidenceQuery(finding, result);
  return query ? { uid, type, query } : undefined;
}

function datasourceFor(finding: Finding, result: AssessmentResult): string | undefined {
  const sameOwner = (owner: Owner) =>
    owner.kind === finding.owner.kind &&
    (owner.namespace ?? '') === (finding.owner.namespace ?? '') &&
    owner.name === finding.owner.name;
  switch (finding.signal) {
    case 'traces':
      return result.attributions.find((attribution) => sameOwner(attribution.owner))?.datasource;
    case 'metrics':
      return (
        (result.metric_attributions ?? []).find((attribution) => sameOwner(attribution.owner))?.datasource ??
        result.datasources?.find((ds) => ds.signal === 'metrics')?.uid
      );
    case 'logs':
      return (result.log_attributions ?? []).find((attribution) => sameOwner(attribution.owner))?.datasource;
  }
}

export function ownersIn(attributions: Array<{ owner: Owner; datasource: string }>, datasource?: string): Owner[] {
  return attributions
    .filter((attribution) => attribution.datasource === datasource)
    .map((attribution) => attribution.owner);
}

export function namespaceScope(owner: Owner, owners: Owner[]): string | undefined {
  if (owner.namespace) {
    return owner.namespace;
  }
  const split = owners.some(
    (other) => other.kind === owner.kind && other.name === owner.name && Boolean(other.namespace)
  );
  return split ? '' : undefined;
}

function evidenceQuery(finding: Finding, result: AssessmentResult): string | undefined {
  switch (finding.signal) {
    case 'traces':
      return traceQuery(finding, ownersIn(result.attributions, datasourceFor(finding, result)));
    case 'metrics':
      return metricQuery(finding, result);
    case 'logs':
      return logQuery(finding, ownersIn(result.log_attributions ?? [], datasourceFor(finding, result)));
  }
}

function traceQuery(finding: Finding, owners: Owner[]): string {
  const service = serviceFilterExpression(
    finding.owner.kind === 'unattributed'
      ? { name: '' }
      : { name: finding.owner.name, namespace: namespaceScope(finding.owner, owners) }
  );
  if (
    !finding.observed ||
    finding.type === 'required_attribute_not_present' ||
    finding.type === 'recommended_attribute_not_present'
  ) {
    return `{ ${service} }`;
  }
  const scope = finding.scope === 'resources' ? 'resource' : 'span';
  return `{ ${service} && ${attributeSelector(scope, finding.observed)} != nil }`;
}

function metricQuery(finding: Finding, result: AssessmentResult): string | undefined {
  const owner = ownerMatcher(finding.owner, result);
  const names =
    finding.metrics && finding.metrics.length > 0 ? finding.metrics : finding.observed ? [finding.observed] : [];
  const nameMatcher = `__name__=~"${names.map(escapeRegex).join('|')}"`;
  if (finding.scope === 'metrics' && finding.type !== 'required_attribute_not_present') {
    return `count by (__name__) ({${nameMatcher}, ${quoteLabel(finding.observed)}!=""${owner}})`;
  }
  if (names.length === 0) {
    return undefined;
  }
  return `count by (__name__) ({${nameMatcher}${owner}})`;
}

function ownerMatcher(owner: Owner, result: AssessmentResult): string {
  if (owner.kind === 'pipeline') {
    return '';
  }
  const attribution = (result.metric_attributions ?? []).find(
    (candidate) =>
      candidate.owner.kind === owner.kind &&
      (candidate.owner.namespace ?? '') === (owner.namespace ?? '') &&
      candidate.owner.name === owner.name
  );
  if (owner.kind === 'unattributed') {
    return ', job="", service_name=""';
  }
  if (attribution?.source === 'service_name label') {
    return `, service_name="${escapeString(owner.name)}"`;
  }
  const job = owner.namespace ? `${owner.namespace}/${owner.name}` : owner.name;
  return `, job="${escapeString(job)}"`;
}

function logQuery(finding: Finding, owners: Owner[]): string {
  const selector =
    finding.owner.kind === 'unattributed'
      ? '{service_name="unknown_service"}'
      : streamSelector({ name: finding.owner.name, namespace: namespaceScope(finding.owner, owners) });
  if (!finding.observed || finding.type === 'missing_service_name' || finding.type === 'sdk_default_service_name') {
    return selector;
  }
  return `${selector} | ${finding.observed} != ""`;
}

function quoteLabel(label: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label) ? label : `"${escapeString(label)}"`;
}

function escapeRegex(name: string): string {
  return escapeString(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}
