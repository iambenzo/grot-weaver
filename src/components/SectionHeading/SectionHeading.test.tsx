import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SectionHeading } from './SectionHeading';

describe('SectionHeading', () => {
  it('keeps help hidden until the info button is clicked', async () => {
    render(<SectionHeading title="Findings" help={[{ term: 'Levels', meaning: 'Violations need fixing.' }]} />);

    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.queryByText('Violations need fixing.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'About Findings' }));

    expect(await screen.findByText('Violations need fixing.')).toBeInTheDocument();
  });
});
