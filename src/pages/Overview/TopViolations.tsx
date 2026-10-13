import React from 'react';
import { Column, InteractiveTable, Text } from '@grafana/ui';
import { ViolationGroup } from '../../assessment/overview';
import { testIds } from '../../components/testIds';

const TYPE_LABELS: Record<string, string> = {
  deprecated: 'Deprecated',
  unit_mismatch: 'Unit mismatch',
  required_attribute_not_present: 'Required missing',
  not_in_registry: 'Not in registry',
  sdk_default_service_name: 'SDK default service name',
  missing_service_name: 'No service name',
};

export function TopViolations({ groups }: { groups: ViolationGroup[] }) {
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
    <div data-testid={testIds.overview.violations}>
      <InteractiveTable columns={columns} data={groups.slice(0, 25)} getRowId={(group) => group.key} />
    </div>
  );
}
