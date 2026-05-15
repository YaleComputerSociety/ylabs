import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import EvidenceSourceRow from '../EvidenceSourceRow';

describe('EvidenceSourceRow', () => {
  it('renders source type, confidence, observed date, excerpt, and link when available', () => {
    const { container } = render(
      <EvidenceSourceRow
        evidence={[
          {
            claim: 'This cluster is based on shared research-area metadata.',
            sourceType: 'Research metadata',
            url: 'https://example.edu/source',
            excerpt: 'Two profiles list machine learning.',
            observedDate: '2026-01-15T00:00:00.000Z',
            confidence: 0.82,
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('This cluster is based on shared research-area metadata.');
    expect(container.textContent).toContain('Research metadata');
    expect(container.textContent).toContain('82% confidence');
    expect(container.textContent).toContain('Observed Jan 15, 2026');
    expect(container.textContent).toContain('Two profiles list machine learning.');
    expect(container.querySelector('a[href="https://example.edu/source"]')?.textContent).toBe('Open source');
  });

  it('shows a quiet empty state when no source evidence is attached', () => {
    const { container } = render(<EvidenceSourceRow evidence={[]} />);

    expect(container.textContent).toContain('No source evidence attached');
  });

  it('renders metadata fallback confidence as user-facing trust copy', () => {
    const { container } = render(
      <EvidenceSourceRow
        evidence={[
          {
            claim: 'Profiles share research-area metadata.',
            sourceType: 'Research metadata',
            confidence: 'metadata fallback',
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('Based on visible Yale metadata');
    expect(container.textContent).not.toContain('Metadata Fallback confidence');
  });

  it('renders raw source enum values as readable labels', () => {
    const { container } = render(
      <EvidenceSourceRow
        evidence={[
          {
            claim: 'This pathway is backed by a posted opening.',
            sourceType: 'POSTED_OPENING',
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('Posted Opening');
    expect(container.textContent).not.toContain('POSTED_OPENING');
  });
});
