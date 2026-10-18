import React from 'react';
import { css } from '@emotion/css';
import { Column, InteractiveTable, LinkButton, Text, useStyles2 } from '@grafana/ui';
import { Owner, Signal } from '../../api/types';
import { ServiceRow } from '../../assessment/overview';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import { testIds } from '../../components/testIds';
import { formatRatio } from './ScoreTiles';
import { formatShare } from '../../components/ShareStatus/shareStatus';

const SIGNALS: Signal[] = ['metrics', 'traces', 'logs'];

export function serviceLink(owner: Owner, range: { from: string; to: string }, signal?: Signal): string {
  const params = new URLSearchParams({ service: owner.name, from: range.from, to: range.to });
  if (owner.namespace) {
    params.set('namespace', owner.namespace);
  }
  if (signal) {
    params.set('signal', signal);
  }
  return `${prefixRoute(ROUTES.Service)}?${params.toString()}`;
}

export function ownerName(owner: Owner): string {
  return owner.namespace ? `${owner.namespace}/${owner.name}` : owner.name;
}

export function ServicesTable({ rows, range }: { rows: ServiceRow[]; range: { from: string; to: string } }) {
  const styles = useStyles2(getStyles);
  if (rows.length === 0) {
    return (
      <Text color="secondary" data-testid={testIds.overview.services}>
        No services scored yet.
      </Text>
    );
  }
  const columns: Array<Column<ServiceRow>> = [
    {
      id: 'service',
      header: 'Service',
      cell: ({ row }) => (
        <LinkButton href={serviceLink(row.original.owner, range)} fill="text" size="sm">
          {ownerName(row.original.owner)}
        </LinkButton>
      ),
    },
    {
      id: 'worst',
      header: 'Lowest naming score',
      cell: ({ row }) => (row.original.worst === null ? 'N/A' : formatShare(row.original.worst)),
    },
    { id: 'violations', header: 'Violations', cell: ({ row }) => row.original.violations },
    {
      id: 'requiredResource',
      header: 'Required resource attributes',
      cell: ({ row }) => formatRatio(row.original.requiredResource),
    },
    ...SIGNALS.map((signal): Column<ServiceRow> => ({
      id: signal,
      header: `${signal[0].toUpperCase()}${signal.slice(1)}: stable naming`,
      cell: ({ row }) => formatRatio(row.original.scores[signal]?.naming_stable),
    })),
  ];
  return (
    <div className={styles.scroll} data-testid={testIds.overview.services}>
      <InteractiveTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.owner.namespace ?? ''}/${row.owner.name}`}
        pageSize={25}
      />
    </div>
  );
}

const getStyles = () => ({
  scroll: css({
    overflowX: 'auto',
  }),
});
