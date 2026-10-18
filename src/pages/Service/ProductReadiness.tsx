import React from 'react';
import { Badge, BadgeColor, Column, InteractiveTable, Stack, Text } from '@grafana/ui';
import { ShareStatus, formatShare, shareStatus } from '../../components/ShareStatus/shareStatus';
import { Owner, ServiceReadinessRow, Signal } from '../../api/types';
import {
  ReadinessCounts,
  ServiceProductReadiness,
  SignalReadiness,
  countsOf,
  readinessBasis,
  serviceReadiness,
} from '../../assessment/readiness';
import { testIds } from '../../components/testIds';
import { SectionHeading } from '../../components/SectionHeading/SectionHeading';
import { PRODUCT_READINESS_HELP } from '../../components/SectionHeading/guides';

const SIGNAL_LABELS: Record<Signal, string> = { metrics: 'Metrics', traces: 'Traces', logs: 'Logs' };

interface ProductReadinessProps {
  rows: ServiceReadinessRow[];
  owner: Owner;
  signals: Signal[];
}

export function ProductReadiness({ rows, owner, signals }: ProductReadinessProps) {
  const products = serviceReadiness(rows, owner);
  if (products.length === 0) {
    return null;
  }

  const columns: Array<Column<ServiceProductReadiness>> = [
    { id: 'product', header: 'Product', cell: ({ row }) => <Text weight="medium">{row.original.name}</Text> },
    {
      id: 'overall',
      header: 'Overall',
      cell: ({ row }) => (
        <Stack direction="column" gap={0.5} alignItems="flex-start">
          <ShareBadge share={row.original.overall} />
          <Basis counts={row.original.overallCounts} />
        </Stack>
      ),
    },
    ...signals.map((signal): Column<ServiceProductReadiness> => ({
      id: signal,
      header: SIGNAL_LABELS[signal],
      cell: ({ row }) => <SignalCell readiness={row.original.signals[signal]} />,
    })),
  ];

  return (
    <Stack direction="column" gap={1} data-testid={testIds.service.productReadiness}>
      <SectionHeading title="Product readiness" help={PRODUCT_READINESS_HELP} variant="h4" />
      <InteractiveTable columns={columns} data={products} getRowId={(product) => product.product} />
    </Stack>
  );
}

function SignalCell({ readiness }: { readiness?: SignalReadiness }) {
  if (!readiness) {
    return <Text color="secondary">N/A</Text>;
  }
  return (
    <Stack direction="column" gap={0.5} alignItems="flex-start">
      <ShareBadge share={readiness.share} />
      <Basis counts={countsOf(readiness)} />
      {readiness.missing.length > 0 && <AttributeList label="Missing" attributes={readiness.missing} />}
      {readiness.unknown.length > 0 && <AttributeList label="Not checkable" attributes={readiness.unknown} />}
      {readiness.missingRecommended.length > 0 && (
        <AttributeList label="Also unlocks" attributes={readiness.missingRecommended} />
      )}
    </Stack>
  );
}

function ShareBadge({ share }: { share: number | null }) {
  if (share === null) {
    return <Badge text="Not checkable" color="darkgrey" />;
  }
  return <Badge text={formatShare(share)} color={shareColor(share)} />;
}

const STATUS_COLORS: Record<ShareStatus, BadgeColor> = { complete: 'green', partial: 'orange', none: 'red' };

function shareColor(share: number): BadgeColor {
  return STATUS_COLORS[shareStatus(share)];
}

function Basis({ counts }: { counts: ReadinessCounts }) {
  const basis = readinessBasis(counts);
  return basis ? (
    <Text color="secondary" variant="bodySmall">
      {basis}
    </Text>
  ) : null;
}

function AttributeList({ label, attributes }: { label: string; attributes: string[] }) {
  return (
    <Text color="secondary" variant="bodySmall">
      {label}: {attributes.join(', ')}
    </Text>
  );
}
