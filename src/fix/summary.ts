import { Finding, Owner } from '../api/types';

export interface Evidence {
  url: string;
  query: string;
  datasource: string;
}

export interface SummaryItem {
  finding: Finding;
  library?: { name: string; version?: string };
  evidence?: Evidence;
}

const TYPE_TEXT: Record<Finding['type'], string> = {
  conformant: 'conformant',
  deprecated: 'deprecated name',
  unit_mismatch: 'unit mismatch',
  required_attribute_not_present: 'required attribute missing',
  recommended_attribute_not_present: 'recommended attribute missing',
  misplaced_attribute: 'attribute at the wrong scope',
  not_in_registry: 'not in the semconv registry',
  custom: 'custom name',
  sdk_default_service_name: 'SDK default service name',
  missing_service_name: 'no service.name',
};

export function ownerSummary(owner: Owner, items: SummaryItem[], semconvVersion: string): string {
  const lines = [`OpenTelemetry semantic convention findings for ${ownerName(owner)} (semconv ${semconvVersion})`, ''];
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${findingLine(item.finding)}`);
    if (item.finding.note) {
      lines.push(`   Registry note: ${item.finding.note}`);
    }
    lines.push(`   Library or SDK: ${libraryText(item)}`);
    if (item.evidence) {
      lines.push(`   Evidence (${item.evidence.datasource}): ${item.evidence.query}`);
    }
  });
  return lines.join('\n');
}

function findingLine(finding: Finding): string {
  const kind = TYPE_TEXT[finding.type];
  const where = `${finding.signal}${finding.scope ? `, ${finding.scope}` : ''}`;
  if (finding.type === 'required_attribute_not_present' || finding.type === 'recommended_attribute_not_present') {
    return `${kind}: ${finding.expected} on ${finding.observed} (${where})`;
  }
  const expected = finding.expected
    ? `, expected ${finding.expected}`
    : finding.type === 'deprecated'
      ? ', no single replacement'
      : '';
  return `${kind}: ${finding.observed}${expected} (${where})`;
}

function libraryText(item: SummaryItem): string {
  const library = item.library ?? item.finding.library;
  if (!library) {
    return 'unknown';
  }
  return library.version ? `${library.name} ${library.version}` : library.name;
}

function ownerName(owner: Owner): string {
  return owner.namespace ? `${owner.namespace}/${owner.name}` : owner.name;
}
