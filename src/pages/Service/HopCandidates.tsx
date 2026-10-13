import React from 'react';
import { Badge, Card, Stack, Text } from '@grafana/ui';
import { ServiceHops } from '../../api/types';
import { testIds } from '../../components/testIds';

export function HopCandidates({ hops }: { hops?: ServiceHops }) {
  if (!hops || hops.candidates.length === 0) {
    return null;
  }
  return (
    <Stack direction="column" gap={1} data-testid={testIds.service.hops}>
      <Text element="h4">Candidate pipeline hops</Text>
      <Text color="secondary" variant="bodySmall">
        Inferred from collector self-metrics, resource attributes and names. A plain collector leaves no trace in the
        data, so these are candidates, not confirmed hops.
      </Text>
      {hops.candidates.map((candidate, index) => (
        <Card key={candidate.pipeline} noMargin>
          <Card.Heading>{candidate.pipeline}</Card.Heading>
          <Card.Tags>
            <Badge
              text={index === 0 ? 'Most likely candidate' : 'Candidate'}
              color={index === 0 ? 'blue' : 'darkgrey'}
            />
          </Card.Tags>
          <Card.Description>
            <ul>
              {candidate.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Card.Description>
        </Card>
      ))}
    </Stack>
  );
}
