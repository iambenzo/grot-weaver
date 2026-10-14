import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Badge, BadgeColor, Stack, Text, TextLink, useStyles2 } from '@grafana/ui';
import { Owner, PresenceState, ResourceAttributeCheck, Signal } from '../../api/types';
import { sameOwner } from '../../assessment/traceAssessment';
import { testIds } from '../../components/testIds';

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
  const styles = useStyles2(getStyles);
  const owned = ownerResourceChecks(checks, owners);
  const attributes = [...new Set(owned.map((check) => check.attribute))];
  if (attributes.length === 0) {
    return null;
  }
  const anyMissing = owned.some((check) => check.state === 'missing');

  return (
    <Stack direction="column" gap={1} data-testid={testIds.service.resourceAttributes}>
      <Text element="h2" variant="h4">
        Required resource attributes
      </Text>
      <Text color="secondary">
        Your required list, checked on every signal this service sends. This is separate from the semconv score.
      </Text>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              {signals.map((signal) => (
                <th key={signal} scope="col">
                  {SIGNAL_LABELS[signal]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {attributes.map((attribute) => (
              <tr key={attribute}>
                <th scope="row">
                  <code>{attribute}</code>
                </th>
                {signals.map((signal) => {
                  const check = bestCheck(owned, attribute, signal);
                  return (
                    <td key={signal}>
                      {check ? (
                        <Stack direction="column" gap={0.5} alignItems="flex-start">
                          <Badge text={STATES[check.state].label} color={STATES[check.state].color} />
                          <Text color="secondary" variant="bodySmall">
                            {check.evidence}
                          </Text>
                        </Stack>
                      ) : (
                        <Text color="secondary">N/A</Text>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyMissing && (
        <Text color="secondary">
          To add a missing attribute, set it in the SDK with <code>OTEL_RESOURCE_ATTRIBUTES</code> (for example{' '}
          <code>service.namespace=shop,deployment.environment.name=production</code>) or add it in the Collector or
          Alloy with the resource or Kubernetes attributes processor. On metrics, attributes other than service.name,
          service.namespace and service.instance.id live on <code>target_info</code>.
          <span className={styles.links}>
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

const getStyles = (theme: GrafanaTheme2) => ({
  scroll: css({
    overflowX: 'auto',
  }),
  table: css({
    borderCollapse: 'collapse',
    width: '100%',
    'th, td': {
      textAlign: 'left',
      verticalAlign: 'top',
      padding: theme.spacing(1),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    },
  }),
  links: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    marginTop: theme.spacing(0.5),
  }),
});
