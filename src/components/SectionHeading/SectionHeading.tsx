import React from 'react';
import { Box, IconButton, Stack, Text, Toggletip } from '@grafana/ui';
import { GuideItem } from './guides';

interface SectionHeadingProps {
  title: string;
  help: GuideItem[];
  variant?: 'h3' | 'h4';
}

export function SectionHeading({ title, help, variant = 'h3' }: SectionHeadingProps) {
  return (
    <Box marginTop={2}>
      <Stack gap={0.5} alignItems="center">
        <Text element="h2" variant={variant}>
          {title}
        </Text>
        <Toggletip title={title} content={<HelpContent items={help} />} placement="bottom-start">
          <IconButton name="info-circle" size="sm" aria-label={`About ${title}`} />
        </Toggletip>
      </Stack>
    </Box>
  );
}

function HelpContent({ items }: { items: GuideItem[] }) {
  return (
    <Stack direction="column" gap={1}>
      {items.map((item) => (
        <Text key={item.term ?? item.meaning} element="p">
          {item.term && <strong>{item.term}: </strong>}
          {item.meaning}
        </Text>
      ))}
    </Stack>
  );
}
