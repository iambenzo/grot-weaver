import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { UpstreamBanner } from './UpstreamBanner';
import { useUpstreamRelease } from './upstream';
import { testIds } from '../components/testIds';

jest.mock('./upstream', () => ({ ...jest.requireActual('./upstream'), useUpstreamRelease: jest.fn() }));

beforeEach(() => window.localStorage.clear());

const mockedRelease = useUpstreamRelease as jest.MockedFunction<typeof useUpstreamRelease>;
const url = 'https://github.com/open-telemetry/semantic-conventions/releases/tag/v1.45.0';

describe('UpstreamBanner', () => {
  it('says a newer catalogue arrives with a plugin update', () => {
    mockedRelease.mockReturnValue({ tag: 'v1.45.0', url });

    render(<UpstreamBanner currentVersion="v1.44.0" enabled />);

    expect(screen.getByTestId(testIds.upstream.banner)).toHaveTextContent(
      'The newer catalogue arrives with a plugin update.'
    );
    expect(screen.getByRole('link', { name: /release notes/i })).toHaveAttribute('href', url);
  });

  it('stays hidden when the bundled catalogue is current or the check is off', () => {
    mockedRelease.mockReturnValue({ tag: 'v1.44.0', url });
    const { container, rerender } = render(<UpstreamBanner currentVersion="v1.44.0" enabled />);
    expect(container).toBeEmptyDOMElement();

    mockedRelease.mockReturnValue(undefined);
    rerender(<UpstreamBanner currentVersion="v1.44.0" enabled={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockedRelease).toHaveBeenLastCalledWith(false);
  });

  it('stays dismissed for that release only', () => {
    mockedRelease.mockReturnValue({ tag: 'v1.45.0', url });
    const { rerender } = render(<UpstreamBanner currentVersion="v1.44.0" enabled />);

    fireEvent.click(screen.getByRole('button', { name: /close alert/i }));
    expect(screen.queryByTestId(testIds.upstream.banner)).not.toBeInTheDocument();

    mockedRelease.mockReturnValue({ tag: 'v1.46.0', url });
    rerender(<UpstreamBanner currentVersion="v1.44.0" enabled />);
    expect(screen.getByTestId(testIds.upstream.banner)).toBeInTheDocument();
  });
});
