import React, { useState } from 'react';
import { CollapsableSection, Stack, Text } from '@grafana/ui';

const STORAGE_PREFIX = 'semconv-compliance.guide.';

export interface GuideItem {
  term: string;
  meaning: string;
}

interface PageGuideProps {
  page: string;
  items: GuideItem[];
  testId: string;
}

export function PageGuide({ page, items, testId }: PageGuideProps) {
  const [open, setOpen] = useState(() => readOpen(page));
  const toggle = (next: boolean) => {
    setOpen(next);
    writeOpen(page, next);
  };
  return (
    <div data-testid={testId}>
      <CollapsableSection label="How to read this page" isOpen={open} onToggle={toggle}>
        <Stack direction="column" gap={1}>
          {items.map((item) => (
            <Text key={item.term} element="p">
              <strong>{item.term}:</strong> {item.meaning}
            </Text>
          ))}
        </Stack>
      </CollapsableSection>
    </div>
  );
}

function readOpen(page: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + page) !== 'closed';
  } catch {
    return true;
  }
}

function writeOpen(page: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + page, open ? 'open' : 'closed');
  } catch {
    return;
  }
}
