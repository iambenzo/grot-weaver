import React from 'react';
import { css } from '@emotion/css';
import { dateTimeFormat, GrafanaTheme2 } from '@grafana/data';
import { Badge, BadgeColor, Column, InteractiveTable, Stack, Text, useStyles2 } from '@grafana/ui';
import { Bucket, Finding, FindingType, RegistrySource } from '../../api/types';
import { LibraryEvidence } from '../../inventory/traceLibraries';
import { findingKey } from '../../assessment/traceAssessment';
import { testIds } from '../../components/testIds';

interface Row {
  id: string;
  finding: Finding;
  evidence?: LibraryEvidence;
}

interface FindingsTableProps {
  findings: Finding[];
  evidence: Map<string, LibraryEvidence>;
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

export function FindingsTable({ findings, evidence }: FindingsTableProps) {
  const styles = useStyles2(getStyles);
  const rows: Row[] = findings.map((finding) => ({ id: findingKey(finding), finding, evidence: evidence.get(findingKey(finding)) }));

  const columns: Array<Column<Row>> = [
    { id: 'name', header: 'Found → expected', cell: ({ row }) => <NameCell finding={row.original.finding} /> },
    { id: 'type', header: 'Finding', cell: ({ row }) => <FindingBadges finding={row.original.finding} /> },
    { id: 'library', header: 'Library or SDK', cell: ({ row }) => <LibraryCell evidence={row.original.evidence} /> },
    { id: 'seen', header: 'First / last seen', cell: ({ row }) => <SeenCell evidence={row.original.evidence} /> },
  ];

  return (
    <div className={styles.table} data-testid={testIds.service.findingsTable}>
      <InteractiveTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        renderExpandedRow={(row) => <FindingDetails finding={row.finding} evidence={row.evidence} />}
      />
    </div>
  );
}

const REQUIREMENT_TYPES: FindingType[] = ['required_attribute_not_present', 'recommended_attribute_not_present'];

function NameCell({ finding }: { finding: Finding }) {
  if (REQUIREMENT_TYPES.includes(finding.type)) {
    return (
      <span>
        <code>{finding.expected}</code> missing from <code>{finding.observed}</code> spans
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
      {finding.confidence && finding.confidence !== 'high' && <Badge text={`${finding.confidence} confidence`} color="blue" />}
    </Stack>
  );
}

function LibraryCell({ evidence }: { evidence?: LibraryEvidence }) {
  if (!evidence) {
    return <Text color="secondary">—</Text>;
  }
  if (evidence.libraries.length === 0) {
    return <Text color="secondary">not found in window</Text>;
  }
  return (
    <Stack direction="column" gap={0}>
      {evidence.libraries.map((library) => (
        <span key={`${library.name}@${library.version}`}>
          {library.name || '(no scope name)'} {library.version}
        </span>
      ))}
      <Text color="secondary" variant="bodySmall">
        {evidence.confidence} confidence, from {evidence.method === 'metrics' ? 'TraceQL metrics' : 'a span sample'}
      </Text>
    </Stack>
  );
}

function SeenCell({ evidence }: { evidence?: LibraryEvidence }) {
  if (evidence?.firstSeenMs === undefined || evidence.lastSeenMs === undefined) {
    return <Text color="secondary">—</Text>;
  }
  return (
    <Stack direction="column" gap={0}>
      <span>{dateTimeFormat(evidence.firstSeenMs)}</span>
      <span>{dateTimeFormat(evidence.lastSeenMs)}</span>
    </Stack>
  );
}

function FindingDetails({ finding, evidence }: { finding: Finding; evidence?: LibraryEvidence }) {
  return (
    <Stack direction="column" gap={1}>
      {finding.note && <Text>{finding.note}</Text>}
      {!finding.expected && finding.type === 'deprecated' && (
        <Text color="secondary">The registry gives no single replacement; the note above explains which name to use where.</Text>
      )}
      {evidence && evidence.libraries.some((library) => library.spans !== undefined) && (
        <Text color="secondary">
          Spans seen: {evidence.libraries.map((library) => `${library.name || '(no scope name)'} ${library.spans}`).join(', ')}
        </Text>
      )}
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    marginTop: theme.spacing(2),
  }),
});
