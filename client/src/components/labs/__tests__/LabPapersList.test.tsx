import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LabPapersList from '../LabPapersList';
import type { LabPaper, LabScholarlyLink } from '../../../types/labDetail';

describe('LabPapersList', () => {
  it('does not render unsafe scholarly destination or full-text links', () => {
    const paper: LabScholarlyLink = {
      _id: 'scholarly-link-1',
      title: 'Unsafe linked source',
      url: 'javascript:alert(1)',
      destinationKind: 'OTHER',
      displaySource: 'External',
      freeFullTextUrl: 'data:text/html,<script>alert(1)</script>',
      freeFullTextLabel: 'Free full text',
      discoveredVia: 'MANUAL',
    };

    const { container } = render(<LabPapersList papers={[paper]} />);

    expect(screen.getByText('Unsafe linked source')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Unsafe linked source' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open source' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Free full text' })).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('does not render unsafe preprint PDF links', () => {
    const paper: LabPaper = {
      _id: 'preprint-1',
      title: 'Preprint with unsafe PDF',
      url: '',
      pdfUrl: 'javascript:alert(1)',
    };

    const { container } = render(<LabPapersList papers={[paper]} showPreprintMeta />);

    expect(screen.getByText('Preprint with unsafe PDF')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'PDF' })).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('does not render malformed DOI links', () => {
    const paper: LabPaper = {
      _id: 'paper-unsafe-doi',
      title: 'Paper with unsafe DOI',
      doi: '10.1145/3368089.3409745?next=https://evil.example',
    };

    const { container } = render(<LabPapersList papers={[paper]} />);

    expect(screen.getByText('Paper with unsafe DOI')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Paper with unsafe DOI' })).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('normalizes encoded titles without rendering embedded markup', () => {
    const paper: LabPaper = {
      _id: 'paper-encoded-title',
      title: 'Safe &amp; Sound &#x3c;img src=x onerror=alert(1)&#x3e;',
      url: 'https://example.edu/paper',
    };

    const { container } = render(<LabPapersList papers={[paper]} />);

    expect(screen.getByRole('link', { name: 'Safe & Sound' })).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });
});
