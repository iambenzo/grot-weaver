import React from 'react';
import { CollapsableSection, Stack, Text } from '@grafana/ui';
import { useStoredValue } from '../../storage/useStoredValue';
import { testIds } from '../../components/testIds';
import { currentViewer, viewerId } from '../../assessment/savedResults';

const INTRO_STATE_KEY = 'iambenzo-semconvcompliance-app.overview-intro';
const COLLAPSED = 'collapsed';
const OPEN = 'open';

export function OverviewIntro({ semconvVersion }: { semconvVersion: string }) {
  const [state, setState] = useStoredValue(`${INTRO_STATE_KEY}|${viewerId(currentViewer()) ?? 'anonymous'}`);
  const isOpen = state !== COLLAPSED;
  return (
    <div data-testid={testIds.overview.intro}>
      <CollapsableSection
        label="What this page shows"
        isOpen={isOpen}
        onToggle={(open) => setState(open ? OPEN : COLLAPSED)}
      >
        <Stack direction="column" gap={1}>
          <Text element="p">
            This app reads the metric names and the attribute and label keys on your metrics, spans and logs in your
            Prometheus, Tempo and Loki datasources, and checks them against the OpenTelemetry semantic conventions{' '}
            {semconvVersion} registry. It only runs read-only queries, as you, and changes nothing.
          </Text>
          <Text element="p">
            A name is conformant when it is the current semantic convention name, including the forms Prometheus stores
            it in. Deprecated names, wrong units, missing required attributes and unknown names inside a semantic
            convention namespace are findings.
          </Text>
          <Text element="p">
            To fix things, start with Services, worst first, and open one to see its findings, with evidence where it
            can be found, and fix options. Top violations lists the names seen across the most services, where a shared
            fix helps most.
          </Text>
        </Stack>
      </CollapsableSection>
    </div>
  );
}
