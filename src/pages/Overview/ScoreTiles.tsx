import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Stack, Text, useStyles2 } from '@grafana/ui';
import { Ratio, ScoreRow, Signal } from '../../api/types';
import { testIds } from '../../components/testIds';
import { SectionHeading } from '../../components/SectionHeading/SectionHeading';
import { SIGNAL_TILES_HELP } from '../../components/SectionHeading/guides';

const SIGNAL_LABELS: Record<Signal, string> = { metrics: 'Metrics', traces: 'Traces', logs: 'Logs' };

interface ScoreTilesProps {
  signal: Signal;
  row?: ScoreRow;
  coverage?: Ratio;
}

export function formatRatio(ratio?: Ratio): string {
  if (!ratio || ratio.value === null) {
    return 'N/A';
  }
  return `${Math.round(ratio.value * 100)}%`;
}

export function ScoreTiles({ signal, row, coverage }: ScoreTilesProps) {
  const styles = useStyles2(getStyles);
  const scores = row?.scores;
  const tiles: Array<[string, string, string]> = [
    [
      'Naming: Stable',
      formatRatio(scores?.naming_stable),
      'Share of observed names in the Stable bucket that are current',
    ],
    [
      'Naming: Release candidate',
      formatRatio(scores?.naming_release_candidate),
      'The same for release-candidate names',
    ],
    ['Naming: Experimental', formatRatio(scores?.naming_experimental), 'The same for development and alpha names'],
    ['Requirements', formatRatio(scores?.requirements), 'Required attributes present where checked'],
    ['Resource', formatRatio(scores?.resource), 'service.name present and not the SDK default'],
    [
      'Required resource attributes',
      formatRatio(scores?.required_resource),
      'Your required resource attributes present per service; separate from semconv conformance',
    ],
    ['Deprecated', String(scores?.deprecated ?? 0), 'Distinct deprecated names in use'],
    ['Unclassified', String(scores?.unclassified ?? 0), 'Names in a semconv namespace that match nothing'],
    ['Coverage', formatRatio(coverage), 'Share of volume that is SDK-origin and attributed to a service'],
  ];
  return (
    <Stack direction="column" gap={1} data-testid={testIds.overview.tiles}>
      <SectionHeading title={SIGNAL_LABELS[signal]} help={SIGNAL_TILES_HELP} />
      <div className={styles.grid}>
        {tiles.map(([label, value, help]) => (
          <div key={label} className={styles.tile} title={help}>
            <Text color="secondary" variant="bodySmall">
              {label}
            </Text>
            <Text element="span" variant="h2">
              {value}
            </Text>
          </div>
        ))}
      </div>
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  grid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: theme.spacing(1),
  }),
  tile: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
  }),
});
