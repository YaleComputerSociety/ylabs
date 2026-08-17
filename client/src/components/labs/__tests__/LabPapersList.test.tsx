import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LabPapersList from '../LabPapersList';
import type { LabScholarlyLink } from '../../../types/labDetail';

describe('LabPapersList', () => {
  it('does not render unsafe scholarly destination or full-text links', () => {
    const link: LabScholarlyLink = {
      _id: 'scholarly-link-1',
      title: 'Unsafe linked source',
      url: 'javascript:alert(1)',
      destinationKind: 'OTHER',
      displaySource: 'External',
      freeFullTextUrl: 'data:text/html,<script>alert(1)</script>',
      freeFullTextLabel: 'Free full text',
      discoveredVia: 'MANUAL',
    };

    const { container } = render(<LabPapersList papers={[link]} />);

    expect(screen.getByText('Unsafe linked source')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Unsafe linked source' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open source' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Free full text' })).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders a safe scholarly link with source label, open-source and free-full-text links', () => {
    const link: LabScholarlyLink = {
      _id: 'scholarly-link-2',
      title: 'Open access study',
      url: 'https://example.edu/study',
      destinationKind: 'PMC',
      displaySource: 'PubMed Central',
      freeFullTextUrl: 'https://example.edu/study.pdf',
      freeFullTextLabel: 'Free full text',
      discoveredVia: 'OFFICIAL_PROFILE',
      year: 2024,
      venue: 'Journal of Examples',
    };

    render(<LabPapersList papers={[link]} />);

    expect(screen.getAllByRole('link', { name: 'Open source' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Free full text' }).length).toBeGreaterThan(0);
    expect(screen.getByText('PubMed Central')).toBeTruthy();
    expect(screen.getByText('Journal of Examples')).toBeTruthy();
    expect(screen.getByText('2024')).toBeTruthy();
  });

  it('normalizes encoded titles without rendering embedded markup', () => {
    const link: LabScholarlyLink = {
      _id: 'scholarly-encoded-title',
      title: 'Safe &amp; Sound &#x3c;img src=x onerror=alert(1)&#x3e;',
      url: 'https://example.edu/paper',
      destinationKind: 'DOI',
      displaySource: 'Publisher',
      discoveredVia: 'OFFICIAL_PROFILE',
    };

    const { container } = render(<LabPapersList papers={[link]} />);

    expect(screen.getByRole('link', { name: 'Safe & Sound' })).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });
});
