import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import PathwayActionCard from '../PathwayActionCard';
import type { PathwaySearchHit } from '../../../types/pathway';

afterEach(() => {
  cleanup();
});

const pathway = (overrides: Partial<PathwaySearchHit> = {}): PathwaySearchHit => ({
  _id: 'pathway-1',
  pathwayType: 'POSTED_ROLE',
  status: 'ACTIVE',
  evidenceStrength: 'DIRECT',
  studentFacingLabel: 'Posted research role',
  explanation: 'A posted role mentions undergraduate research.',
  bestNextStep: 'Apply through the posted listing.',
  bestNextStepCategory: 'apply',
  confidence: 1,
  sourceUrls: ['https://example.yale.edu/posting'],
  researchEntity: {
    _id: 'entity-1',
    slug: 'mccormick-lab',
    name: 'McCormick Lab',
    departments: ['Neuroscience'],
    researchAreas: ['Systems neuroscience'],
  },
  activePostedOpportunity: {
    _id: 'opportunity-1',
    title: 'Spring RA role',
    status: 'OPEN',
    applicationUrl: 'https://example.yale.edu/apply',
  },
  evidence: [
    {
      signalType: 'POSTED_OPENING',
      confidence: 'HIGH',
      confidenceScore: 1,
      sourceUrl: 'https://example.yale.edu/posting',
      excerpt: 'Posted listing: David A. McCormick',
    },
  ],
  ...overrides,
});

describe('PathwayActionCard', () => {
  it('prioritizes the best next step and hides raw enum labels', () => {
    const { container } = render(
      <MemoryRouter>
        <PathwayActionCard pathway={pathway()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Best next step')).toBeTruthy();
    expect(screen.getByText('Apply through the posted listing.')).toBeTruthy();
    expect(screen.getByText('Apply')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'McCormick Lab' }).getAttribute('href')).toBe(
      '/research/mccormick-lab',
    );
    expect(screen.getByRole('link', { name: 'Open application' }).getAttribute('href')).toBe(
      'https://example.yale.edu/apply',
    );
    expect(container.textContent).not.toContain('POSTED_OPENING');
    expect(container.textContent).not.toContain('POSTED_ROLE');
  });

  it('falls back gracefully when no application route is available', () => {
    render(
      <MemoryRouter>
        <PathwayActionCard
          pathway={pathway({
            activePostedOpportunity: undefined,
            bestNextStepCategory: 'plan-outreach',
            bestNextStep: '',
            studentFacingLabel: 'Contact the program with a specific question.',
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Plan targeted outreach')).toBeTruthy();
    expect(screen.getByText('Contact the program with a specific question.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open application' })).toBeNull();
  });
});
