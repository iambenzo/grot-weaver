import React from 'react';
import { Column, InteractiveTable, LinkButton, Stack, Text } from '@grafana/ui';
import { ViolationGroup } from '../../assessment/overview';
import { testIds } from '../../components/testIds';
import { ownerName, serviceLink } from './ServicesTable';

const MAX_ROWS = 25;

const TYPE_LABELS: Record<string, string> = {
  deprecated: 'Deprecated',
  unit_mismatch: 'Unit mismatch',
  required_attribute_not_present: 'Required missing',
  not_in_registry: 'Not in registry',
  sdk_default_service_name: 'SDK default service name',
  missing_service_name: 'No service name',
};

interface TopViolationsProps {
  groups: ViolationGroup[];
  range: { from: string; to: string };
}

export function TopViolations({ groups, range }: TopViolationsProps) {
  if (groups.length === 0) {
    return <Text color="secondary">No violations for this signal in this window.</Text>;
  }
  const columns: Array<Column<ViolationGroup>> = [
    {
      id: 'name',
      header: 'Found → expected',
      cell: ({ row }) => (
        <span>
          <code>{row.original.name || '(empty)'}</code>
          {row.original.expected && row.original.expected !== row.original.name && (
            <>
              {' → '}
              <code>{row.original.expected}</code>
            </>
          )}
        </span>
      ),
    },
    { id: 'type', header: 'Finding', cell: ({ row }) => TYPE_LABELS[row.original.type] ?? row.original.type },
    { id: 'services', header: 'Services', cell: ({ row }) => row.original.services },
    {
      id: 'libraries',
      header: 'Libraries',
      cell: ({ row }) => (row.original.libraries.length > 0 ? row.original.libraries.join(', ') : '—'),
    },
  ];
  return (
    <Stack direction="column" gap={1} data-testid={testIds.overview.violations}>
      <InteractiveTable
        columns={columns}
        data={groups.slice(0, MAX_ROWS)}
        getRowId={(group) => group.key}
        renderExpandedRow={(group) => <AffectedServices group={group} range={range} />}
      />
      {groups.length > MAX_ROWS && (
        <Text color="secondary" variant="bodySmall">
          Showing the top {MAX_ROWS} of {groups.length} violations. Open a service below to see all of its findings.
        </Text>
      )}
    </Stack>
  );
}

function AffectedServices({ group, range }: { group: ViolationGroup; range: { from: string; to: string } }) {
  return (
    <Stack direction="column" gap={0.5} alignItems="flex-start">
      <Text color="secondary" variant="bodySmall">
        Open a service to see the evidence and fix options for this violation.
      </Text>
      <Stack gap={1} wrap="wrap">
        {group.owners.map((owner) => (
          <LinkButton
            key={ownerName(owner)}
            href={serviceLink(owner, range, group.signal)}
            fill="outline"
            variant="secondary"
            size="sm"
          >
            {ownerName(owner)}
          </LinkButton>
        ))}
      </Stack>
    </Stack>
  );
}
