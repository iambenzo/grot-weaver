import React, { useMemo, useState } from 'react';
import { rangeUtil } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState, SceneTimeRange, sceneGraph } from '@grafana/scenes';
import { Alert, Badge, Stack, Tab, TabsBar, Text } from '@grafana/ui';
import { Signal } from '../../api/types';
import {
  coverageFor,
  groupViolations,
  serviceRows,
  uncheckableResourceFor,
  unmeasuredFor,
} from '../../assessment/overview';
import { StackAssessment } from '../../assessment/stackAssessment';
import { useStackAssessment } from '../../assessment/useStackAssessment';
import {
  EmptyTelemetry,
  LoadingProgress,
  ScanStatus,
  ScanWarnings,
  IncompleteNote,
  emptyKind,
  incompleteReasons,
  scanLimits,
} from '../../components/StackStatus/StackStatus';
import { PluginSettings, isUpstreamCheckEnabled, isVolumeWeighted } from '../../settings/settings';
import { UpstreamBanner } from '../../upstream/UpstreamBanner';
import { strategyExample, strategyLabel } from '../../inventory/strategyLabels';
import { WidenWindowPrompt } from '../../window/WidenWindowPrompt';
import { SectionHeading } from '../../components/SectionHeading/SectionHeading';
import { SERVICES_HELP, TOP_VIOLATIONS_HELP } from '../../components/SectionHeading/guides';
import { testIds } from '../../components/testIds';
import { ScoreTiles } from './ScoreTiles';
import { TopViolations } from './TopViolations';
import { ServicesTable } from './ServicesTable';
import { OwnerSections } from './OwnerSections';
import { OverviewIntro } from './OverviewIntro';
import { overviewContextData } from '../../assistant/pageContext';
import { useAssistantPageContext, usePageScan } from '../../assistant/useAssistantPageContext';
import { ROUTES } from '../../constants';

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
  const windowLabel = rangeUtil.describeTimeRange(timeRange.raw, timeRangeObject.getTimeZone());
  const scan = usePageScan(load);
  const volumeWeighted = isVolumeWeighted(settings);
  const contextData = useMemo(
    () => scan && overviewContextData(scan, windowLabel, volumeWeighted),
    [scan, windowLabel, volumeWeighted]
  );
  useAssistantPageContext(ROUTES.Overview, 'OTel Semconv Compliance overview', contextData);

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
  const limits = scanLimits(assessment.progress, result);
  const incompleteFor = (candidate: Signal) => incompleteReasons(assessment.progress, limits, candidate);
  const limitedSignals = SIGNALS.filter((candidate) => incompleteFor(candidate).length > 0);
  const empty = emptyKind(assessment);
  const status = (observedItems: number) => (
    <>
      <ScanStatus
        progress={load.progress}
        partial={assessment.partial}
        limits={limits}
        labels={load.labels}
        savedAtMs={load.savedAtMs}
        scanning={load.scanning}
      >
        {empty !== 'unreadable' && (
          <WidenWindowPrompt window={load.window} observedItems={observedItems} timeRange={timeRangeObject} />
        )}
      </ScanStatus>
      <ScanWarnings
        progress={assessment.progress}
        onRetry={load.retry}
        savedAtMs={load.savedAtMs}
        scanError={load.scanError}
      />
    </>
  );

  if (empty) {
    return (
      <Stack direction="column" gap={3}>
        <OverviewHeader assessment={assessment} windowLabel={windowLabel} settings={settings} />
        {status(0)}
        <EmptyTelemetry kind={empty} result={result} />
        {empty === 'no-otel-services' && <OwnerSections result={result} />}
      </Stack>
    );
  }

  return (
    <Stack direction="column" gap={3}>
      <OverviewHeader assessment={assessment} windowLabel={windowLabel} settings={settings} />
      {status(result.findings.length)}
      <Stack direction="column" gap={2}>
        {SIGNALS.map((candidate) => (
          <ScoreTiles
            key={candidate}
            signal={candidate}
            row={result.signals.find((row) => row.signal === candidate)}
            coverage={coverageFor(result, candidate)}
            unmeasured={unmeasuredFor(result, candidate)}
            uncheckable={uncheckableResourceFor(result, candidate)}
            volumeWeighted={isVolumeWeighted(settings)}
            incomplete={incompleteFor(candidate)}
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
        <IncompleteNote reasons={incompleteFor(signal)} />
        <TopViolations
          groups={groups.filter((group) => group.signal === signal)}
          range={range}
          semconvVersion={result.semconv_version}
        />
      </Stack>
      <Stack direction="column" gap={1}>
        <SectionHeading title="Services, worst first" help={SERVICES_HELP} />
        <IncompleteNote
          lead="Some of these scores rest on limited data for"
          reasons={limitedSignals.map((candidate) => SIGNAL_LABELS[candidate].toLowerCase())}
        />
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
        Scored against semantic conventions <strong>{assessment.result.semconv_version}</strong>. Window: {windowLabel}.{' '}
        {weightingText(isVolumeWeighted(settings))}
      </Text>
      <Stack gap={1} wrap="wrap">
        {all.map((ds) => {
          const summary = summaries.find((candidate) => candidate.uid === ds.uid);
          const strategy = summary?.strategy
            ? `, ${strategyLabel(summary.strategy)}${summary.mixed ? ' (mixed)' : ''}${summary.unit_checkable ? '' : ', unit not checkable'}`
            : '';
          const example = summary?.strategy ? strategyExample(summary.strategy) : undefined;
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
              tooltip={
                example
                  ? `How this datasource stores OpenTelemetry metric names, by base name: ${example}.${summary?.mixed ? ' Some names use another form.' : ''}`
                  : undefined
              }
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
