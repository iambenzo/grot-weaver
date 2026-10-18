import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Stack, Text, useStyles2 } from '@grafana/ui';
import { Ratio, ScoreRow, Signal } from '../../api/types';
import { testIds } from '../../components/testIds';
import { SectionHeading } from '../../components/SectionHeading/SectionHeading';
import { SIGNAL_TILES_HELP } from '../../components/SectionHeading/guides';

const SIGNAL_LABELS: Record<Signal, string> = { metrics: 'Metrics', traces: 'Traces', logs: 'Logs' };
const VOLUME_UNITS: Record<Signal, string> = { metrics: 'series', traces: 'spans', logs: 'log lines' };

interface ScoreTilesProps {
  signal: Signal;
  row?: ScoreRow;
  coverage?: Ratio;
  unmeasured?: number;
  volumeWeighted?: boolean;
}

interface Tile {
  label: string;
  value: string;
  basis: string;
  help: string;
}

export function formatRatio(ratio?: Ratio): string {
  if (!ratio || ratio.value === null) {
    return 'N/A';
  }
  return `${Math.round(ratio.value * 100)}%`;
}

export function ratioBasis(ratio: Ratio | undefined, unit: string, emptyReason: string): string {
  if (!ratio || ratio.denominator === 0) {
    return emptyReason;
  }
  return `${formatCount(ratio.numerator)} of ${formatCount(ratio.denominator)} ${unit}`;
}

interface Counting {
  unit: string;
  weighted?: boolean;
}

function countingFor(volumeWeighted: boolean, signal: Signal, unweightedUnit: string): Counting {
  if (!volumeWeighted) {
    return { unit: unweightedUnit };
  }
  return { unit: `weighted by ${VOLUME_UNITS[signal]}`, weighted: true };
}

function formatCount(count: number): string {
  return Math.round(count).toLocaleString('en-US');
}

function ratioTile(
  label: string,
  ratio: Ratio | undefined,
  counting: Counting,
  emptyReason: string,
  help: string
): Tile {
  return {
    label,
    value: formatRatio(ratio),
    basis: ratioBasis(
      ratio,
      counting.unit,
      counting.weighted ? `${emptyReason}, or none with measured volume` : emptyReason
    ),
    help,
  };
}

function coverageBasis(coverage: Ratio | undefined, unit: string, unmeasured: number): string {
  const basis = ratioBasis(coverage, unit, 'No volume measured');
  if (unmeasured === 0) {
    return basis;
  }
  return `${basis}, ${unmeasured} ${unmeasured === 1 ? 'service' : 'services'} unmeasured`;
}

export function scoreTiles({ signal, row, coverage, unmeasured = 0, volumeWeighted = false }: ScoreTilesProps): Tile[] {
  const scores = row?.scores;
  const names = countingFor(volumeWeighted, signal, 'names');
  const requirementChecks = countingFor(volumeWeighted, signal, 'checks');
  const checks = { unit: 'checks' };
  return [
    ratioTile(
      'Naming: Stable',
      scores?.naming_stable,
      names,
      'No stable names seen',
      'Share of observed names in the Stable bucket that are current'
    ),
    ratioTile(
      'Naming: Release candidate',
      scores?.naming_release_candidate,
      names,
      'No release-candidate names seen',
      'The same for release-candidate names'
    ),
    ratioTile(
      'Naming: Experimental',
      scores?.naming_experimental,
      names,
      'No development or alpha names seen',
      'The same for development and alpha names'
    ),
    ratioTile(
      'Requirements',
      scores?.requirements,
      requirementChecks,
      'No required attributes to check',
      'Required attributes present where checked'
    ),
    ratioTile(
      'Resource',
      scores?.resource,
      checks,
      'No service identity to check',
      'service.name present and not the SDK default'
    ),
    ratioTile(
      'Required resource attributes',
      scores?.required_resource,
      checks,
      'None configured or checkable',
      'Your required resource attributes present per service; separate from semconv conformance'
    ),
    {
      label: 'Deprecated',
      value: String(scores?.deprecated ?? 0),
      basis: 'names, counted per service',
      help: 'Distinct deprecated names in use',
    },
    {
      label: 'Unclassified',
      value: String(scores?.unclassified ?? 0),
      basis: 'names, counted per service',
      help: 'Names in a semconv namespace that match nothing',
    },
    {
      label: 'Coverage',
      value: formatRatio(coverage),
      basis: coverageBasis(coverage, VOLUME_UNITS[signal], unmeasured),
      help:
        unmeasured > 0
          ? `Share of volume that is SDK-origin and attributed to a service; ${unmeasured} services are left out because their volume could not be measured`
          : 'Share of volume that is SDK-origin and attributed to a service',
    },
  ];
}

export function ScoreTiles(props: ScoreTilesProps) {
  const styles = useStyles2(getStyles);
  return (
    <Stack direction="column" gap={1} data-testid={testIds.overview.tiles}>
      <SectionHeading
        title={SIGNAL_LABELS[props.signal]}
        help={SIGNAL_TILES_HELP}
        divided={props.signal === 'metrics'}
      />
      <div className={styles.grid}>
        {scoreTiles(props).map((tile) => (
          <div key={tile.label} className={styles.tile} title={tile.help}>
            <Text color="secondary" variant="bodySmall">
              {tile.label}
            </Text>
            <Text element="span" variant="h2">
              {tile.value}
            </Text>
            <Text color="secondary" variant="bodySmall">
              {tile.basis}
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
