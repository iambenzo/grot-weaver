import React from 'react';
import { css } from '@emotion/css';
import { dateTimeFormat, GrafanaTheme2 } from '@grafana/data';
import { Badge, BadgeColor, Column, InteractiveTable, LinkButton, Stack, Text, useStyles2 } from '@grafana/ui';
import { Bucket, Finding, FindingType, RegistrySource } from '../../api/types';
import { findingKey } from '../../assessment/traceAssessment';
import { LibraryInfo } from '../../assessment/libraries';
import { testIds } from '../../components/testIds';

interface Row {
  id: string;
  finding: Finding;
  library?: LibraryInfo;
  explore?: string;
}

interface FindingsTableProps {
  findings: Finding[];
  libraryFor: (finding: Finding) => LibraryInfo | undefined;
  exploreFor: (finding: Finding) => string | undefined;
}

const TYPE_LABELS: Record<FindingType, { text: string; color: BadgeColor }> = {
  conformant: { text: 'Conformant', color: 'green' },
  deprecated: { text: 'Deprecated', color: 'orange' },
  unit_mismatch: { text: 'Unit mismatch', color: 'orange' },
  required_attribute_not_present: { text: 'Required missing', color: 'red' },
  recommended_attribute_not_present: { text: 'Recommended missing', color: 'blue' },
  misplaced_attribute: { text: 'Misplaced', color: 'blue' },
  not_in_registry: { text: 'Not in registry', color: 'red' },
  custom: { text: 'Custom', color: 'darkgrey' },
  sdk_default_service_name: { text: 'SDK default service name', color: 'red' },
  missing_service_name: { text: 'No service name', color: 'red' },
};

const BUCKET_LABELS: Record<Bucket, string> = {
  stable: 'Stable',
  release_candidate: 'Release candidate',
  experimental: 'Experimental',
  unclassified: 'Unclassified',
};

const SOURCE_LABELS: Record<RegistrySource, string> = {
  core: 'semconv',
  genai: 'GenAI semconv',
  rename_history: 'rename history',
};

export function FindingsTable({ findings, libraryFor, exploreFor }: FindingsTableProps) {
  const styles = useStyles2(getStyles);
  const rows: Row[] = [...findings].sort(byPriority).map((finding) => ({
    id: `${findingKey(finding)}|${finding.type}|${finding.expected ?? ''}`,
    finding,
    library: libraryFor(finding),
    explore: exploreFor(finding),
  }));

  const columns: Array<Column<Row>> = [
    { id: 'name', header: 'Found → expected', cell: ({ row }) => <NameCell finding={row.original.finding} /> },
    { id: 'type', header: 'Finding', cell: ({ row }) => <FindingBadges finding={row.original.finding} /> },
    { id: 'library', header: 'Library or SDK', cell: ({ row }) => <LibraryCell library={row.original.library} /> },
    { id: 'seen', header: 'First / last seen', cell: ({ row }) => <SeenCell library={row.original.library} /> },
  ];

  return (
    <div className={styles.table} data-testid={testIds.service.findingsTable}>
      <InteractiveTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        renderExpandedRow={(row) => (
          <FindingDetails finding={row.finding} library={row.library} explore={row.explore} />
        )}
      />
    </div>
  );
}

const LEVEL_ORDER: Record<string, number> = { violation: 0, improvement: 1, information: 2, '': 3 };

function byPriority(a: Finding, b: Finding): number {
  return (LEVEL_ORDER[a.level ?? ''] ?? 3) - (LEVEL_ORDER[b.level ?? ''] ?? 3) || b.impact_share - a.impact_share;
}

const REQUIREMENT_TYPES: FindingType[] = ['required_attribute_not_present', 'recommended_attribute_not_present'];

function NameCell({ finding }: { finding: Finding }) {
  if (REQUIREMENT_TYPES.includes(finding.type)) {
    return (
      <span>
        <code>{finding.expected}</code> missing from <code>{finding.observed}</code>{' '}
        {finding.signal === 'metrics' ? 'series' : 'spans'}
      </span>
    );
  }
  const showRegistryName = finding.matched && finding.matched !== finding.observed;
  return (
    <Stack direction="column" gap={0}>
      <span>
        <code>{finding.observed || '(empty)'}</code>
        {finding.expected && finding.expected !== finding.observed && (
          <>
            {' → '}
            <code>{finding.expected}</code>
          </>
        )}
      </span>
      {showRegistryName && (
        <Text color="secondary" variant="bodySmall">
          stored form of <code>{finding.matched}</code>
        </Text>
      )}
    </Stack>
  );
}

function FindingBadges({ finding }: { finding: Finding }) {
  const type = TYPE_LABELS[finding.type];
  return (
    <Stack gap={0.5} wrap="wrap">
      <Badge text={type.text} color={type.color} />
      {finding.bucket && <Badge text={BUCKET_LABELS[finding.bucket]} color="purple" />}
      {finding.source && <Badge text={SOURCE_LABELS[finding.source]} color="darkgrey" />}
      {finding.confidence && finding.confidence !== 'high' && (
        <Badge text={`${finding.confidence} confidence`} color="blue" />
      )}
    </Stack>
  );
}

function LibraryCell({ library }: { library?: LibraryInfo }) {
  if (!library) {
    return <Text color="secondary">library unknown</Text>;
  }
  if (library.libraries.length === 0) {
    return <Text color="secondary">not found in window</Text>;
  }
  return (
    <Stack direction="column" gap={0}>
      {library.libraries.map((entry) => (
        <span key={`${entry.name}@${entry.version ?? ''}`}>
          {library.likely && <Badge text="Likely" color="blue" />} {entry.name || '(no scope name)'} {entry.version}
        </span>
      ))}
      <Text color="secondary" variant="bodySmall">
        {library.confidence} confidence, {library.description}
      </Text>
    </Stack>
  );
}

function SeenCell({ library }: { library?: LibraryInfo }) {
  if (library?.firstSeenMs === undefined || library.lastSeenMs === undefined) {
    return <Text color="secondary">—</Text>;
  }
  return (
    <Stack direction="column" gap={0}>
      <span>{dateTimeFormat(library.firstSeenMs)}</span>
      <span>{dateTimeFormat(library.lastSeenMs)}</span>
    </Stack>
  );
}

function FindingDetails({ finding, library, explore }: { finding: Finding; library?: LibraryInfo; explore?: string }) {
  return (
    <Stack direction="column" gap={1}>
      {finding.note && <Text>{finding.note}</Text>}
      {!finding.expected && finding.type === 'deprecated' && (
        <Text color="secondary">
          The registry gives no single replacement; the note above explains which name to use where.
        </Text>
      )}
      {finding.metrics && finding.metrics.length > 0 && (
        <Text color="secondary">
          Seen on {finding.metrics.length === 1 ? 'metric' : 'metrics'}: {finding.metrics.join(', ')}
        </Text>
      )}
      {library?.libraries.some((entry) => 'spans' in entry) && (
        <Text color="secondary">
          Spans seen:{' '}
          {library.libraries
            .map((entry) => `${entry.name || '(no scope name)'} ${(entry as { spans?: number }).spans ?? ''}`)
            .join(', ')}
        </Text>
      )}
      {explore && (
        <div>
          <LinkButton
            href={explore}
            icon="compass"
            variant="secondary"
            size="sm"
            target="_blank"
            data-testid={testIds.service.explore}
          >
            Open in Explore
          </LinkButton>
        </div>
      )}
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    marginTop: theme.spacing(2),
  }),
});
