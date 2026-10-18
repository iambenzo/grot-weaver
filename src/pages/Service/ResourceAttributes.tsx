import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Badge, BadgeColor, Column, InteractiveTable, Stack, Text, TextLink, useStyles2 } from '@grafana/ui';
import { Owner, PresenceState, ResourceAttributeCheck, Signal } from '../../api/types';
import { sameOwner } from '../../assessment/traceAssessment';
import { testIds } from '../../components/testIds';
import { SectionHeading } from '../../components/SectionHeading/SectionHeading';
import { RESOURCE_ATTRIBUTES_HELP } from '../../components/SectionHeading/guides';

const SIGNAL_LABELS: Record<Signal, string> = { metrics: 'Metrics', traces: 'Traces', logs: 'Logs' };
const SDK_ENVIRONMENT_URL = 'https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/';
const COLLECTOR_COMPONENTS_URL = 'https://opentelemetry.io/docs/platforms/kubernetes/collector/components/';
const TARGET_INFO_URL = 'https://grafana.com/docs/grafana-cloud/send-data/otlp/otlp-format-considerations/';

const STATES: Record<PresenceState, { label: string; color: BadgeColor }> = {
  present: { label: 'Present', color: 'green' },
  missing: { label: 'Missing', color: 'red' },
  unknown: { label: 'Not checkable', color: 'darkgrey' },
};

interface ResourceAttributesProps {
  checks: ResourceAttributeCheck[];
  owners: Owner[];
  signals: Signal[];
}

export function ownerResourceChecks(checks: ResourceAttributeCheck[], owners: Owner[]): ResourceAttributeCheck[] {
  return checks.filter((check) => owners.some((owner) => sameOwner(owner, check.owner)));
}

export function bestCheck(
  checks: ResourceAttributeCheck[],
  attribute: string,
  signal: Signal
): ResourceAttributeCheck | undefined {
  const rank: Record<PresenceState, number> = { present: 0, missing: 1, unknown: 2 };
  return checks
    .filter((check) => check.attribute === attribute && check.signal === signal)
    .sort((a, b) => rank[a.state] - rank[b.state])[0];
}

export function ResourceAttributes({ checks, owners, signals }: ResourceAttributesProps) {
  const linkStyles = useStyles2(getLinkStyles);
  const owned = ownerResourceChecks(checks, owners);
  const attributes = [...new Set(owned.map((check) => check.attribute))];
  if (attributes.length === 0) {
    return null;
  }
  const anyMissing = owned.some((check) => check.state === 'missing');
  const rows = attributes.map((attribute) => ({ attribute }));
  const columns: Array<Column<{ attribute: string }>> = [
    { id: 'attribute', header: 'Attribute', cell: ({ row }) => <code>{row.original.attribute}</code> },
    ...signals.map((signal): Column<{ attribute: string }> => ({
      id: signal,
      header: SIGNAL_LABELS[signal],
      cell: ({ row }) => <CheckCell check={bestCheck(owned, row.original.attribute, signal)} />,
    })),
  ];

  return (
    <Stack direction="column" gap={1} data-testid={testIds.service.resourceAttributes}>
      <SectionHeading title="Required resource attributes" help={RESOURCE_ATTRIBUTES_HELP} variant="h4" />
      <InteractiveTable columns={columns} data={rows} getRowId={(row) => row.attribute} />
      {anyMissing && (
        <Text color="secondary">
          To add a missing attribute, set it in the SDK with <code>OTEL_RESOURCE_ATTRIBUTES</code> (for example{' '}
          <code>service.namespace=shop,deployment.environment.name=production</code>) or add it in the Collector or
          Alloy with the resource or Kubernetes attributes processor. On metrics, attributes promoted to labels appear
          on every series and the rest are only on <code>target_info</code>. Grafana Cloud promotes
          deployment.environment.name and the service attributes by default.
          <span className={linkStyles.links}>
            <TextLink href={SDK_ENVIRONMENT_URL} external>
              SDK environment variables
            </TextLink>
            <TextLink href={COLLECTOR_COMPONENTS_URL} external>
              Collector processors
            </TextLink>
            <TextLink href={TARGET_INFO_URL} external>
              target_info in Grafana Cloud
            </TextLink>
          </span>
        </Text>
      )}
    </Stack>
  );
}

function CheckCell({ check }: { check?: ResourceAttributeCheck }) {
  if (!check) {
    return <Text color="secondary">N/A</Text>;
  }
  return (
    <Stack direction="column" gap={0.5} alignItems="flex-start">
      <Badge text={STATES[check.state].label} color={STATES[check.state].color} />
      <Text color="secondary" variant="bodySmall">
        {check.evidence}
      </Text>
    </Stack>
  );
}

const getLinkStyles = (theme: GrafanaTheme2) => ({
  links: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    marginTop: theme.spacing(0.5),
  }),
});
