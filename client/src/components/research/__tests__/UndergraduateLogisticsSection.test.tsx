import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UndergraduateLogisticsSection } from '../UndergraduateLogisticsSection';

describe('UndergraduateLogisticsSection', () => {
  it('shows known claims with their exact official evidence', () => {
    render(
      <UndergraduateLogisticsSection
        logistics={{
          status: 'ready',
          claims: [
            {
              claimType: 'TIME_COMMITMENT',
              state: 'known',
              value: { minHours: 8, maxHours: 10, period: 'WEEK' },
              evidence: {
                sourceUrl: 'https://example.yale.edu/join',
                excerpt: 'Students commit 8 to 10 hours per week.',
                observedAt: '2026-07-01T00:00:00.000Z',
                expiresAt: '2027-07-01T00:00:00.000Z',
              },
            },
            { claimType: 'COMPENSATION', state: 'unknown' },
          ],
        }}
      />,
    );

    expect(screen.getByText('8-10 hours per week')).toBeTruthy();
    expect(screen.getByText('Students commit 8 to 10 hours per week.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Official evidence' }).getAttribute('href')).toBe(
      'https://example.yale.edu/join',
    );
    expect(screen.getByText(/Missing details are unknown, not negative answers/)).toBeTruthy();
  });

  it('renders missing fields as neutral unknowns, never negative availability', () => {
    render(
      <UndergraduateLogisticsSection
        logistics={{
          status: 'ready',
          claims: [
            { claimType: 'STUDENT_LEVEL', state: 'unknown' },
            { claimType: 'COMPENSATION', state: 'unknown' },
            { claimType: 'TIME_COMMITMENT', state: 'unknown' },
            { claimType: 'MODALITY', state: 'unknown' },
            { claimType: 'CURRENT_AVAILABILITY', state: 'unknown' },
          ],
        }}
      />,
    );

    expect(screen.getByText(/not documented on an official source yet/)).toBeTruthy();
    expect(screen.getByText(/does not mean the research home is unavailable/)).toBeTruthy();
    expect(screen.queryByText('Not currently available')).toBeNull();
  });

  it('shows a negative availability answer only when it is a known sourced claim', () => {
    render(
      <UndergraduateLogisticsSection
        logistics={{
          status: 'ready',
          claims: [
            {
              claimType: 'CURRENT_AVAILABILITY',
              state: 'known',
              value: { status: 'NOT_CURRENTLY_AVAILABLE' },
              evidence: {
                sourceUrl: 'https://example.yale.edu/join',
                excerpt: 'We are not currently accepting undergraduate students.',
                observedAt: '2026-07-01T00:00:00.000Z',
                expiresAt: '2026-08-30T00:00:00.000Z',
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Not currently available')).toBeTruthy();
    expect(screen.getByText(/not currently accepting undergraduate students/)).toBeTruthy();
  });

  it('withholds stale and conflicting values while preserving review states', () => {
    render(
      <UndergraduateLogisticsSection
        logistics={{
          status: 'ready',
          claims: [
            { claimType: 'MODALITY', state: 'conflicting_withheld' },
            { claimType: 'CURRENT_AVAILABILITY', state: 'stale_under_review' },
          ],
        }}
      />,
    );

    expect(screen.getByText(/Conflicting official evidence is under review/)).toBeTruthy();
    expect(screen.getByText(/latest evidence is stale/)).toBeTruthy();
  });

  it('keeps the profile usable when optional logistics enrichment fails', () => {
    render(<UndergraduateLogisticsSection logistics={{ status: 'unavailable', claims: [] }} />);

    expect(screen.getByText(/rest of this research profile/)).toBeTruthy();
  });
});
