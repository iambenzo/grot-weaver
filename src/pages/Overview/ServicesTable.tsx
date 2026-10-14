import React from 'react';
import { Column, InteractiveTable, LinkButton } from '@grafana/ui';
import { Signal } from '../../api/types';
import { ServiceRow } from '../../assessment/overview';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import { testIds } from '../../components/testIds';
import { formatRatio } from './ScoreTiles';

const SIGNALS: Signal[] = ['metrics', 'traces', 'logs'];

export function serviceLink(row: ServiceRow, range: { from: string; to: string }): string {
  const params = new URLSearchParams({ service: row.owner.name, from: range.from, to: range.to });
  if (row.owner.namespace) {
    params.set('namespace', row.owner.namespace);
  }
  return `${prefixRoute(ROUTES.Service)}?${params.toString()}`;
}

export function ServicesTable({ rows, range }: { rows: ServiceRow[]; range: { from: string; to: string } }) {
  const columns: Array<Column<ServiceRow>> = [
    {
      id: 'service',
      header: 'Service',
      cell: ({ row }) => (
        <LinkButton href={serviceLink(row.original, range)} fill="text" size="sm">
          {row.original.owner.namespace
            ? `${row.original.owner.namespace}/${row.original.owner.name}`
            : row.original.owner.name}
        </LinkButton>
      ),
    },
    {
      id: 'worst',
      header: 'Lowest naming score',
      cell: ({ row }) => (row.original.worst === null ? 'N/A' : `${Math.round(row.original.worst * 100)}%`),
    },
    { id: 'violations', header: 'Violations', cell: ({ row }) => row.original.violations },
    {
      id: 'requiredResource',
      header: 'Required attributes',
      cell: ({ row }) => formatRatio(row.original.requiredResource),
    },
    ...SIGNALS.map((signal): Column<ServiceRow> => ({
      id: signal,
      header: `${signal[0].toUpperCase()}${signal.slice(1)} (stable naming)`,
      cell: ({ row }) => formatRatio(row.original.scores[signal]?.naming_stable),
    })),
  ];
  return (
    <div data-testid={testIds.overview.services}>
      <InteractiveTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.owner.namespace ?? ''}/${row.owner.name}`}
        pageSize={25}
      />
    </div>
  );
}
