import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, dateTimeFormatTimeAgo } from '@grafana/data';
import {
  Alert,
  Badge,
  BadgeColor,
  Button,
  CollapsableSection,
  EmptyState,
  Icon,
  LinkButton,
  LoadingPlaceholder,
  Spinner,
  Stack,
  Text,
  useStyles2,
} from '@grafana/ui';
import pluginJson from '../../plugin.json';
import { AssessmentResult, Signal } from '../../api/types';
import { DatasourceProgress, DatasourceState, StackAssessment, mergeOwners } from '../../assessment/stackAssessment';
import { LabelProgress } from '../../inventory/prometheus';
import { loadingText } from '../../assessment/useStackAssessment';
import { testIds } from '../testIds';

const OTEL_LANGUAGES_DOCS = 'https://opentelemetry.io/docs/languages/';
const GRAFANA_INSTRUMENT_DOCS = 'https://grafana.com/docs/opentelemetry/instrument/';
const NEW_DATASOURCE_URL = '/connections/datasources/new';
const APP_SETTINGS_URL = `/plugins/${pluginJson.id}`;
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

interface ScanStatusProps {
  progress: DatasourceProgress[];
  partial: boolean;
  limits: ScanLimit[];
  labels?: LabelProgress;
  savedAtMs?: number;
  refreshError?: string;
  children?: React.ReactNode;
}

export function scanSummary({
  progress,
  partial,
  labels,
  savedAtMs,
  refreshError,
}: Pick<ScanStatusProps, 'progress' | 'partial' | 'labels' | 'savedAtMs' | 'refreshError'>): string {
  const pending = progress.filter((entry) => entry.state === 'pending').length;
  const done = progress.length - pending;
  const labelText = labels && labels.total > 0 ? ` Checking metric labels ${labels.done} of ${labels.total}.` : '';
  if (savedAtMs !== undefined) {
    const age = dateTimeFormatTimeAgo(savedAtMs);
    if (refreshError) {
      return `Showing your saved scan from ${age}.`;
    }
    return `Showing your saved scan from ${age}. A fresh scan is running, ${done} of ${progress.length} datasources so far, and replaces it when it finishes.${labelText}`;
  }
  if (partial || pending > 0) {
    return `Scores cover ${done} of ${progress.length} datasources so far and update as the rest arrive.${labelText}`;
  }
  return `Scan finished across ${progress.length} ${progress.length === 1 ? 'datasource' : 'datasources'}.`;
}

export function ScanStatus({ progress, partial, limits, labels, savedAtMs, refreshError, children }: ScanStatusProps) {
  const styles = useStyles2(getStyles);
  if (progress.length === 0) {
    return null;
  }
  const refreshing = savedAtMs !== undefined && !refreshError;
  const scanning = refreshing || partial || progress.some((entry) => entry.state === 'pending');
  return (
    <div className={styles.panel} data-testid={testIds.status.panel}>
      <Stack direction="column" gap={1}>
        <Stack gap={1} alignItems="center">
          {scanning ? <Spinner inline /> : <Icon name={savedAtMs === undefined ? 'check-circle' : 'history'} />}
          <div aria-live="polite" data-testid={savedAtMs === undefined ? testIds.status.partial : testIds.status.saved}>
            <Text>{scanSummary({ progress, partial, labels, savedAtMs, refreshError })}</Text>
          </div>
        </Stack>
        {scanning && <DatasourceProgressList progress={progress} />}
        {children}
        {limits.length > 0 && <LimitedChecks limits={limits} />}
      </Stack>
    </div>
  );
}

function LimitedChecks({ limits }: { limits: ScanLimit[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testIds.status.limits}>
      <CollapsableSection
        label={<Text weight="medium">{`Limited checks (${limits.length})`}</Text>}
        isOpen={open}
        onToggle={setOpen}
      >
        <ul>
          {limits.map((limit) => (
            <li key={limit.detail}>
              <Text variant="bodySmall">{limit.detail}</Text>
            </li>
          ))}
        </ul>
      </CollapsableSection>
    </div>
  );
}

interface ScanWarningsProps {
  progress: DatasourceProgress[];
  onRetry: (uid: string) => void;
  savedAtMs?: number;
  refreshError?: string;
}

export function ScanWarnings({ progress, onRetry, savedAtMs, refreshError }: ScanWarningsProps) {
  const notVisible = progress.filter((entry) => entry.state === 'not_visible');
  const failed = progress.filter((entry) => entry.state === 'errors');
  return (
    <>
      {savedAtMs !== undefined && refreshError && (
        <Alert severity="warning" title="The fresh scan failed" data-testid={testIds.status.refreshFailed}>
          The scores shown are from your saved scan from {dateTimeFormatTimeAgo(savedAtMs)}. {refreshError}
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
    </>
  );
}

function DatasourceErrors({ entry, onRetry }: { entry: DatasourceProgress; onRetry: (uid: string) => void }) {
  const hidden = entry.errors.length - MAX_ERRORS_SHOWN;
  return (
    <Alert
      severity="warning"
      title={`${entry.ref.name}: ${entry.errors.length} ${entry.errors.length === 1 ? 'query' : 'queries'} failed, results for this datasource are partial`}
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

export interface ScanLimit {
  signal: Signal;
  summary: string;
  detail: string;
}

export function scanLimits(progress: DatasourceProgress[], result: AssessmentResult): ScanLimit[] {
  const limit = (entry: { signal: Signal }, summary: string, detail: string): ScanLimit => ({
    signal: entry.signal,
    summary,
    detail,
  });
  return [
    ...progress
      .filter((entry) => entry.volumeMethod === 'sample')
      .map((entry) =>
        limit(entry, 'volume from a sample', `${entry.ref.name}: volume from sample, TraceQL metrics are unavailable`)
      ),
    ...progress
      .filter((entry) => entry.volumeMethod === 'mixed')
      .map((entry) =>
        limit(
          entry,
          'some volumes from a sample',
          `${entry.ref.name}: volume from sample for services missing from TraceQL metrics, so they rank lower than measured services`
        )
      ),
    ...progress.flatMap((entry) =>
      entry.unmeasuredVolumes
        ? [
            limit(
              entry,
              'some volumes not measured',
              `${entry.ref.name}: volume not measured for ${entry.unmeasuredVolumes} ${entry.unmeasuredVolumes === 1 ? 'service' : 'services'} because the query failed, so their findings rank last`
            ),
          ]
        : []
    ),
    ...progress.flatMap((entry) =>
      entry.labelChecks
        ? [
            limit(
              entry,
              'label keys checked for the busiest metrics only',
              `${entry.ref.name}: label keys checked for the ${entry.labelChecks.checked} busiest of ${entry.labelChecks.total} metric and owner pairs, the rest are not checked`
            ),
          ]
        : []
    ),
    ...progress
      .filter((entry) => entry.keysMethod === 'sample')
      .map((entry) =>
        limit(
          entry,
          'keys from a sample',
          `${entry.ref.name}: keys from sample, Tempo ignores the per-service tag filter so rare attributes can be missed`
        )
      ),
    ...(result.datasources ?? [])
      .filter((summary) => !summary.unit_checkable)
      .map((summary) =>
        limit(
          summary,
          'units not checkable',
          `${nameOf(progress, summary.uid)}: unit not checkable, metric names carry no unit suffix`
        )
      ),
  ];
}

export function incompleteReasons(progress: DatasourceProgress[], limits: ScanLimit[], signal: Signal): string[] {
  const reasons = [
    ...progress
      .filter((entry) => entry.signal === signal && entry.state === 'errors')
      .map((entry) => `failed queries on ${entry.ref.name}`),
    ...progress
      .filter((entry) => entry.signal === signal && entry.state === 'not_visible')
      .map((entry) => `${entry.ref.name} not visible to you`),
    ...limits.filter((entry) => entry.signal === signal).map((entry) => entry.summary),
  ];
  return [...new Set(reasons)];
}

export function IncompleteNote({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) {
    return null;
  }
  return (
    <Stack gap={0.5} alignItems="center" data-testid={testIds.status.incomplete}>
      <Icon name="exclamation-triangle" size="sm" aria-hidden />
      <Text color="secondary" variant="bodySmall">
        Based on limited data: {reasons.join(', ')}.
      </Text>
    </Stack>
  );
}

export function hasOTelServices(result: AssessmentResult): boolean {
  return mergeOwners(result).some((identity) => identity.owner.kind === 'service');
}

export type EmptyKind = 'no-datasources' | 'unreadable' | 'no-telemetry' | 'no-otel-services';

export function emptyKind({
  progress,
  result,
  partial,
}: Pick<StackAssessment, 'progress' | 'result' | 'partial'>): EmptyKind | undefined {
  if (progress.length === 0) {
    return 'no-datasources';
  }
  if (partial || hasOTelServices(result)) {
    return undefined;
  }
  if (mergeOwners(result).length > 0) {
    return 'no-otel-services';
  }
  return progress.some((entry) => entry.state === 'ok') ? 'no-telemetry' : 'unreadable';
}

export function EmptyTelemetry({ kind, result }: { kind: EmptyKind; result: AssessmentResult }) {
  return (
    <div data-testid={testIds.status.empty}>
      {kind === 'no-datasources' && <NoDatasources />}
      {kind === 'unreadable' && <Unreadable />}
      {kind === 'no-telemetry' && <NoTelemetry />}
      {kind === 'no-otel-services' && <NoOTelServices result={result} />}
    </div>
  );
}

function NoDatasources() {
  return (
    <EmptyState
      variant="call-to-action"
      message="No metrics, trace or log datasources found"
      button={
        <Stack gap={1} justifyContent="center" wrap="wrap">
          <LinkButton href={NEW_DATASOURCE_URL} icon="plus" size="lg">
            Add a datasource
          </LinkButton>
          <LinkButton href={APP_SETTINGS_URL} icon="cog" size="lg" variant="secondary">
            App settings
          </LinkButton>
        </Stack>
      }
    >
      This app scores the telemetry in your Prometheus, Tempo and Loki datasources. If yours use another plugin type,
      add that type in the app settings.
    </EmptyState>
  );
}

function Unreadable() {
  return (
    <EmptyState variant="not-found" message="Could not read your datasources">
      Every datasource failed or is not visible to you, so there is nothing to score. The warnings above say why: retry
      a datasource, or ask an admin for access.
    </EmptyState>
  );
}

function NoTelemetry() {
  return (
    <EmptyState variant="not-found" message="No telemetry found in this window">
      The datasources that answered returned no metrics, spans or logs for this time range. Widen the time range, or
      check that your services send telemetry to these datasources.
    </EmptyState>
  );
}

function NoOTelServices({ result }: { result: AssessmentResult }) {
  const owners = mergeOwners(result);
  const count = (kind: 'source' | 'unattributed') => owners.filter((identity) => identity.owner.kind === kind).length;
  return (
    <EmptyState
      variant="call-to-action"
      message="No OpenTelemetry services found in this window"
      button={
        <Stack gap={1} justifyContent="center" wrap="wrap">
          <LinkButton href={OTEL_LANGUAGES_DOCS} target="_blank" variant="secondary" icon="external-link-alt">
            OpenTelemetry language guides
          </LinkButton>
          <LinkButton href={GRAFANA_INSTRUMENT_DOCS} target="_blank" variant="secondary" icon="external-link-alt">
            Grafana OpenTelemetry instrumentation
          </LinkButton>
        </Stack>
      }
    >
      Telemetry exists but none of it carries an OpenTelemetry service identity: {count('source')} sources (non-OTel or
      collector-scraped) and {count('unattributed')} unattributed owners (no service.name). To score services,
      instrument them with an OpenTelemetry SDK.
    </EmptyState>
  );
}

function nameOf(progress: DatasourceProgress[], uid: string): string {
  return progress.find((entry) => entry.ref.uid === uid)?.ref.name ?? uid;
}

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
  }),
});
