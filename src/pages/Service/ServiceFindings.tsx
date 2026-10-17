import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import {
  SceneComponentProps,
  SceneObjectBase,
  SceneObjectState,
  SceneObjectUrlSyncConfig,
  SceneObjectUrlValues,
  SceneTimeRange,
  sceneGraph,
} from '@grafana/scenes';
import {
  Alert,
  CollapsableSection,
  Combobox,
  ComboboxOption,
  Field,
  Stack,
  Tab,
  TabsBar,
  Text,
  useStyles2,
  ClipboardButton,
} from '@grafana/ui';
import { proxyGet } from '../../datasources/proxy';
import { createLimiter } from '../../datasources/limiter';
import { Finding, Owner, Signal } from '../../api/types';
import { lookupFindingLibraries, sameOwner } from '../../assessment/traceAssessment';
import { ServiceIdentity, StackAssessment, mergeOwners, ownerKey } from '../../assessment/stackAssessment';
import { evidenceTarget, exploreUrl, ownersIn } from '../../assessment/explore';
import { libraryInfo } from '../../assessment/libraries';
import { LibraryEvidence } from '../../inventory/traceLibraries';
import { PluginSettings, concurrencyFrom } from '../../settings/settings';
import { QueryWindow } from '../../window/window';
import { WidenWindowPrompt } from '../../window/WidenWindowPrompt';
import { testIds } from '../../components/testIds';
import { FindingsTable } from './FindingsTable';
import { Keyed, useServiceAssessment } from '../../assessment/useStackAssessment';
import { ownerSummary } from '../../fix/summary';
import { identifiedLibrary } from '../../fix/fixOptions';
import {
  EmptyTelemetry,
  FeatureLimits,
  LoadingProgress,
  StackStatus,
  hasOTelServices,
} from '../../components/StackStatus/StackStatus';
import { HopCandidates } from './HopCandidates';
import { ResourceAttributes } from './ResourceAttributes';
import { ProductReadiness } from './ProductReadiness';
import { SectionHeading } from '../../components/SectionHeading/SectionHeading';
import { FINDINGS_HELP } from '../../components/SectionHeading/guides';

const SIGNALS: Signal[] = ['metrics', 'traces', 'logs'];
const SIGNAL_LABELS: Record<Signal, string> = { metrics: 'Metrics', traces: 'Traces', logs: 'Logs' };

interface ServiceFindingsState extends SceneObjectState {
  service?: string;
  namespace?: string;
  signal?: string;
  settings: PluginSettings;
}

export class ServiceFindings extends SceneObjectBase<ServiceFindingsState> {
  static Component = ServiceFindingsRenderer;

  protected _urlSync = new SceneObjectUrlSyncConfig(this, { keys: ['service', 'namespace', 'signal'] });

  getUrlState() {
    return { service: this.state.service, namespace: this.state.namespace, signal: this.state.signal };
  }

  updateFromUrl(values: SceneObjectUrlValues) {
    const read = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : undefined);
    const next = { service: read('service'), namespace: read('namespace'), signal: read('signal') };
    if (
      next.service !== this.state.service ||
      next.namespace !== this.state.namespace ||
      next.signal !== this.state.signal
    ) {
      this.setState(next);
    }
  }

  selectService(owner: Owner | undefined) {
    this.setState({ service: owner?.name, namespace: owner?.namespace || undefined });
  }

  selectSignal(signal: Signal) {
    this.setState({ signal });
  }
}

function ServiceFindingsRenderer({ model }: SceneComponentProps<ServiceFindings>) {
  const styles = useStyles2(getStyles);
  const { service, namespace, signal, settings } = model.useState();
  const timeRangeObject = sceneGraph.getTimeRange(model) as SceneTimeRange;
  const { value: timeRange } = timeRangeObject.useState();
  const { load, quick } = useServiceAssessment(settings, timeRange, service);

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
  const identities = mergeOwners(assessment.result).filter(
    (identity) => identity.owner.kind === 'service' || identity.owner.kind === 'unattributed'
  );
  const selected = identities.find(
    (identity) => identity.owner.name === service && (identity.owner.namespace ?? '') === (namespace ?? '')
  );
  const activeSignal = SIGNALS.find((candidate) => candidate === signal) ?? selected?.signals[0] ?? 'metrics';

  return (
    <Stack direction="column" gap={2}>
      {quick && (
        <Alert severity="info" title={`Quick view of ${service}`} data-testid={testIds.service.quickView}>
          Only this service has been scanned so far. Labels that a pipeline adds to every service, and the impact
          ranking, can change when the full scan of the stack finishes, and this page then updates.
        </Alert>
      )}
      <StackStatus progress={load.progress} partial={assessment.partial} labels={load.labels} onRetry={load.retry} />
      <FeatureLimits progress={load.progress} result={assessment.result} />
      {!assessment.partial && !hasOTelServices(assessment.result) && <EmptyTelemetry result={assessment.result} />}
      <WidenWindowPrompt
        window={load.window}
        observedItems={assessment.result.findings.length}
        timeRange={timeRangeObject}
      />
      <Field
        label="Service"
        description={`${identities.length} services seen in this window`}
        className={styles.picker}
      >
        <Combobox
          options={identities.map(toOption)}
          value={selected ? ownerKey(selected.owner) : null}
          onChange={(option: ComboboxOption | null) =>
            model.selectService(identities.find((identity) => ownerKey(identity.owner) === option?.value)?.owner)
          }
          placeholder="Choose a service"
          isClearable
          data-testid={testIds.service.picker}
        />
      </Field>
      {selected ? (
        <SelectedService
          identity={selected}
          signal={activeSignal}
          onSignal={(next) => model.selectSignal(next)}
          assessment={assessment}
          window={load.window}
          settings={settings}
          range={{ from: String(timeRange.raw.from), to: String(timeRange.raw.to) }}
        />
      ) : (
        <Text color="secondary">Choose a service to see its findings.</Text>
      )}
    </Stack>
  );
}

interface SelectedServiceProps {
  identity: ServiceIdentity;
  signal: Signal;
  onSignal: (signal: Signal) => void;
  assessment: StackAssessment;
  window: QueryWindow;
  settings: PluginSettings;
  range: { from: string; to: string };
}

function SelectedService({ identity, signal, onSignal, assessment, window, settings, range }: SelectedServiceProps) {
  const owned = useMemo(
    () => assessment.result.findings.filter((finding) => sameOwner(finding.owner, identity.owner)),
    [assessment, identity]
  );
  const traceActionable = useMemo(
    () => owned.filter((finding) => finding.signal === 'traces' && finding.type !== 'conformant'),
    [owned]
  );
  const evidence = useLibraryEvidence(traceActionable, assessment, window, settings);
  const [conformantOpen, setConformantOpen] = useState(false);

  const forSignal = owned.filter((finding) => finding.signal === signal);
  const conformant = forSignal.filter((finding) => finding.type === 'conformant');
  const actionable = forSignal.filter((finding) => finding.type !== 'conformant');
  const typeOf = (uid: string) =>
    SIGNALS.flatMap((candidate) => assessment.datasources[candidate]).find((ds) => ds.uid === uid)?.type;
  const nameOf = (uid: string) =>
    SIGNALS.flatMap((candidate) => assessment.datasources[candidate]).find((ds) => ds.uid === uid)?.name ?? uid;
  const evidenceFor = (finding: Finding) => {
    const target = evidenceTarget(finding, assessment.result, typeOf);
    return target
      ? { url: exploreUrl(target, range.from, range.to), query: target.query, datasource: nameOf(target.uid) }
      : undefined;
  };
  const counts = (candidate: Signal) =>
    owned.filter((finding) => finding.signal === candidate && finding.type !== 'conformant').length;

  return (
    <Stack direction="column" gap={2}>
      {identity.aliases.length > 0 && (
        <Text color="secondary">Also seen as: {identity.aliases.map(ownerLabel).join(', ')}</Text>
      )}
      <ProductReadiness
        rows={assessment.result.service_readiness ?? []}
        owner={identity.owner}
        signals={SIGNALS.filter((candidate) => identity.signals.includes(candidate))}
      />
      <ResourceAttributes
        checks={assessment.result.resource_attributes ?? []}
        owners={[identity.owner, ...identity.aliases]}
        signals={SIGNALS.filter((candidate) => identity.signals.includes(candidate))}
      />
      <SectionHeading title="Findings" help={FINDINGS_HELP} variant="h4" />
      <TabsBar data-testid={testIds.service.tabs}>
        {SIGNALS.map((candidate) => (
          <Tab
            key={candidate}
            label={SIGNAL_LABELS[candidate]}
            counter={counts(candidate)}
            active={candidate === signal}
            onChangeTab={() => onSignal(candidate)}
          />
        ))}
      </TabsBar>
      {!identity.signals.includes(signal) ? (
        <Text color="secondary">No {SIGNAL_LABELS[signal].toLowerCase()} from this service in this window.</Text>
      ) : actionable.length === 0 ? (
        <Alert
          severity="success"
          title={`No ${SIGNAL_LABELS[signal].toLowerCase()} findings for this service in this window`}
        />
      ) : (
        <Stack direction="column" gap={1}>
          <div>
            <ClipboardButton
              size="sm"
              variant="secondary"
              icon="copy"
              getText={() =>
                ownerSummary(
                  identity.owner,
                  actionable
                    .filter((finding) => finding.level === 'violation')
                    .map((finding) => ({
                      finding,
                      library: identifiedLibrary(finding, libraryInfo(finding, evidence, owned)),
                      evidence: evidenceFor(finding),
                    })),
                  assessment.result.semconv_version
                )
              }
              data-testid={testIds.fix.ownerSummary}
            >
              Copy summary of violations for the owner
            </ClipboardButton>
          </div>
          <FindingsTable
            findings={actionable}
            libraryFor={(finding) => libraryInfo(finding, evidence, owned)}
            evidenceFor={evidenceFor}
            semconvVersion={assessment.result.semconv_version}
          />
        </Stack>
      )}
      <HopCandidates hops={(assessment.result.hops ?? []).find((hops) => sameOwner(hops.owner, identity.owner))} />
      <CollapsableSection
        label={`Conformant names (${conformant.length})`}
        isOpen={conformantOpen}
        onToggle={setConformantOpen}
      >
        <Stack direction="column" gap={0}>
          {conformant.map((finding) => (
            <code key={`${finding.scope}-${finding.observed}`}>{finding.observed}</code>
          ))}
        </Stack>
      </CollapsableSection>
    </Stack>
  );
}

const NO_EVIDENCE = new Map<string, LibraryEvidence>();

function useLibraryEvidence(
  findings: Finding[],
  assessment: StackAssessment,
  window: QueryWindow,
  settings: PluginSettings
) {
  const [loaded, setLoaded] = useState<Keyed<Finding[], Map<string, LibraryEvidence>>>();
  useEffect(() => {
    let cancelled = false;
    const datasourceFor = (finding: Finding) =>
      assessment.result.attributions.find((attribution) => sameOwner(attribution.owner, finding.owner))?.datasource;
    lookupFindingLibraries(
      findings,
      datasourceFor,
      window,
      { get: proxyGet, limit: createLimiter(concurrencyFrom(settings)) },
      (finding) => ownersIn(assessment.result.attributions, datasourceFor(finding))
    ).then((found) => !cancelled && setLoaded({ key: findings, value: found }));
    return () => {
      cancelled = true;
    };
  }, [findings, assessment, window, settings]);
  return loaded && loaded.key === findings ? loaded.value : NO_EVIDENCE;
}

function ownerLabel(owner: Owner): string {
  if (owner.kind === 'unattributed') {
    return 'Unattributed (no service.name)';
  }
  return owner.namespace ? `${owner.namespace}/${owner.name}` : owner.name;
}

function toOption(identity: ServiceIdentity): ComboboxOption {
  return {
    value: ownerKey(identity.owner),
    label: ownerLabel(identity.owner),
    description: identity.signals.join(', '),
  };
}

const getStyles = (theme: GrafanaTheme2) => ({
  picker: css({
    maxWidth: theme.spacing(60),
  }),
});
