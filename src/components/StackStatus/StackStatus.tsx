import React from 'react';
import { dateTimeFormatTimeAgo } from '@grafana/data';
import { Alert, Badge, BadgeColor, Button, LinkButton, LoadingPlaceholder, Stack, Text } from '@grafana/ui';
import { AssessmentResult, Signal } from '../../api/types';
import { DatasourceProgress, DatasourceState, mergeOwners } from '../../assessment/stackAssessment';
import { LabelProgress } from '../../inventory/prometheus';
import { loadingText } from '../../assessment/useStackAssessment';
import { testIds } from '../testIds';

const OTEL_LANGUAGES_DOCS = 'https://opentelemetry.io/docs/languages/';
const GRAFANA_INSTRUMENT_DOCS = 'https://grafana.com/docs/opentelemetry/instrument/';
const MAX_ERRORS_SHOWN = 5;

const SIGNAL_NAMES: Record<Signal, string> = { metrics: 'metrics', traces: 'traces', logs: 'logs' };
const STATE_BADGES: Record<DatasourceState, { text: string; color: BadgeColor }> = {
  pending: { text: 'collecting', color: 'blue' },
  ok: { text: 'done', color: 'green' },
  errors: { text: 'failed queries', color: 'orange' },
  not_visible: { text: 'not visible to you', color: 'red' },
};

export function DatasourceProgressList({ progress }: { progress: DatasourceProgress[] }) {
  return (
    <Stack gap={1} wrap="wrap" data-testid={testIds.status.progress}>
      {progress.map((entry) => {
        const badge = STATE_BADGES[entry.state];
        return (
          <Badge
            key={`${entry.signal}|${entry.ref.uid}`}
            color={badge.color}
            text={`${entry.ref.name} (${SIGNAL_NAMES[entry.signal]}): ${badge.text}`}
          />
        );
      })}
    </Stack>
  );
}

export function LoadingProgress({ progress, labels }: { progress: DatasourceProgress[]; labels?: LabelProgress }) {
  return (
    <Stack direction="column" gap={1}>
      <LoadingPlaceholder text={loadingText({ labels })} />
      <DatasourceProgressList progress={progress} />
    </Stack>
  );
}

interface StackStatusProps {
  progress: DatasourceProgress[];
  partial: boolean;
  labels?: LabelProgress;
  onRetry: (uid: string) => void;
}

export function StackStatus({ progress, partial, labels, onRetry }: StackStatusProps) {
  if (progress.length === 0) {
    return (
      <Alert severity="info" title="No metrics, trace or log datasources found">
        Add a Prometheus, Tempo or Loki datasource, or add its type in the app settings.
      </Alert>
    );
  }
  const notVisible = progress.filter((entry) => entry.state === 'not_visible');
  const failed = progress.filter((entry) => entry.state === 'errors');
  const pending = progress.filter((entry) => entry.state === 'pending');
  return (
    <Stack direction="column" gap={1}>
      {(partial || pending.length > 0) && (
        <Alert severity="info" title="Partial results" data-testid={testIds.status.partial}>
          <Stack direction="column" gap={1}>
            <div aria-live="polite">
              <Text>
                Scores cover {progress.length - pending.length} of {progress.length} datasources so far and update as
                the rest arrive. {loadingText({ labels })}
              </Text>
            </div>
            <DatasourceProgressList progress={progress} />
          </Stack>
        </Alert>
      )}
      {notVisible.length > 0 && (
        <Alert
          severity="warning"
          title="Some datasources are not visible to you"
          data-testid={testIds.status.notVisible}
        >
          Scores cover only the datasources you can query. Not visible to you:{' '}
          {notVisible.map((entry) => entry.ref.name).join(', ')}.
        </Alert>
      )}
      {failed.map((entry) => (
        <DatasourceErrors key={`${entry.signal}|${entry.ref.uid}`} entry={entry} onRetry={onRetry} />
      ))}
    </Stack>
  );
}

function DatasourceErrors({ entry, onRetry }: { entry: DatasourceProgress; onRetry: (uid: string) => void }) {
  const hidden = entry.errors.length - MAX_ERRORS_SHOWN;
  return (
    <Alert
      severity="warning"
      title={`${entry.ref.name}: ${entry.errors.length} queries failed, results for this datasource are partial`}
      data-testid={testIds.status.datasourceErrors}
    >
      <Stack direction="column" gap={1}>
        <ul>
          {entry.errors.slice(0, MAX_ERRORS_SHOWN).map((error, index) => (
            <li key={index}>
              {error.step}: {error.message}
            </li>
          ))}
          {hidden > 0 && <li>and {hidden} more</li>}
        </ul>
        <div>
          <Button size="sm" variant="secondary" icon="sync" onClick={() => onRetry(entry.ref.uid)}>
            Retry {entry.ref.name}
          </Button>
        </div>
      </Stack>
    </Alert>
  );
}

export function SavedScanNotice({ savedAtMs, refreshError }: { savedAtMs?: number; refreshError?: string }) {
  if (savedAtMs === undefined) {
    return null;
  }
  const age = dateTimeFormatTimeAgo(savedAtMs);
  if (refreshError) {
    return (
      <Alert severity="warning" title={`Showing your saved scan from ${age}`} data-testid={testIds.status.saved}>
        The fresh scan failed: {refreshError}
      </Alert>
    );
  }
  return (
    <Alert severity="info" title={`Showing your saved scan from ${age}`} data-testid={testIds.status.saved}>
      A fresh scan is running and will replace it when it finishes.
    </Alert>
  );
}

export function FeatureLimits({ progress, result }: { progress: DatasourceProgress[]; result: AssessmentResult }) {
  const limits = [
    ...progress
      .filter((entry) => entry.volumeMethod === 'sample')
      .map((entry) => `${entry.ref.name}: volume from sample, TraceQL metrics are unavailable`),
    ...progress
      .filter((entry) => entry.volumeMethod === 'mixed')
      .map(
        (entry) =>
          `${entry.ref.name}: volume from sample for services missing from TraceQL metrics, so they rank lower than measured services`
      ),
    ...progress.flatMap((entry) =>
      entry.unmeasuredVolumes
        ? [
            `${entry.ref.name}: volume not measured for ${entry.unmeasuredVolumes} ${entry.unmeasuredVolumes === 1 ? 'service' : 'services'} because the query failed, so their findings rank last`,
          ]
        : []
    ),
    ...progress.flatMap((entry) =>
      entry.labelChecks
        ? [
            `${entry.ref.name}: label keys checked for the ${entry.labelChecks.checked} busiest of ${entry.labelChecks.total} metric and owner pairs, the rest are not checked`,
          ]
        : []
    ),
    ...progress
      .filter((entry) => entry.keysMethod === 'sample')
      .map(
        (entry) =>
          `${entry.ref.name}: keys from sample, Tempo ignores the per-service tag filter so rare attributes can be missed`
      ),
    ...(result.datasources ?? [])
      .filter((summary) => !summary.unit_checkable)
      .map((summary) => `${nameOf(progress, summary.uid)}: unit not checkable, metric names carry no unit suffix`),
  ];
  if (limits.length === 0) {
    return null;
  }
  return (
    <Alert severity="info" title="Limited checks" data-testid={testIds.status.limits}>
      <ul>
        {limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </Alert>
  );
}

export function hasOTelServices(result: AssessmentResult): boolean {
  return mergeOwners(result).some((identity) => identity.owner.kind === 'service');
}

export function EmptyTelemetry({ result }: { result: AssessmentResult }) {
  const owners = mergeOwners(result);
  const count = (kind: 'source' | 'unattributed') => owners.filter((identity) => identity.owner.kind === kind).length;
  return (
    <Alert severity="info" title="No OpenTelemetry services found in this window" data-testid={testIds.status.empty}>
      <Stack direction="column" gap={1}>
        <Text>
          Telemetry exists but none of it carries an OpenTelemetry service identity: {count('source')} sources (non-OTel
          or collector-scraped) and {count('unattributed')} unattributed owners (no service.name).
        </Text>
        <Text>To score services, instrument them with an OpenTelemetry SDK.</Text>
        <Stack gap={1}>
          <LinkButton
            href={OTEL_LANGUAGES_DOCS}
            target="_blank"
            variant="secondary"
            fill="outline"
            icon="external-link-alt"
          >
            OpenTelemetry language guides
          </LinkButton>
          <LinkButton
            href={GRAFANA_INSTRUMENT_DOCS}
            target="_blank"
            variant="secondary"
            fill="outline"
            icon="external-link-alt"
          >
            Grafana OpenTelemetry instrumentation
          </LinkButton>
        </Stack>
      </Stack>
    </Alert>
  );
}

function nameOf(progress: DatasourceProgress[], uid: string): string {
  return progress.find((entry) => entry.ref.uid === uid)?.ref.name ?? uid;
}
