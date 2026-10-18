import React, { useState } from 'react';
import { CollapsableSection, Stack, Text } from '@grafana/ui';
import { AssessmentResult, Owner } from '../../api/types';
import { OwnerSummary, ownersOfKind } from '../../assessment/overview';
import { testIds } from '../../components/testIds';

const SECTIONS: Array<{ kind: Owner['kind']; label: string; description: string; empty: string }> = [
  {
    kind: 'pipeline',
    label: 'Pipelines',
    description:
      'Findings added on the way rather than by a service, such as labels a collector, Alloy or Grafana Asserts puts on every series. Fix them where they are added, usually the collector or Alloy config.',
    empty: 'No pipeline-introduced findings in this window.',
  },
  {
    kind: 'source',
    label: 'Sources (non-OTel and collector-scraped)',
    description:
      'Telemetry that has no OpenTelemetry SDK service identity, such as exporters scraped by a collector. Fix it in the scrape or exporter config.',
    empty: 'No non-OTel sources in this window.',
  },
  {
    kind: 'unattributed',
    label: 'Unattributed (no service.name)',
    description:
      'Telemetry with no service identity: no service.name, job or service_name to tie it to a service. Set one where it is produced, for example OTEL_SERVICE_NAME in an SDK or the job or service_name label in the scrape or log pipeline.',
    empty: 'All telemetry in this window has a service identity.',
  },
];

export function OwnerSections({ result }: { result: AssessmentResult }) {
  return (
    <Stack direction="column" gap={1} data-testid={testIds.overview.sections}>
      {SECTIONS.map((section) => (
        <OwnerSection
          key={section.kind}
          label={section.label}
          description={section.description}
          empty={section.empty}
          owners={ownersOfKind(result, section.kind)}
        />
      ))}
    </Stack>
  );
}

interface OwnerSectionProps {
  label: string;
  description: string;
  empty: string;
  owners: OwnerSummary[];
}

function OwnerSection({ label, description, empty, owners }: OwnerSectionProps) {
  const [chosenOpen, setChosenOpen] = useState<boolean>();
  const open = chosenOpen ?? owners.length > 0;
  return (
    <CollapsableSection label={`${label} (${owners.length})`} isOpen={open} onToggle={setChosenOpen}>
      <Text element="p" color="secondary" variant="bodySmall">
        {description}
      </Text>
      {owners.length === 0 ? (
        <Text color="secondary">{empty}</Text>
      ) : (
        <Stack direction="column" gap={1}>
          {owners.map((summary) => (
            <div key={`${summary.owner.namespace ?? ''}/${summary.owner.name}`}>
              <Text weight="medium">
                {summary.owner.namespace ? `${summary.owner.namespace}/${summary.owner.name}` : summary.owner.name}
              </Text>
              <Text color="secondary" variant="bodySmall">
                {' '}
                {summary.violations} violations, {summary.findings} findings
              </Text>
              {summary.detail.slice(0, 4).map((line) => (
                <Text key={line} element="p" color="secondary" variant="bodySmall">
                  {line}
                </Text>
              ))}
            </div>
          ))}
        </Stack>
      )}
    </CollapsableSection>
  );
}
