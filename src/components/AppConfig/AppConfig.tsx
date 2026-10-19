import React, { useMemo, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv, getDataSourceSrv, locationService } from '@grafana/runtime';
import {
  Alert,
  Button,
  Combobox,
  ComboboxOption,
  Field,
  FieldSet,
  IconButton,
  Input,
  Label,
  MultiCombobox,
  Stack,
  Switch,
  TagsInput,
  Text,
  useStyles2,
} from '@grafana/ui';
import { testIds } from '../testIds';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_DATASOURCE_TYPES,
  DEFAULT_LOG_SAMPLE_LIMIT,
  DEFAULT_REQUIRED_RESOURCE_ATTRIBUTES,
  DEFAULT_TRACE_SAMPLE_LIMIT,
  DatasourceTypes,
  PipelineMapping,
  PluginSettings,
  readSettings,
  requiredResourceAttributes,
} from '../../settings/settings';
import { DEFAULT_WINDOW, WINDOW_PRESETS } from '../../window/presets';
import { ReclassificationRule, TRANSLATION_STRATEGIES, TranslationStrategy } from '../../inventory/types';
import { STRATEGY_LABELS } from '../../inventory/strategyLabels';
import { messageOf } from '../../api/errors';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<PluginSettings>> {}

const SIGNALS: Array<keyof DatasourceTypes> = ['metrics', 'traces', 'logs'];
const SIGNAL_LABELS: Record<keyof DatasourceTypes, string> = { metrics: 'Metrics', traces: 'Traces', logs: 'Logs' };
const DETECTED = 'detected';

const AppConfig = ({ plugin }: AppConfigProps) => {
  const styles = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;
  const [settings, setSettings] = useState<PluginSettings>(() => readSettings(jsonData));
  const [saving, setSaving] = useState(false);
  const datasources = useMemo(() => getDataSourceSrv().getList({}), []);
  const update = (patch: Partial<PluginSettings>) => setSettings((current) => ({ ...current, ...patch }));
  const typesFor = (signal: keyof DatasourceTypes) =>
    settings.datasourceTypes?.[signal] ?? DEFAULT_DATASOURCE_TYPES[signal];

  const [saveError, setSaveError] = useState<string>();

  const save = async () => {
    setSaving(true);
    setSaveError(undefined);
    try {
      await updatePlugin(plugin.meta.id, { enabled, pinned, jsonData: settings });
      locationService.reload();
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  const metricsDatasources = datasources.filter((ds) => typesFor('metrics').includes(ds.type));

  return (
    <div className={styles.page} data-testid={testIds.appConfig.container}>
      <FieldSet label="Datasources">
        {SIGNALS.map((signal) => (
          <Field
            key={signal}
            label={`${SIGNAL_LABELS[signal]} datasource types`}
            description="Plugin type ids that are discovered for this signal."
          >
            <TagsInput
              id={`ac-datasource-types-${signal}`}
              tags={typesFor(signal)}
              onChange={(tags) => update({ datasourceTypes: { ...settings.datasourceTypes, [signal]: tags } })}
            />
          </Field>
        ))}
        <Field label="Excluded datasources" description="Never queried, for example usage or ML datasources.">
          <MultiCombobox
            id="ac-excluded-datasources"
            options={datasources.map((ds) => ({ value: ds.uid, label: `${ds.name} (${ds.type})` }))}
            value={settings.excludedDatasources ?? []}
            onChange={(options) => update({ excludedDatasources: options.map((option) => String(option.value)) })}
            data-testid={testIds.appConfig.excluded}
          />
        </Field>
      </FieldSet>

      <FieldSet label="Metrics">
        {metricsDatasources.map((ds) => (
          <Field
            key={ds.uid}
            label={`Translation strategy for ${ds.name}`}
            description="How this datasource stores OpenTelemetry metric names. Leave on detected unless the detection is wrong."
          >
            <Combobox
              id={`ac-strategy-${ds.uid}`}
              width={50}
              options={[
                { value: DETECTED, label: 'Detected from metric names' },
                ...TRANSLATION_STRATEGIES.map((strategy) => ({
                  value: strategy,
                  label: `${STRATEGY_LABELS[strategy].label} (${strategy})`,
                  description: STRATEGY_LABELS[strategy].example,
                })),
              ]}
              value={settings.strategyOverrides?.[ds.uid] ?? DETECTED}
              onChange={(option: ComboboxOption | null) =>
                update({ strategyOverrides: withOverride(settings.strategyOverrides, ds.uid, option?.value) })
              }
            />
          </Field>
        ))}
        <FieldGroup
          id="ac-reclassification"
          label="Reclassification rules"
          description="Glob patterns for metric names that are excluded, or treated as pipeline telemetry. Leave empty to use the defaults."
        >
          <RuleEditor
            rules={settings.reclassification ?? []}
            onChange={(rules) => update({ reclassification: rules.length > 0 ? rules : undefined })}
          />
        </FieldGroup>
      </FieldSet>

      <FieldSet label="Window and limits">
        <Field label="Default window">
          <Combobox
            id="ac-default-window"
            width={30}
            options={WINDOW_PRESETS.map((preset) => ({ value: preset.from, label: preset.display }))}
            value={settings.defaultWindow ?? DEFAULT_WINDOW}
            onChange={(option: ComboboxOption | null) =>
              update({ defaultWindow: option?.value ? String(option.value) : undefined })
            }
            data-testid={testIds.appConfig.defaultWindow}
          />
        </Field>
        <Field label="Concurrent queries" description="Maximum datasource requests in flight at once (1 to 32).">
          <NumberInput
            id="ac-concurrency"
            value={settings.concurrency}
            placeholder={DEFAULT_CONCURRENCY}
            onChange={(concurrency) => update({ concurrency })}
          />
        </Field>
        <Field label="Trace sample size" description="Traces fetched per span-group check or library lookup.">
          <NumberInput
            id="ac-trace-sample-size"
            value={settings.traceSampleLimit}
            placeholder={DEFAULT_TRACE_SAMPLE_LIMIT}
            onChange={(traceSampleLimit) => update({ traceSampleLimit })}
          />
        </Field>
        <Field
          label="Log sample size"
          description="Log lines sampled per service when detected fields are unavailable."
        >
          <NumberInput
            id="ac-log-sample-size"
            value={settings.logSampleLimit}
            placeholder={DEFAULT_LOG_SAMPLE_LIMIT}
            onChange={(logSampleLimit) => update({ logSampleLimit })}
          />
        </Field>
      </FieldSet>

      <FieldSet label="Scoring">
        <Field
          label="Weight scores by volume"
          description="Off: every distinct name counts once. On: names count by series, span or log volume."
        >
          <Switch
            id="ac-volume-weighted"
            value={settings.volumeWeighted === true}
            onChange={(event) => update({ volumeWeighted: event.currentTarget.checked })}
          />
        </Field>
        <Field
          label="Custom namespaces"
          description="Attribute namespaces owned by your organisation. Names under them are custom, not semconv violations."
        >
          <TagsInput
            id="ac-custom-namespaces"
            tags={settings.customNamespaces ?? []}
            onChange={(customNamespaces) => update({ customNamespaces })}
          />
        </Field>
        <Field
          label="Required resource attributes"
          description="Checked on every service for each signal and scored separately from semconv conformance. Semconv itself only requires service.name."
          data-testid={testIds.appConfig.requiredAttributes}
          htmlFor="ac-required-attributes"
        >
          <Stack direction="column" gap={1} alignItems="flex-start">
            <TagsInput
              id="ac-required-attributes"
              tags={requiredResourceAttributes(settings)}
              onChange={(attributes) => update({ requiredResourceAttributes: attributes })}
            />
            <Button
              variant="secondary"
              size="sm"
              fill="text"
              onClick={() => update({ requiredResourceAttributes: undefined })}
              disabled={settings.requiredResourceAttributes === undefined}
            >
              Reset to {DEFAULT_REQUIRED_RESOURCE_ATTRIBUTES.length} defaults
            </Button>
          </Stack>
        </Field>
      </FieldSet>

      <FieldSet label="Pipelines">
        <FieldGroup
          id="ac-pipeline-mappings"
          label="Service to pipeline mappings"
          description="Glob on namespace/name, for example shop/*, mapped to the collector or Alloy pipeline that carries it."
        >
          <MappingEditor
            mappings={settings.pipelineMappings ?? []}
            onChange={(pipelineMappings) => update({ pipelineMappings })}
          />
        </FieldGroup>
      </FieldSet>

      <FieldSet label="Updates">
        <Field
          label="Check for newer semantic convention releases"
          description="Your browser asks GitHub once a day. The catalogue itself only changes with a plugin update."
        >
          <Switch
            id="ac-upstream-check"
            value={settings.upstreamCheck !== false}
            onChange={(event) => update({ upstreamCheck: event.currentTarget.checked })}
          />
        </Field>
      </FieldSet>

      <FieldSet label="Grafana Assistant">
        <Field
          label="Use Grafana Assistant"
          description="Applies when the Grafana Assistant app is installed; if it is not yet connected to Grafana Cloud, the Assistant offers to set it up instead. Ask Assistant buttons on findings open it with a prompt you can edit first. While you are on an overview or service page, a message you send to the Assistant also carries a summary of that page: the time range, scan status and limits, the scores, and up to 20 top violations or findings with their names, services and libraries. Nothing is sent until you send a message."
        >
          <Switch
            id="ac-assistant-buttons"
            value={settings.assistantButtons !== false}
            onChange={(event) => update({ assistantButtons: event.currentTarget.checked })}
          />
        </Field>
      </FieldSet>

      {saveError && (
        <Alert severity="error" title="Settings were not saved" data-testid={testIds.appConfig.saveError}>
          <Text element="p">{saveError}</Text>
          <Text element="p">Your changes are still in the form, so you can try again.</Text>
        </Alert>
      )}
      <Button onClick={save} disabled={saving} data-testid={testIds.appConfig.submit}>
        Save settings
      </Button>
    </div>
  );
};

function withOverride(overrides: Record<string, TranslationStrategy> | undefined, uid: string, value: unknown) {
  const next = { ...overrides };
  if (!value || value === DETECTED) {
    delete next[uid];
  } else {
    next[uid] = value as TranslationStrategy;
  }
  return next;
}

function NumberInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  value?: number;
  placeholder: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Input
      id={id}
      width={12}
      type="number"
      min={1}
      value={value ?? ''}
      placeholder={String(placeholder)}
      onChange={(event) => {
        const parsed = Number.parseInt(event.currentTarget.value, 10);
        onChange(Number.isNaN(parsed) ? undefined : parsed);
      }}
    />
  );
}

function FieldGroup({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  const styles = useStyles2(getStyles);
  return (
    <div role="group" aria-labelledby={`${id}-label`} className={styles.group}>
      <Label id={`${id}-label`} description={description}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function RuleEditor({
  rules,
  onChange,
}: {
  rules: ReclassificationRule[];
  onChange: (rules: ReclassificationRule[]) => void;
}) {
  const replace = (index: number, rule: ReclassificationRule) =>
    onChange(rules.map((existing, position) => (position === index ? rule : existing)));
  return (
    <Stack direction="column" gap={1}>
      {rules.map((rule, index) => (
        <Stack key={index} gap={1} alignItems="center">
          <Input
            id={`ac-rule-${index}-pattern`}
            aria-label={`Rule ${index + 1} metric name pattern`}
            width={40}
            value={rule.pattern}
            placeholder="traces_spanmetrics_*"
            onChange={(event) => replace(index, { ...rule, pattern: event.currentTarget.value })}
          />
          <Combobox
            id={`ac-rule-${index}-action`}
            aria-label={`Rule ${index + 1} action`}
            width={20}
            options={[
              { value: 'exclude', label: 'Exclude' },
              { value: 'pipeline', label: 'Pipeline telemetry' },
            ]}
            value={rule.action}
            onChange={(option: ComboboxOption | null) =>
              replace(index, { ...rule, action: option?.value === 'pipeline' ? 'pipeline' : 'exclude' })
            }
          />
          <IconButton
            name="trash-alt"
            tooltip={`Remove rule ${index + 1}`}
            onClick={() => onChange(rules.filter((_, position) => position !== index))}
          />
        </Stack>
      ))}
      <div>
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          onClick={() => onChange([...rules, { pattern: '', action: 'exclude' }])}
        >
          Add rule
        </Button>
      </div>
    </Stack>
  );
}

function MappingEditor({
  mappings,
  onChange,
}: {
  mappings: PipelineMapping[];
  onChange: (mappings: PipelineMapping[]) => void;
}) {
  const replace = (index: number, mapping: PipelineMapping) =>
    onChange(mappings.map((existing, position) => (position === index ? mapping : existing)));
  return (
    <Stack direction="column" gap={1}>
      {mappings.map((mapping, index) => (
        <Stack key={index} gap={1} alignItems="center">
          <Input
            id={`ac-mapping-${index}-match`}
            aria-label={`Mapping ${index + 1} service pattern`}
            width={30}
            value={mapping.match}
            placeholder="shop/*"
            onChange={(event) => replace(index, { ...mapping, match: event.currentTarget.value })}
          />
          <Input
            id={`ac-mapping-${index}-pipeline`}
            aria-label={`Mapping ${index + 1} pipeline`}
            width={30}
            value={mapping.pipeline}
            placeholder="alloy-receiver"
            onChange={(event) => replace(index, { ...mapping, pipeline: event.currentTarget.value })}
          />
          <IconButton
            name="trash-alt"
            tooltip={`Remove mapping ${index + 1}`}
            onClick={() => onChange(mappings.filter((_, position) => position !== index))}
          />
        </Stack>
      ))}
      <div>
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          onClick={() => onChange([...mappings, { match: '', pipeline: '' }])}
        >
          Add mapping
        </Button>
      </div>
    </Stack>
  );
}

export default AppConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    marginTop: theme.spacing(4),
    maxWidth: theme.spacing(120),
  }),
  group: css({
    marginBottom: theme.spacing(2),
  }),
});

const updatePlugin = async (pluginId: string, data: Partial<PluginMeta>) => {
  const response = getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
    showErrorAlert: false,
  });
  return lastValueFrom(response);
};
