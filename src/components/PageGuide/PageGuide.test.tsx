import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageGuide } from './PageGuide';

const items = [{ term: 'Coverage', meaning: 'Share of volume tied to a service.' }];

describe('PageGuide', () => {
  beforeEach(() => window.localStorage.clear());

  it('opens by default and remembers when it is collapsed', () => {
    const { unmount } = render(<PageGuide page="overview" items={items} testId="guide" />);
    expect(screen.getByText('Share of volume tied to a service.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /How to read this page/ }));
    unmount();
    render(<PageGuide page="overview" items={items} testId="guide" />);

    expect(screen.queryByText('Share of volume tied to a service.')).not.toBeInTheDocument();
  });
});
