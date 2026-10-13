import React, { useMemo, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv, getDataSourceSrv, locationService } from '@grafana/runtime';
import {
  Button,
  Combobox,
  ComboboxOption,
  Field,
  FieldSet,
  IconButton,
  Input,
  MultiCombobox,
  Stack,
  Switch,
  TagsInput,
  useStyles2,
} from '@grafana/ui';
import { testIds } from '../testIds';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_DATASOURCE_TYPES,
  DEFAULT_LOG_SAMPLE_LIMIT,
  DEFAULT_TRACE_SAMPLE_LIMIT,
  DatasourceTypes,
  PipelineMapping,
  PluginSettings,
  readSettings,
} from '../../settings/settings';
import { DEFAULT_WINDOW, WINDOW_PRESETS } from '../../window/presets';
import { ReclassificationRule, TRANSLATION_STRATEGIES, TranslationStrategy } from '../../inventory/types';

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

  const save = async () => {
    setSaving(true);
    await updatePluginAndReload(plugin.meta.id, { enabled, pinned, jsonData: settings });
    setSaving(false);
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
              tags={typesFor(signal)}
              onChange={(tags) => update({ datasourceTypes: { ...settings.datasourceTypes, [signal]: tags } })}
            />
          </Field>
        ))}
        <Field label="Excluded datasources" description="Never queried, for example usage or ML datasources.">
          <MultiCombobox
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
            description="Leave on detected unless the detection is wrong."
          >
            <Combobox
              width={50}
              options={[
                { value: DETECTED, label: 'Detected from metric names' },
                ...TRANSLATION_STRATEGIES.map((strategy) => ({ value: strategy, label: strategy })),
              ]}
              value={settings.strategyOverrides?.[ds.uid] ?? DETECTED}
              onChange={(option: ComboboxOption | null) =>
                update({ strategyOverrides: withOverride(settings.strategyOverrides, ds.uid, option?.value) })
              }
            />
          </Field>
        ))}
        <Field
          label="Reclassification rules"
          description="Glob patterns for metric names that are excluded, or treated as pipeline telemetry. Leave empty to use the defaults."
        >
          <RuleEditor
            rules={settings.reclassification ?? []}
            onChange={(rules) => update({ reclassification: rules.length > 0 ? rules : undefined })}
          />
        </Field>
      </FieldSet>

      <FieldSet label="Window and limits">
        <Field label="Default window">
          <Combobox
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
            value={settings.concurrency}
            placeholder={DEFAULT_CONCURRENCY}
            onChange={(concurrency) => update({ concurrency })}
          />
        </Field>
        <Field label="Trace sample size" description="Traces fetched per span-group check or library lookup.">
          <NumberInput
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
            value={settings.volumeWeighted === true}
            onChange={(event) => update({ volumeWeighted: event.currentTarget.checked })}
          />
        </Field>
        <Field
          label="Custom namespaces"
          description="Attribute namespaces owned by your organisation. Names under them are custom, not semconv violations."
        >
          <TagsInput
            tags={settings.customNamespaces ?? []}
            onChange={(customNamespaces) => update({ customNamespaces })}
          />
        </Field>
      </FieldSet>

      <FieldSet label="Pipelines">
        <Field
          label="Service to pipeline mappings"
          description="Glob on namespace/name, for example shop/*, mapped to the collector or Alloy pipeline that carries it."
        >
          <MappingEditor
            mappings={settings.pipelineMappings ?? []}
            onChange={(pipelineMappings) => update({ pipelineMappings })}
          />
        </Field>
      </FieldSet>

      <FieldSet label="Updates">
        <Field
          label="Check for newer semantic convention releases"
          description="Your browser asks GitHub once a day. The catalogue itself only changes with a plugin update."
        >
          <Switch
            value={settings.upstreamCheck !== false}
            onChange={(event) => update({ upstreamCheck: event.currentTarget.checked })}
          />
        </Field>
      </FieldSet>

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
  value,
  placeholder,
  onChange,
}: {
  value?: number;
  placeholder: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Input
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
            width={40}
            value={rule.pattern}
            placeholder="traces_spanmetrics_*"
            onChange={(event) => replace(index, { ...rule, pattern: event.currentTarget.value })}
          />
          <Combobox
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
            tooltip="Remove rule"
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
            width={30}
            value={mapping.match}
            placeholder="shop/*"
            onChange={(event) => replace(index, { ...mapping, match: event.currentTarget.value })}
          />
          <Input
            width={30}
            value={mapping.pipeline}
            placeholder="alloy-receiver"
            onChange={(event) => replace(index, { ...mapping, pipeline: event.currentTarget.value })}
          />
          <IconButton
            name="trash-alt"
            tooltip="Remove mapping"
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
});

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<PluginSettings>>) => {
  try {
    await updatePlugin(pluginId, data);
    locationService.reload();
  } catch (error) {
    console.error('Error while updating the plugin', error);
  }
};

const updatePlugin = async (pluginId: string, data: Partial<PluginMeta>) => {
  const response = getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });
  return lastValueFrom(response);
};
