import React from 'react';
import { useStyles2, Badge, BadgeColor, Stack, Text } from '@grafana/ui';
import { ShareStatus, formatShare, shareStatus } from '../../components/ShareStatus/shareStatus';
import { Owner, ServiceReadinessRow, Signal } from '../../api/types';
import { SignalReadiness, serviceReadiness } from '../../assessment/readiness';
import { testIds } from '../../components/testIds';
import { SectionHeading } from '../../components/SectionHeading/SectionHeading';
import { PRODUCT_READINESS_HELP } from '../../components/SectionHeading/guides';
import { getTableStyles } from './tableStyles';

const SIGNAL_LABELS: Record<Signal, string> = { metrics: 'Metrics', traces: 'Traces', logs: 'Logs' };

interface ProductReadinessProps {
  rows: ServiceReadinessRow[];
  owner: Owner;
  signals: Signal[];
}

export function ProductReadiness({ rows, owner, signals }: ProductReadinessProps) {
  const styles = useStyles2(getTableStyles);
  const products = serviceReadiness(rows, owner);
  if (products.length === 0) {
    return null;
  }

  return (
    <Stack direction="column" gap={1} data-testid={testIds.service.productReadiness}>
      <SectionHeading title="Product readiness" help={PRODUCT_READINESS_HELP} variant="h4" />
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Overall</th>
              {signals.map((signal) => (
                <th key={signal} scope="col">
                  {SIGNAL_LABELS[signal]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.product}>
                <th scope="row">{product.name}</th>
                <td>
                  <ShareBadge share={product.overall} />
                </td>
                {signals.map((signal) => (
                  <td key={signal}>
                    <SignalCell readiness={product.signals[signal]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function AttributeList({ label, attributes }: { label: string; attributes: string[] }) {
  return (
    <Text color="secondary" variant="bodySmall">
      {label}: {attributes.join(', ')}
    </Text>
  );
}
