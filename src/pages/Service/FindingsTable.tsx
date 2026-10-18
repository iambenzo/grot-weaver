import React from 'react';
import { css } from '@emotion/css';
import { dateTimeFormat, GrafanaTheme2 } from '@grafana/data';
import {
  Badge,
  BadgeColor,
  Column,
  IconName,
  InteractiveTable,
  LinkButton,
  Stack,
  Text,
  useStyles2,
} from '@grafana/ui';
import { Bucket, Finding, FindingType, Level, RegistrySource } from '../../api/types';
import { findingKey } from '../../assessment/traceAssessment';
import { LibraryInfo } from '../../assessment/libraries';
import { testIds } from '../../components/testIds';
import { Evidence } from '../../fix/summary';
import { FetchFixOptions } from '../../fix/fixOptions';
import { FixTabs } from './FixTabs';

interface Row {
  id: string;
  finding: Finding;
  library?: LibraryInfo;
  evidence?: Evidence;
}

interface FindingsTableProps {
  findings: Finding[];
  libraryFor: (finding: Finding) => LibraryInfo | undefined;
  evidenceFor: (finding: Finding) => Evidence | undefined;
  semconvVersion: string;
  fetchFix?: FetchFixOptions;
}

const TYPE_LABELS: Record<FindingType, string> = {
  conformant: 'Conformant',
  deprecated: 'Deprecated',
  unit_mismatch: 'Unit mismatch',
  required_attribute_not_present: 'Required missing',
  recommended_attribute_not_present: 'Recommended missing',
  misplaced_attribute: 'Misplaced',
  not_in_registry: 'Not in registry',
  custom: 'Custom',
  sdk_default_service_name: 'SDK default service name',
  missing_service_name: 'No service name',
};

const LEVEL_BADGES: Record<Exclude<Level, ''>, { text: string; color: BadgeColor; icon: IconName }> = {
  violation: { text: 'Violation', color: 'red', icon: 'exclamation-circle' },
  improvement: { text: 'Improvement', color: 'blue', icon: 'arrow-up' },
  information: { text: 'Information', color: 'darkgrey', icon: 'info-circle' },
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

export function FindingsTable({ findings, libraryFor, evidenceFor, semconvVersion, fetchFix }: FindingsTableProps) {
  const styles = useStyles2(getStyles);
  const rows: Row[] = [...findings].sort(byPriority).map((finding) => ({
    id: `${findingKey(finding)}|${finding.type}|${finding.expected ?? ''}`,
    finding,
    library: libraryFor(finding),
    evidence: evidenceFor(finding),
  }));

  const columns: Array<Column<Row>> = [
    { id: 'level', header: 'Level', cell: ({ row }) => <LevelBadge finding={row.original.finding} /> },
    { id: 'name', header: 'Found → expected', cell: ({ row }) => <NameCell finding={row.original.finding} /> },
    { id: 'type', header: 'Finding', cell: ({ row }) => <FindingBadges finding={row.original.finding} /> },
    { id: 'impact', header: 'Impact', cell: ({ row }) => formatImpact(row.original.finding.impact_share) },
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
          <FindingDetails
            finding={row.finding}
            library={row.library}
            evidence={row.evidence}
            semconvVersion={semconvVersion}
            fetchFix={fetchFix}
          />
        )}
      />
    </div>
  );
}

const LEVEL_ORDER: Record<string, number> = { violation: 0, improvement: 1, information: 2, '': 3 };

function byPriority(a: Finding, b: Finding): number {
  return (LEVEL_ORDER[a.level ?? ''] ?? 3) - (LEVEL_ORDER[b.level ?? ''] ?? 3) || b.impact_share - a.impact_share;
}

export function formatImpact(share: number): string {
  if (share > 0 && share < 0.01) {
    return '<1%';
  }
  return `${Math.round(share * 100)}%`;
}

function LevelBadge({ finding }: { finding: Finding }) {
  if (!finding.level) {
    return null;
  }
  const badge = LEVEL_BADGES[finding.level];
  return <Badge text={badge.text} color={badge.color} icon={badge.icon} />;
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
  const context = [
    finding.bucket && BUCKET_LABELS[finding.bucket],
    finding.source && SOURCE_LABELS[finding.source],
    finding.confidence && finding.confidence !== 'high' && `${finding.confidence} confidence`,
  ].filter((part): part is string => Boolean(part));
  return (
    <Stack direction="column" gap={0}>
      <Text weight="medium">{TYPE_LABELS[finding.type]}</Text>
      {context.length > 0 && (
        <Text color="secondary" variant="bodySmall">
          {context.join(' · ')}
        </Text>
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
          {library.likely && 'Likely: '}
          {entry.name || '(no scope name)'} {entry.version}
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

interface FindingDetailsProps {
  finding: Finding;
  library?: LibraryInfo;
  evidence?: Evidence;
  semconvVersion: string;
  fetchFix?: FetchFixOptions;
}

function FindingDetails({ finding, library, evidence, semconvVersion, fetchFix }: FindingDetailsProps) {
  return (
    <Stack direction="column" gap={2}>
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
      {evidence && (
        <div>
          <LinkButton
            href={evidence.url}
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
      <FixTabs
        finding={finding}
        library={library}
        evidence={evidence}
        semconvVersion={semconvVersion}
        fetchFix={fetchFix}
      />
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    marginTop: theme.spacing(2),
  }),
});
