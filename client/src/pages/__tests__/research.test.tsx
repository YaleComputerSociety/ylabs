import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Research from '../research';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  post: ReturnType<typeof vi.fn>;
};

const researchEntity = {
  _id: 'entity-1',
  slug: 'ai-safety-lab',
  name: 'AI Safety Lab',
  displayName: 'AI Safety Lab',
  kind: 'lab',
  description: 'Studies reliable machine learning systems.',
  websiteUrl: '',
  location: '',
  departments: ['Computer Science'],
  researchAreas: ['AI safety'],
  school: 'Yale College',
  openness: 'unknown',
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: 'Ada Researcher',
  contactRole: 'Principal investigator',
  sourceUrls: ['https://example.edu/ai-safety'],
};

const pathwayHit = {
  _id: 'pathway-1',
  pathwayType: 'EXPLORATORY_CONTACT',
  status: 'ACTIVE',
  evidenceStrength: 'SOURCE_BACKED',
  studentFacingLabel: 'Plan careful outreach',
  explanation: 'Review the lab profile before contacting anyone.',
  bestNextStep: 'Read the source profile first.',
  bestNextStepCategory: 'plan-outreach',
  confidence: 0.72,
  sourceUrls: ['https://example.edu/ai-safety'],
  researchEntity: {
    _id: 'entity-1',
    slug: 'ai-safety-lab',
    name: 'AI Safety Lab',
    displayName: 'AI Safety Lab',
  },
  evidence: [
    {
      signalType: 'official profile',
      sourceUrl: 'https://example.edu/ai-safety',
      excerpt: 'Reliable machine learning systems.',
      confidenceScore: 0.72,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Research page', () => {
  it('renders the topic-first shell without pre-search result clutter', () => {
    const { container } = render(
      <MemoryRouter>
        <Research />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain('Yale Research');
    expect(container.textContent).toContain('Topic-first discovery');
    expect(container.textContent).toContain('Search Yale research');
    expect(container.textContent).toContain(
      'Search by topic, method, professor, program, or question',
    );
    expect(container.textContent).toContain(
      'Yale research homes, evidence, and practical next steps',
    );
    expect(container.textContent).toContain('Suggested searches');
    expect(container.textContent).toContain('machine learning');
    expect(container.textContent).not.toContain('BCIs for ALS');
    expect(container.textContent).toContain('Browse Research Areas');
    expect(container.textContent).not.toContain('Explore topic clusters');
    expect(container.textContent).not.toContain('Search results');
    expect(container.textContent).not.toContain('Query: all Yale research');
    expect(container.textContent).not.toContain('Research Cluster Rows');
    expect(container.textContent).not.toContain('Grouped Search Results');
    expect(container.textContent).not.toContain('V1 fallback');
    expect(container.textContent).not.toContain('0 profiles');
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reveals grouped results and a status summary after a search', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          researchEntities: [researchEntity],
          estimatedTotalHits: 1,
          page: 1,
          pageSize: 24,
        },
      })
      .mockResolvedValueOnce({
        data: {
          hits: [pathwayHit],
          estimatedTotalHits: 1,
          page: 1,
          pageSize: 8,
        },
      });

    const { container } = render(
      <MemoryRouter>
        <Research />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'protein folding' }));

    await screen.findByText('Results for protein folding');

    expect(screen.getByRole('status').textContent).toContain(
      '1 research home, 1 next-step pathway, 1 contact',
    );
    expect(container.textContent).toContain('Matching Research Homes');
    expect(container.textContent).not.toContain('Papers via profiles');
    expect(container.textContent).toContain('People and Contacts');
    expect(container.textContent).toContain('Best Next Steps');
    expect(container.textContent).not.toContain('Cluster: experimental');
    expect(container.textContent).not.toContain('POSTED_OPENING');
    expect(container.textContent).toContain('AI Safety Lab');
    expect(container.textContent).toContain('Plan outreach');
    expect(container.textContent).toContain('Read the source profile first.');

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/research/search',
        expect.any(Object),
        expect.any(Object),
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/pathways/search',
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  it('shows pathway partial-failure context while still rendering research metadata', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          researchEntities: [researchEntity],
          estimatedTotalHits: 1,
          page: 1,
          pageSize: 24,
        },
      })
      .mockRejectedValueOnce(new Error('Pathway search timeout'));

    const { container } = render(
      <MemoryRouter>
        <Research />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'protein folding' }));

    await screen.findByText('Results for protein folding');
    expect(screen.getByRole('alert')?.textContent).toContain('Pathway search is temporarily unavailable.');
    expect(container.textContent || '').toContain('AI Safety Lab');
  });
});
