import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { OverviewIntro } from './OverviewIntro';

describe('OverviewIntro', () => {
  beforeEach(() => window.localStorage.clear());

  it('is open on a first visit and names the registry version', () => {
    render(<OverviewIntro semconvVersion="1.37.0" />);

    expect(screen.getByText(/OpenTelemetry semantic conventions 1\.37\.0 registry/)).toBeVisible();
  });

  it('stays collapsed for the viewer after they collapse it', () => {
    const { unmount } = render(<OverviewIntro semconvVersion="1.37.0" />);
    fireEvent.click(screen.getByRole('button', { name: /What this page shows/ }));
    unmount();

    render(<OverviewIntro semconvVersion="1.37.0" />);

    expect(screen.queryByText(/semantic conventions 1\.37\.0 registry/)).not.toBeInTheDocument();
  });
});
