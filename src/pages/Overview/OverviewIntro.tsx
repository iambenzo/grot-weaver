import React from 'react';
import { CollapsableSection, Stack, Text } from '@grafana/ui';
import { useStoredValue } from '../../storage/useStoredValue';
import { testIds } from '../../components/testIds';

const INTRO_STATE_KEY = 'iambenzo-semconvcompliance-app.overview-intro';
const COLLAPSED = 'collapsed';
const OPEN = 'open';

export function OverviewIntro({ semconvVersion }: { semconvVersion: string }) {
  const [state, setState] = useStoredValue(INTRO_STATE_KEY);
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
            This app reads the metric, span and log names in your Prometheus, Tempo and Loki datasources and checks
            them against the OpenTelemetry semantic conventions {semconvVersion} registry. It only runs read-only
            queries, as you, and changes nothing.
          </Text>
          <Text element="p">
            A name is conformant when it is the current semantic convention name. Deprecated names, wrong units,
            missing required attributes and unknown names inside a semantic convention namespace are findings.
          </Text>
          <Text element="p">
            To fix things, start with Services, worst first, and open one to see each finding with its evidence and
            fix options. Top violations lists names shared by many services, where one library fix helps most.
          </Text>
        </Stack>
      </CollapsableSection>
    </div>
  );
}
