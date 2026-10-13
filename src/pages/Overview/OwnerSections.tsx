import React, { useState } from 'react';
import { CollapsableSection, Stack, Text } from '@grafana/ui';
import { AssessmentResult, Owner } from '../../api/types';
import { OwnerSummary, ownersOfKind } from '../../assessment/overview';
import { testIds } from '../../components/testIds';

const SECTIONS: Array<{ kind: Owner['kind']; label: string; empty: string }> = [
  { kind: 'pipeline', label: 'Pipelines', empty: 'No pipeline-introduced findings in this window.' },
  { kind: 'source', label: 'Sources (non-OTel and collector-scraped)', empty: 'No non-OTel sources in this window.' },
  {
    kind: 'unattributed',
    label: 'Unattributed (no service.name)',
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
          empty={section.empty}
          owners={ownersOfKind(result, section.kind)}
        />
      ))}
    </Stack>
  );
}

function OwnerSection({ label, empty, owners }: { label: string; empty: string; owners: OwnerSummary[] }) {
  const [open, setOpen] = useState(false);
  return (
    <CollapsableSection label={`${label} (${owners.length})`} isOpen={open} onToggle={setOpen}>
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
