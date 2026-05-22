import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OpportunityDetail from '../opportunityDetail';
import axios from '../../utils/axios';
import { OpportunityDetailPayload } from '../../types/opportunity';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
};

const baseOpportunity: OpportunityDetailPayload = {
  _id: 'opportunity-1',
  entryPathwayId: 'pathway-1',
  researchEntityId: 'entity-1',
  title: 'Spring RA role',
  term: 'Spring 2026',
  deadline: '2026-02-01T00:00:00.000Z',
  deadlineState: 'UPCOMING',
  applicationUrl: 'https://apply.example.edu/role',
  applicationState: 'APPLY_NOW',
  applicationLabel: 'Apply now',
  status: 'OPEN',
  provenance: 'LISTING_BRIDGED',
  provenanceLabel: 'Legacy YLabs listing signal',
  hoursPerWeek: 8,
  payRate: '$18/hour',
  compensationType: 'PAID',
  eligibility: 'Open to Yale undergraduates.',
  sourceUrls: ['https://source.example.edu/posting'],
  researchEntity: {
    _id: 'entity-1',
    slug: 'example-lab',
    name: 'Example Lab',
    displayName: 'Example Lab',
    entityType: 'LAB',
    departments: ['Computer Science'],
    researchAreas: ['AI'],
    school: 'Yale College',
    shortDescription: 'Studies practical systems.',
  },
  pathway: {
    _id: 'pathway-1',
    pathwayType: 'POSTED_ROLE',
    status: 'ACTIVE',
    evidenceStrength: 'DIRECT',
    studentFacingLabel: 'Posted RA role',
    explanation: 'Apply through the official posting.',
    bestNextStep: 'Submit the application.',
    compensation: 'PAID',
    confidence: 0.9,
    sourceUrls: ['https://source.example.edu/posting'],
  },
  evidence: [
    {
      _id: 'evidence-1',
      sourceName: 'ylabs-listing',
      sourceUrl: 'https://source.example.edu/posting',
      field: 'postedOpportunity',
      excerpt: 'Apply through the official posting. Questions: [email redacted]',
      confidence: 0.95,
      observedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

function renderOpportunity(payload: OpportunityDetailPayload, id = 'opportunity-1') {
  mockedAxios.get.mockResolvedValueOnce({ data: payload });

  return render(
    <MemoryRouter initialEntries={[`/opportunities/${id}`]}>
      <Routes>
        <Route path="/opportunities/:id" element={<OpportunityDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('OpportunityDetail page', () => {
  it('smoke-renders a listing-bridged open posting with evidence and application state', async () => {
    const { container } = renderOpportunity(baseOpportunity);

    await screen.findByText('Spring RA role');

    expect(container.textContent).toContain('Apply now');
    expect(container.textContent).toContain('Legacy YLabs listing signal');
    expect(container.textContent).toContain('Listing-derived signal');
    expect(container.textContent).not.toContain('Posted opportunity');
    expect(container.textContent).toContain('Upcoming deadline');
    expect(container.textContent).toContain('Apply through the official posting.');
    expect(container.textContent).toContain('[email redacted]');

    const applicationLink = container.querySelector('a[href="https://apply.example.edu/role"]');
    expect(applicationLink).not.toBeNull();
    expect(applicationLink?.textContent).toBe('Apply now');
  });

  it('smoke-renders a scraper-derived closed posting without an application CTA', async () => {
    const { container } = renderOpportunity(
      {
        ...baseOpportunity,
        _id: 'opportunity-2',
        listingId: undefined,
        status: 'CLOSED',
        deadlineState: 'PAST',
        applicationUrl: undefined,
        applicationState: 'CLOSED',
        applicationLabel: 'Closed',
        provenance: 'SCRAPER_DERIVED',
        provenanceLabel: 'Scraper-derived posting',
        title: 'Archived summer internship',
      },
      'opportunity-2',
    );

    await screen.findByText('Archived summer internship');

    expect(container.textContent).toContain('Closed');
    expect(container.textContent).toContain('Past deadline');
    expect(container.textContent).toContain('Scraper-derived posting');
    expect(container.textContent).toContain('Posted opportunity');
    expect(container.querySelector('a[href="https://apply.example.edu/role"]')).toBeNull();

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/opportunities/opportunity-2',
        expect.any(Object),
      );
    });
  });

  it('renders even when optional evidence is missing from payload', async () => {
    const payloadWithoutEvidence = {
      ...baseOpportunity,
      _id: 'opportunity-3',
      evidence: undefined,
    } as unknown as OpportunityDetailPayload;

    const { container } = renderOpportunity(payloadWithoutEvidence, 'opportunity-3');

    await screen.findByText('Spring RA role');

    expect(container.textContent).toContain('Apply now');
    expect(container.textContent).toContain('Example Lab');
    const sourceLinks = container.querySelectorAll('a[href="https://source.example.edu/posting"]');
    expect(sourceLinks.length).toBeGreaterThan(0);
  });
});
