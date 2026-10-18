import React, { useState } from 'react';
import { SceneComponentProps, SceneObjectBase, SceneObjectState, SceneTimeRange, sceneGraph } from '@grafana/scenes';
import { Alert, Badge, Stack, Tab, TabsBar, Text } from '@grafana/ui';
import { Signal } from '../../api/types';
import { coverageFor, groupViolations, serviceRows, unmeasuredFor } from '../../assessment/overview';
import { StackAssessment } from '../../assessment/stackAssessment';
import { useStackAssessment } from '../../assessment/useStackAssessment';
import {
  EmptyTelemetry,
  LoadingProgress,
  SavedScanNotice,
  StackStatus,
  hasOTelServices,
} from '../../components/StackStatus/StackStatus';
import { PluginSettings, isUpstreamCheckEnabled, isVolumeWeighted } from '../../settings/settings';
import { UpstreamBanner } from '../../upstream/UpstreamBanner';
import { WidenWindowPrompt } from '../../window/WidenWindowPrompt';
import { SectionHeading } from '../../components/SectionHeading/SectionHeading';
import { SERVICES_HELP, TOP_VIOLATIONS_HELP } from '../../components/SectionHeading/guides';
import { testIds } from '../../components/testIds';
import { ScoreTiles } from './ScoreTiles';
import { TopViolations } from './TopViolations';
import { ServicesTable } from './ServicesTable';
import { OwnerSections } from './OwnerSections';
import { OverviewIntro } from './OverviewIntro';

const SIGNALS: Signal[] = ['metrics', 'traces', 'logs'];
const SIGNAL_LABELS: Record<Signal, string> = { metrics: 'Metrics', traces: 'Traces', logs: 'Logs' };

interface PlatformOverviewState extends SceneObjectState {
  settings: PluginSettings;
}

export class PlatformOverview extends SceneObjectBase<PlatformOverviewState> {
  static Component = PlatformOverviewRenderer;
}

function PlatformOverviewRenderer({ model }: SceneComponentProps<PlatformOverview>) {
  const { settings } = model.useState();
  const timeRangeObject = sceneGraph.getTimeRange(model) as SceneTimeRange;
  const { value: timeRange } = timeRangeObject.useState();
  const load = useStackAssessment(settings, timeRange);
  const [signal, setSignal] = useState<Signal>('metrics');

  if (load.status === 'loading') {
    return <LoadingProgress progress={load.progress} labels={load.labels} />;
  }
  if (load.status === 'failed') {
    return (
      <Alert severity="error" title="Could not score telemetry">
        {load.message}
      </Alert>
    );
  }

  const { assessment } = load;
  const { result } = assessment;
  const range = { from: String(timeRange.raw.from), to: String(timeRange.raw.to) };
  const groups = groupViolations(result.findings);
  const status = (
    <>
      <SavedScanNotice savedAtMs={load.savedAtMs} refreshError={load.refreshError} />
      <StackStatus
        progress={load.progress}
        partial={assessment.partial}
        labels={load.labels}
        onRetry={load.retry}
        refreshing={load.savedAtMs !== undefined}
      />
    </>
  );

  if (!assessment.partial && !hasOTelServices(result)) {
    return (
      <Stack direction="column" gap={3}>
        <OverviewHeader assessment={assessment} windowLabel={`${range.from} to ${range.to}`} settings={settings} />
        {status}
        <EmptyTelemetry result={result} />
        <WidenWindowPrompt window={load.window} observedItems={0} timeRange={timeRangeObject} />
        <OwnerSections result={result} />
      </Stack>
    );
  }

  return (
    <Stack direction="column" gap={3}>
      <OverviewHeader assessment={assessment} windowLabel={`${range.from} to ${range.to}`} settings={settings} />
      {status}
      <WidenWindowPrompt window={load.window} observedItems={result.findings.length} timeRange={timeRangeObject} />
      <Stack direction="column" gap={2}>
        {SIGNALS.map((candidate) => (
          <ScoreTiles
            key={candidate}
            signal={candidate}
            row={result.signals.find((row) => row.signal === candidate)}
            coverage={coverageFor(result, candidate)}
            unmeasured={unmeasuredFor(result, candidate)}
            volumeWeighted={isVolumeWeighted(settings)}
          />
        ))}
      </Stack>
      <Stack direction="column" gap={1}>
        <SectionHeading title="Top violations" help={TOP_VIOLATIONS_HELP} />
        <TabsBar>
          {SIGNALS.map((candidate) => (
            <Tab
              key={candidate}
              label={SIGNAL_LABELS[candidate]}
              counter={groups.filter((group) => group.signal === candidate).length}
              active={candidate === signal}
              onChangeTab={() => setSignal(candidate)}
            />
          ))}
        </TabsBar>
        <TopViolations groups={groups.filter((group) => group.signal === signal)} range={range} />
      </Stack>
      <Stack direction="column" gap={1}>
        <SectionHeading title="Services, worst first" help={SERVICES_HELP} />
        <ServicesTable rows={serviceRows(result)} range={range} />
      </Stack>
      <OwnerSections result={result} />
    </Stack>
  );
}

function OverviewHeader({
  assessment,
  windowLabel,
  settings,
}: {
  assessment: StackAssessment;
  windowLabel: string;
  settings: PluginSettings;
}) {
  const summaries = assessment.result.datasources ?? [];
  const all = SIGNALS.flatMap((candidate) =>
    assessment.datasources[candidate].map((ds) => ({ ...ds, signal: candidate }))
  );
  return (
    <Stack direction="column" gap={1} data-testid={testIds.overview.header}>
      <OverviewIntro semconvVersion={assessment.result.semconv_version} />
      <Text>
        Scored against semantic conventions <strong>{assessment.result.semconv_version}</strong> for {windowLabel}.{' '}
        {weightingText(isVolumeWeighted(settings))}
      </Text>
      <Stack gap={1} wrap="wrap">
        {all.map((ds) => {
          const summary = summaries.find((candidate) => candidate.uid === ds.uid);
          const strategy = summary
            ? `, ${summary.strategy}${summary.mixed ? ' (mixed)' : ''}${summary.unit_checkable ? '' : ', unit not checkable'}`
            : '';
          const entry = assessment.progress.find((candidate) => candidate.ref.uid === ds.uid);
          const limits = [
            entry?.volumeMethod === 'sample' ? 'volume from sample' : '',
            entry?.volumeMethod === 'mixed' ? 'some volumes from sample' : '',
            entry?.keysMethod === 'sample' ? 'keys from sample' : '',
          ].filter(Boolean);
          return (
            <Badge
              key={ds.uid}
              color="darkgrey"
              text={`${ds.name} (${SIGNAL_LABELS[ds.signal].toLowerCase()}${strategy}${limits.map((limit) => `, ${limit}`).join('')})`}
            />
          );
        })}
      </Stack>
      <UpstreamBanner currentVersion={assessment.result.semconv_version} enabled={isUpstreamCheckEnabled(settings)} />
    </Stack>
  );
}

export function weightingText(volumeWeighted: boolean): string {
  return volumeWeighted
    ? 'Each name counts by its volume in each service: series, spans or log lines.'
    : 'Each name counts once per service, whatever its volume.';
}
