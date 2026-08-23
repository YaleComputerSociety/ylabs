import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import EvidenceSourceRow from '../EvidenceSourceRow';

describe('EvidenceSourceRow', () => {
  it('renders source type, confidence, observed date, excerpt, and link for admins', () => {
    const { container } = render(
      <EvidenceSourceRow
        isAdmin
        evidence={[
          {
            claim: 'This cluster is based on shared research-area metadata.',
            sourceType: 'Research metadata',
            url: 'https://source.example.test/source',
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
    expect(container.querySelector('a[href="https://source.example.test/source"]')?.textContent).toBe('Open source');
  });

  it('hides the confidence score from non-admins', () => {
    const { container } = render(
      <EvidenceSourceRow
        evidence={[
          {
            claim: 'This cluster is based on shared research-area metadata.',
            sourceType: 'Research metadata',
            observedDate: '2026-01-15T00:00:00.000Z',
            confidence: 0.82,
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('Research metadata');
    expect(container.textContent).toContain('Observed Jan 15, 2026');
    expect(container.textContent).not.toContain('82% confidence');
  });

  it('shows a quiet empty state when no source evidence is attached', () => {
    const { container } = render(<EvidenceSourceRow evidence={[]} />);

    expect(container.textContent).toContain('No source evidence attached');
    expect(container.querySelector('p')?.className).toContain('text-gray-600');
  });

  it('renders metadata fallback confidence as user-facing trust copy', () => {
    const { container } = render(
      <EvidenceSourceRow
        isAdmin
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
    expect(container.querySelector('.text-xs')?.className).toContain('text-gray-600');
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

  it('drops a redaction-marker sentence but keeps the substantive quote (#1076)', () => {
    const { container } = render(
      <EvidenceSourceRow
        evidence={[
          {
            claim: 'This lab welcomes undergraduates.',
            excerpt: 'We welcome undergraduate researchers year-round. Email us at [email redacted].',
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('We welcome undergraduate researchers year-round.');
    expect(container.textContent).not.toContain('[email redacted]');
  });

  it('hides an excerpt that is only a redaction marker (#1076)', () => {
    const { container } = render(
      <EvidenceSourceRow
        evidence={[
          {
            claim: 'Contact instructions exist for this lab.',
            excerpt: 'Email us at [email redacted]',
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('Contact instructions exist for this lab.');
    expect(container.textContent).not.toContain('redacted');
    expect(container.textContent).not.toContain('Email us at');
  });

  it('omits unsafe source links', () => {
    const { container } = render(
      <EvidenceSourceRow
        evidence={[
          {
            claim: 'Unsafe source value should not become a link.',
            url: 'javascript:alert(1)',
          },
          {
            claim: 'Contact addresses should not be treated as source evidence links.',
            url: 'mailto:advisor@yale.edu',
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('Unsafe source value should not become a link.');
    expect(container.textContent).toContain('Contact addresses should not be treated as source evidence links.');
    expect(container.querySelector('a')).toBeNull();
  });
});
