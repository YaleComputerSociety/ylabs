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
});
