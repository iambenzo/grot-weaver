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
import { Alert, CollapsableSection, Combobox, ComboboxOption, Field, LoadingPlaceholder, Stack, Text, useStyles2 } from '@grafana/ui';
import { discoverDatasources, proxyGet } from '../../datasources/proxy';
import { createLimiter } from '../../datasources/limiter';
import { scoreInventory } from '../../api/score';
import { Attribution, Finding, Owner } from '../../api/types';
import { TraceAssessment, assessTraces, lookupFindingLibraries, sameOwner } from '../../assessment/traceAssessment';
import { LibraryEvidence } from '../../inventory/traceLibraries';
import { PluginSettings, concurrencyFrom, datasourceTypesFor } from '../../settings/settings';
import { QueryWindow, toQueryWindow } from '../../window/window';
import { WidenWindowPrompt } from '../../window/WidenWindowPrompt';
import { testIds } from '../../components/testIds';
import { FindingsTable } from './FindingsTable';

interface ServiceFindingsState extends SceneObjectState {
  service?: string;
  namespace?: string;
  settings: PluginSettings;
}

export class ServiceFindings extends SceneObjectBase<ServiceFindingsState> {
  static Component = ServiceFindingsRenderer;

  protected _urlSync = new SceneObjectUrlSyncConfig(this, { keys: ['service', 'namespace'] });

  getUrlState() {
    return { service: this.state.service, namespace: this.state.namespace };
  }

  updateFromUrl(values: SceneObjectUrlValues) {
    const service = typeof values.service === 'string' ? values.service : undefined;
    const namespace = typeof values.namespace === 'string' ? values.namespace : undefined;
    if (service !== this.state.service || namespace !== this.state.namespace) {
      this.setState({ service, namespace });
    }
  }

  selectService(owner: Owner | undefined) {
    this.setState({ service: owner?.name, namespace: owner?.namespace || undefined });
  }
}

type Load = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; assessment: TraceAssessment; window: QueryWindow };

function ServiceFindingsRenderer({ model }: SceneComponentProps<ServiceFindings>) {
  const styles = useStyles2(getStyles);
  const { service, namespace, settings } = model.useState();
  const timeRangeObject = sceneGraph.getTimeRange(model) as SceneTimeRange;
  const { value: timeRange } = timeRangeObject.useState();
  const window = useMemo(() => toQueryWindow(timeRange), [timeRange]);
  const load = useTraceAssessment(settings, window);

  if (load.status === 'loading') {
    return <LoadingPlaceholder text="Collecting trace attributes and scoring them…" />;
  }
  if (load.status === 'failed') {
    return (
      <Alert severity="error" title="Could not score traces">
        {load.message}
      </Alert>
    );
  }

  const { assessment } = load;
  const services = uniqueOwners(assessment.result.attributions);
  const selected = services.find((owner) => owner.name === service && (owner.namespace ?? '') === (namespace ?? ''));

  return (
    <Stack direction="column" gap={2}>
      <CollectionWarnings assessment={assessment} />
      <WidenWindowPrompt window={load.window} observedItems={assessment.result.findings.length} timeRange={timeRangeObject} />
      <Field label="Service" description={`${services.length} services seen in this window`} className={styles.picker}>
        <Combobox
          options={services.map(toOption)}
          value={selected ? ownerValue(selected) : null}
          onChange={(option: ComboboxOption | null) => model.selectService(services.find((owner) => ownerValue(owner) === option?.value))}
          placeholder="Choose a service"
          isClearable
          data-testid={testIds.service.picker}
        />
      </Field>
      {selected ? (
        <SelectedService owner={selected} assessment={assessment} window={load.window} settings={settings} />
      ) : (
        <Text color="secondary">Choose a service to see its findings.</Text>
      )}
    </Stack>
  );
}

function SelectedService({ owner, assessment, window, settings }: { owner: Owner; assessment: TraceAssessment; window: QueryWindow; settings: PluginSettings }) {
  const { conformant, actionable } = useMemo(() => {
    const owned = assessment.result.findings.filter((finding) => sameOwner(finding.owner, owner));
    return {
      conformant: owned.filter((finding) => finding.type === 'conformant'),
      actionable: owned.filter((finding) => finding.type !== 'conformant'),
    };
  }, [assessment, owner]);
  const evidence = useLibraryEvidence(actionable, assessment, window, settings);
  const [conformantOpen, setConformantOpen] = useState(false);

  return (
    <Stack direction="column" gap={2}>
      {actionable.length === 0 ? (
        <Alert severity="success" title="No naming findings for this service in this window" />
      ) : (
        <FindingsTable findings={actionable} evidence={evidence} />
      )}
      <CollapsableSection label={`Conformant names (${conformant.length})`} isOpen={conformantOpen} onToggle={setConformantOpen}>
        <Stack direction="column" gap={0}>
          {conformant.map((finding) => (
            <code key={`${finding.scope}-${finding.observed}`}>{finding.observed}</code>
          ))}
        </Stack>
      </CollapsableSection>
    </Stack>
  );
}

function CollectionWarnings({ assessment }: { assessment: TraceAssessment }) {
  if (assessment.datasources.length === 0) {
    return (
      <Alert severity="info" title="No trace datasources found">
        Add a Tempo datasource, or add its type in the app settings.
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

type Outcome = Exclude<Load, { status: 'loading' }>;

function useTraceAssessment(settings: PluginSettings, window: QueryWindow): Load {
  const [loaded, setLoaded] = useState<Keyed<QueryWindow, Outcome>>();
  useEffect(() => {
    let cancelled = false;
    const datasources = discoverDatasources(datasourceTypesFor(settings, 'traces'));
    const settle = (value: Outcome) => !cancelled && setLoaded({ key: window, value });
    assessTraces(datasources, window, { get: proxyGet, limit: createLimiter(concurrencyFrom(settings)), score: scoreInventory })
      .then((assessment) => settle({ status: 'ready', assessment, window }))
      .catch((error: unknown) => settle({ status: 'failed', message: messageOf(error) }));
    return () => {
      cancelled = true;
    };
  }, [settings, window]);
  return loaded && loaded.key === window ? loaded.value : { status: 'loading' };
}

const NO_EVIDENCE = new Map<string, LibraryEvidence>();

function useLibraryEvidence(findings: Finding[], assessment: TraceAssessment, window: QueryWindow, settings: PluginSettings) {
  const [loaded, setLoaded] = useState<Keyed<Finding[], Map<string, LibraryEvidence>>>();
  useEffect(() => {
    let cancelled = false;
    const datasourceFor = (finding: Finding) =>
      assessment.result.attributions.find((attribution) => sameOwner(attribution.owner, finding.owner))?.datasource;
    lookupFindingLibraries(findings, datasourceFor, window, { get: proxyGet, limit: createLimiter(concurrencyFrom(settings)) }).then(
      (found) => !cancelled && setLoaded({ key: findings, value: found })
    );
    return () => {
      cancelled = true;
    };
  }, [findings, assessment, window, settings]);
  return loaded && loaded.key === findings ? loaded.value : NO_EVIDENCE;
}

function uniqueOwners(attributions: Attribution[]): Owner[] {
  const owners: Owner[] = [];
  for (const attribution of attributions) {
    if (!owners.some((owner) => sameOwner(owner, attribution.owner))) {
      owners.push(attribution.owner);
    }
  }
  return owners.sort((a, b) => ownerLabel(a).localeCompare(ownerLabel(b)));
}

function ownerValue(owner: Owner): string {
  return `${owner.kind}|${owner.namespace ?? ''}|${owner.name}`;
}

function ownerLabel(owner: Owner): string {
  if (owner.kind === 'unattributed') {
    return 'Unattributed (no service.name)';
  }
  return owner.namespace ? `${owner.namespace}/${owner.name}` : owner.name;
}

function toOption(owner: Owner): ComboboxOption {
  return { value: ownerValue(owner), label: ownerLabel(owner) };
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
