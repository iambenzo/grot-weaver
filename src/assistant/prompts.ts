import { FindingType } from '../api/types';
import { ViolationGroup } from '../assessment/overview';
import { SummaryItem, findingLine, ownerSummary } from '../fix/summary';
import { ownerName } from '../utils/serviceLink';

const MAX_LISTED_SERVICES = 10;
const USES = 'the dashboards, alert rules and recording rules in this stack';

export function findingPrompt(item: SummaryItem, semconvVersion: string): string {
  const { finding } = item;
  return [
    ask(finding.type, [finding.observed], finding.expected),
    '',
    ownerSummary(finding.owner, [item], semconvVersion),
  ].join('\n');
}

export function violationPrompt(
  group: ViolationGroup,
  range: { from: string; to: string },
  semconvVersion: string
): string {
  const lines = [
    ask(group.type, group.observed, group.expected),
    '',
    `OpenTelemetry semantic convention finding across ${group.services} ${
      group.services === 1 ? 'service' : 'services'
    } (semconv ${semconvVersion}, time range ${range.from} to ${range.to})`,
    '',
    findingLine({ type: group.type, signal: group.signal, observed: group.name, expected: group.expected }),
  ];
  if (group.observed.some((name) => name !== group.name)) {
    lines.push(`Sent as: ${group.observed.join(', ')}`);
  }
  if (group.note) {
    lines.push(`Registry note: ${group.note}`);
  }
  lines.push(`Services: ${listed(group.owners.map(ownerName), MAX_LISTED_SERVICES)}`);
  lines.push(`Libraries or SDKs: ${group.libraries.length > 0 ? group.libraries.join(', ') : 'unknown'}`);
  return lines.join('\n');
}

function ask(type: FindingType, observed: string[], expected?: string): string {
  const names = observed.map((name) => `\`${name}\``).join(', ');
  const [is, uses] = observed.length > 1 ? ['are', 'use'] : ['is', 'uses'];
  switch (type) {
    case 'deprecated':
      return expected
        ? `Find ${USES} that use ${names}, and explain how to move each one to \`${expected}\` without a gap in their data.`
        : `${names} ${is} deprecated with no single replacement. Explain which name to use instead, using the registry note below, and find ${USES} that use ${names}.`;
    case 'unit_mismatch':
      return `${names} ${uses} a different unit from the semantic convention for \`${expected}\`. Explain how to fix the unit in the instrumentation or in the pipeline, and find ${USES} that use ${names}, since their queries and units will need to change too.`;
    case 'required_attribute_not_present':
    case 'recommended_attribute_not_present':
      return `Explain how to add \`${expected}\` to ${names}, in the instrumentation or in the pipeline, and which of ${USES} could use it once it is there.`;
    case 'misplaced_attribute':
      return `${names} ${is} set at the wrong scope. Explain how to move it to the scope the semantic conventions expect, and find ${USES} that query it where it is now.`;
    case 'sdk_default_service_name':
      return `This telemetry uses the SDK default service name ${names}. Explain how to set a real service.name, for example with OTEL_SERVICE_NAME or in the pipeline, and find ${USES} that filter on ${names}.`;
    case 'missing_service_name':
      return 'This telemetry has no service.name. Explain how to set one in the instrumentation or in the pipeline, and how to find which workload sends it.';
    default:
      return `Explain this finding and how to fix it, and find ${USES} that use ${names}.`;
  }
}

function listed(items: string[], max: number): string {
  const shown = items.slice(0, max).join(', ');
  const rest = items.length - max;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}
