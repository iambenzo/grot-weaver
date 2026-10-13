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
  LoadingPlaceholder,
  Stack,
  Tab,
  TabsBar,
  Text,
  useStyles2,
} from '@grafana/ui';
import { proxyGet } from '../../datasources/proxy';
import { createLimiter } from '../../datasources/limiter';
import { scoreInventory } from '../../api/score';
import { fetchMetricsNeedingLabels, fetchSpanGroupRules } from '../../api/catalogue';
import { Finding, Owner, Signal } from '../../api/types';
import { lookupFindingLibraries, sameOwner } from '../../assessment/traceAssessment';
import {
  discoverStack,
  ServiceIdentity,
  StackAssessment,
  assessStack,
  mergeOwners,
  ownerKey,
} from '../../assessment/stackAssessment';
import { evidenceTarget, exploreUrl } from '../../assessment/explore';
import { libraryInfo } from '../../assessment/libraries';
import { LabelProgress } from '../../inventory/prometheus';
import { LibraryEvidence } from '../../inventory/traceLibraries';
import { PluginSettings, concurrencyFrom } from '../../settings/settings';
import { QueryWindow, toQueryWindow } from '../../window/window';
import { WidenWindowPrompt } from '../../window/WidenWindowPrompt';
import { testIds } from '../../components/testIds';
import { FindingsTable } from './FindingsTable';

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

type Outcome =
  { status: 'failed'; message: string } | { status: 'ready'; assessment: StackAssessment; window: QueryWindow };
type Load = { status: 'loading'; labels?: LabelProgress } | Outcome;

function ServiceFindingsRenderer({ model }: SceneComponentProps<ServiceFindings>) {
  const styles = useStyles2(getStyles);
  const { service, namespace, signal, settings } = model.useState();
  const timeRangeObject = sceneGraph.getTimeRange(model) as SceneTimeRange;
  const { value: timeRange } = timeRangeObject.useState();
  const window = useMemo(() => toQueryWindow(timeRange), [timeRange]);
  const load = useStackAssessment(settings, window);

  if (load.status === 'loading') {
    const labels =
      load.labels && load.labels.total > 0 ? ` Checking metric labels ${load.labels.done}/${load.labels.total}.` : '';
    return <LoadingPlaceholder text={`Collecting telemetry names and scoring them…${labels}`} />;
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
      <CollectionWarnings assessment={assessment} />
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
  const exploreFor = (finding: Finding) => {
    const target = evidenceTarget(finding, assessment.result, typeOf);
    return target ? exploreUrl(target, range.from, range.to) : undefined;
  };
  const counts = (candidate: Signal) =>
    owned.filter((finding) => finding.signal === candidate && finding.type !== 'conformant').length;

  return (
    <Stack direction="column" gap={2}>
      {identity.aliases.length > 0 && (
        <Text color="secondary">Also seen as: {identity.aliases.map(ownerLabel).join(', ')}</Text>
      )}
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
        <FindingsTable
          findings={actionable}
          libraryFor={(finding) => libraryInfo(finding, evidence, owned)}
          exploreFor={exploreFor}
        />
      )}
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

function CollectionWarnings({ assessment }: { assessment: StackAssessment }) {
  const total = SIGNALS.reduce((sum, candidate) => sum + assessment.datasources[candidate].length, 0);
  if (total === 0) {
    return (
      <Alert severity="info" title="No metrics, trace or log datasources found">
        Add a Prometheus, Tempo or Loki datasource, or add its type in the app settings.
      </Alert>
    );
  }
  if (assessment.errors.length === 0) {
    return null;
  }
  return (
    <Alert severity="warning" title={`${assessment.errors.length} queries failed; results are partial`}>
      <ul>
        {assessment.errors.slice(0, 5).map((error, index) => (
          <li key={index}>
            {error.datasource}: {error.step} — {error.message}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

interface Keyed<K, V> {
  key: K;
  value: V;
}

function useStackAssessment(settings: PluginSettings, window: QueryWindow): Load {
  const [loaded, setLoaded] = useState<Keyed<QueryWindow, Outcome>>();
  const [progress, setProgress] = useState<Keyed<QueryWindow, LabelProgress>>();
  useEffect(() => {
    let cancelled = false;
    const settle = (value: Outcome) => !cancelled && setLoaded({ key: window, value });
    assessStack(discoverStack(settings), window, settings, {
      get: proxyGet,
      limit: createLimiter(concurrencyFrom(settings)),
      score: scoreInventory,
      spanGroupRules: fetchSpanGroupRules,
      namesNeedingLabels: fetchMetricsNeedingLabels,
      onLabelProgress: (value) => !cancelled && setProgress({ key: window, value }),
    })
      .then((assessment) => settle({ status: 'ready', assessment, window }))
      .catch((error: unknown) => settle({ status: 'failed', message: messageOf(error) }));
    return () => {
      cancelled = true;
    };
  }, [settings, window]);
  if (loaded && loaded.key === window) {
    return loaded.value;
  }
  return { status: 'loading', labels: progress?.key === window ? progress.value : undefined };
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
    lookupFindingLibraries(findings, datasourceFor, window, {
      get: proxyGet,
      limit: createLimiter(concurrencyFrom(settings)),
    }).then((found) => !cancelled && setLoaded({ key: findings, value: found }));
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

function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { data?: { error?: string; message?: string }; message?: string };
    return candidate.data?.error ?? candidate.data?.message ?? candidate.message ?? 'unknown error';
  }
  return String(error);
}

const getStyles = (theme: GrafanaTheme2) => ({
  picker: css({
    maxWidth: theme.spacing(60),
  }),
});
