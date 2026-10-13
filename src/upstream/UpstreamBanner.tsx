import React from 'react';
import { Alert, LinkButton, Stack, Text } from '@grafana/ui';
import { isNewerRelease, useDismissedRelease, useUpstreamRelease } from './upstream';
import { testIds } from '../components/testIds';

interface UpstreamBannerProps {
  currentVersion: string;
  enabled: boolean;
}

export function UpstreamBanner({ currentVersion, enabled }: UpstreamBannerProps) {
  const release = useUpstreamRelease(enabled);
  const [dismissed, dismiss] = useDismissedRelease();
  if (!release || !isNewerRelease(release.tag, currentVersion) || dismissed === release.tag) {
    return null;
  }
  return (
    <Alert
      severity="info"
      title={`Semantic conventions ${release.tag} is available`}
      data-testid={testIds.upstream.banner}
      onRemove={() => dismiss(release.tag)}
    >
      <Stack direction="column" gap={1}>
        <Text>
          Scores use the {currentVersion} catalogue bundled with this plugin. The newer catalogue arrives with a plugin
          update.
        </Text>
        <div>
          <LinkButton href={release.url} target="_blank" size="sm" variant="secondary" icon="external-link-alt">
            Release notes
          </LinkButton>
        </div>
      </Stack>
    </Alert>
  );
}
