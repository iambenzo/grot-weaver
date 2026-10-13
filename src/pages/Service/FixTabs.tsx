import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import {
  Alert,
  ClipboardButton,
  LoadingPlaceholder,
  Stack,
  Tab,
  TabContent,
  TabsBar,
  Text,
  TextLink,
  useStyles2,
} from '@grafana/ui';
import { Finding } from '../../api/types';
import { LibraryInfo } from '../../assessment/libraries';
import { FetchFixOptions, FixLibrary, FixOptions, fetchFixOptions, identifiedLibrary } from '../../fix/fixOptions';
import { Evidence, ownerSummary } from '../../fix/summary';
import { messageOf } from '../../assessment/useStackAssessment';
import { testIds } from '../../components/testIds';

type FixTab = 'instrumentation' | 'pipeline' | 'raise';

const TABS: Array<{ id: FixTab; label: string }> = [
  { id: 'instrumentation', label: 'Instrumentation' },
  { id: 'pipeline', label: 'Pipeline rule' },
  { id: 'raise', label: 'Raise with owner' },
];

interface FixTabsProps {
  finding: Finding;
  library?: LibraryInfo;
  evidence?: Evidence;
  semconvVersion: string;
  fetchFix?: FetchFixOptions;
}

type Loaded = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; options: FixOptions };

export function FixTabs({ finding, library, evidence, semconvVersion, fetchFix = fetchFixOptions }: FixTabsProps) {
  const [active, setActive] = useState<FixTab>('instrumentation');
  const fixLibrary = identifiedLibrary(finding, library);
  const loaded = useFixOptions(finding, fixLibrary, fetchFix);
  const summary = ownerSummary(finding.owner, [{ finding, library: fixLibrary, evidence }], semconvVersion);

  return (
    <Stack direction="column" gap={1} data-testid={testIds.fix.tabs}>
      <TabsBar>
        {TABS.map((tab) => (
          <Tab key={tab.id} label={tab.label} active={tab.id === active} onChangeTab={() => setActive(tab.id)} />
        ))}
      </TabsBar>
      <TabContent>
        {active === 'raise' ? (
          <RaiseWithOwner summary={summary} />
        ) : loaded.status === 'loading' ? (
          <LoadingPlaceholder text="Preparing fix options…" />
        ) : loaded.status === 'failed' ? (
          <Alert severity="warning" title="Could not prepare fix options">
            {loaded.message}
          </Alert>
        ) : active === 'instrumentation' ? (
          <Instrumentation finding={finding} library={library} options={loaded.options} />
        ) : (
          <PipelineRuleTab options={loaded.options} />
        )}
      </TabContent>
    </Stack>
  );
}

function useFixOptions(finding: Finding, library: FixLibrary | undefined, fetchFix: FetchFixOptions): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const libraryName = library?.name;
  const libraryVersion = library?.version;
  useEffect(() => {
    let cancelled = false;
    const requested = libraryName ? { name: libraryName, version: libraryVersion } : undefined;
    fetchFix(finding, requested)
      .then((options) => !cancelled && setLoaded({ status: 'ready', options }))
      .catch((error: unknown) => !cancelled && setLoaded({ status: 'failed', message: messageOf(error) }));
    return () => {
      cancelled = true;
    };
  }, [finding, libraryName, libraryVersion, fetchFix]);
  return loaded;
}

function Instrumentation({
  finding,
  library,
  options,
}: {
  finding: Finding;
  library?: LibraryInfo;
  options: FixOptions;
}) {
  const { guidance } = options;
  const named = guidance.library;
  return (
    <Stack direction="column" gap={1}>
      {named ? (
        <Text>
          Identified {library?.likely ? 'likely ' : ''}library: <code>{named.name}</code>
          {named.version ? ` ${named.version}` : ''}
          {library ? ` (${library.confidence} confidence, ${library.description})` : ''}. Upgrade or reconfigure it so
          it emits {guidance.expected ? <code>{guidance.expected}</code> : 'the current names'}.
        </Text>
      ) : (
        <Text color="secondary">
          The library or SDK that emits this name could not be identified, so upgrade advice cannot name one. Check the
          service&apos;s OpenTelemetry dependencies.
        </Text>
      )}
      {guidance.docs_url ? (
        <div>
          <TextLink href={guidance.docs_url} external>
            Semantic convention definition of {guidance.expected}
          </TextLink>
        </div>
      ) : (
        <Text color="secondary">{noDefinitionReason(finding)}</Text>
      )}
      {guidance.opt_in && (
        <Alert severity="info" title={`Set ${guidance.opt_in.variable}=${guidance.opt_in.value}`}>
          <Stack direction="column" gap={1}>
            <Text>{guidance.opt_in.note}</Text>
            <Stack gap={1} wrap="wrap">
              {guidance.opt_in.sources.map((source) => (
                <TextLink key={source} href={source} external>
                  {sourceLabel(source)}
                </TextLink>
              ))}
            </Stack>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}

function PipelineRuleTab({ options }: { options: FixOptions }) {
  const styles = useStyles2(getStyles);
  const rule = options.pipeline_rule;
  if (!rule.available) {
    return <Text color="secondary">{rule.reason ?? 'No pipeline rule is offered for this finding.'}</Text>;
  }
  return (
    <Stack direction="column" gap={2}>
      <Alert severity="warning" title={capitalise(rule.label ?? '')}>
        Add the processor to the matching pipeline, and in Alloy point its output at your exporter.
      </Alert>
      <Snippet title="OpenTelemetry Collector" text={rule.collector ?? ''} className={styles.code} />
      <Snippet title="Grafana Alloy" text={rule.alloy ?? ''} className={styles.code} />
    </Stack>
  );
}

function Snippet({ title, text, className }: { title: string; text: string; className: string }) {
  return (
    <Stack direction="column" gap={0.5}>
      <Stack gap={1} alignItems="center">
        <Text weight="medium">{title}</Text>
        <ClipboardButton size="sm" variant="secondary" icon="copy" getText={() => text}>
          Copy
        </ClipboardButton>
      </Stack>
      <pre className={className}>{text}</pre>
    </Stack>
  );
}

function RaiseWithOwner({ summary }: { summary: string }) {
  const styles = useStyles2(getStyles);
  return (
    <Stack direction="column" gap={1}>
      <div>
        <ClipboardButton size="sm" variant="secondary" icon="copy" getText={() => summary}>
          Copy summary
        </ClipboardButton>
      </div>
      <pre className={styles.code} data-testid={testIds.fix.summary}>
        {summary}
      </pre>
    </Stack>
  );
}

function noDefinitionReason(finding: Finding): string {
  if (finding.type === 'deprecated') {
    return 'The registry gives no single replacement, so there is no one definition to link. The registry note explains which name to use where.';
  }
  return 'This finding has no expected registry name to link to.';
}

function sourceLabel(url: string): string {
  if (url.includes('opentelemetry.io/docs/specs/semconv')) {
    return 'Semconv migration guide';
  }
  return url.replace('https://github.com/open-telemetry/', '').split('/blob/')[0] + ' source';
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const getStyles = (theme: GrafanaTheme2) => ({
  code: css({
    margin: 0,
    padding: theme.spacing(1),
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
  }),
});
