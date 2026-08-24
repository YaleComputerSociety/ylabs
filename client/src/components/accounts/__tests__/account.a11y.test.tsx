import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import SavedResearchPlans from '../SavedResearchPlans';
import ResearchHomeComparison from '../ResearchHomeComparison';
import ProgramWatch from '../ProgramWatch';
import { expectNoAxeViolations } from '../../../testUtils/axe';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('sweetalert', () => ({ default: vi.fn() }));

vi.mock('../../../utils/researchAnalytics', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/researchAnalytics')>(
    '../../../utils/researchAnalytics',
  );
  return {
    ...actual,
    trackResearchEvent: vi.fn().mockResolvedValue(undefined),
    createResearchAnalyticsInteractionId: () => 'test-interaction',
  };
});

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('account dashboard accessibility', () => {
  it('has no serious or critical axe violations for saved research plans', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: ['owner-lab', 'other-lab'] } });
      }
      if (url === '/users/savedResearchEntities') {
        return Promise.resolve({
          data: {
            savedResearchEntities: [
              { _id: 'id1', slug: 'owner-lab', name: 'Owner Lab', kind: 'lab', departments: ['CS'] },
              { _id: 'id2', slug: 'other-lab', name: 'Other Lab', kind: 'center', departments: [] },
            ],
          },
        });
      }
      if (url === '/users/savedResearchEntityPlans') {
        return Promise.resolve({
          data: { savedResearchEntityPlans: { id1: { privateNotes: 'Ask about rotations' } } },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const { container } = render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Owner Lab');
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations for the empty saved-plans state', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: [] } });
      }
      if (url === '/users/savedResearchEntities') {
        return Promise.resolve({ data: { savedResearchEntities: [] } });
      }
      return Promise.resolve({ data: { savedResearchEntityPlans: {} } });
    });

    const { container } = render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('No saved research plans yet');
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations for the comparison dialog', async () => {
    const entityA = {
      _id: 'a',
      slug: 'lab-a',
      name: 'Lab A',
      school: 'School of Engineering',
      departments: ['Computer Science'],
      researchAreas: ['Robotics'],
      shortDescription: 'Studies autonomous robots.',
      websiteUrl: 'https://engineering.example.edu/lab-a',
      sourceUrls: [],
      currentUndergradCount: 3,
    };
    const entityB = {
      _id: 'b',
      slug: 'lab-b',
      name: 'Lab B',
      school: '',
      departments: [],
      researchAreas: [],
      shortDescription: '',
      websiteUrl: '',
      sourceUrls: [],
    };
    mockedAxios.get.mockImplementation((url: string) => {
      const slug = url.replace('/research/', '');
      const entity = { 'lab-a': entityA, 'lab-b': entityB }[slug];
      if (!entity) return Promise.reject(new Error('not found'));
      return Promise.resolve({ data: { researchEntity: entity } });
    });

    const { container } = render(
      <MemoryRouter>
        <ResearchHomeComparison
          entities={[
            { _id: 'a', slug: 'lab-a', name: 'Lab A' },
            { _id: 'b', slug: 'lab-b', name: 'Lab B' },
          ]}
          notesByEntityId={{ a: 'Ask about summer rotations' }}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await screen.findByRole('link', { name: 'Lab A' });
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations for the watched-program export surface', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/watchedProgramIds') {
        return Promise.resolve({ data: { watchedProgramIds: ['p1', 'p2'] } });
      }
      if (url === '/users/watchedPrograms') {
        return Promise.resolve({
          data: {
            watchedPrograms: [
              {
                _id: 'p1',
                id: 'p1',
                title: 'Summer Research Grant',
                deadline: '2099-06-30T00:00:00.000Z',
                isAcceptingApplications: true,
                eligibility: 'Undergraduates',
              },
              {
                _id: 'p2',
                id: 'p2',
                title: 'Travel Fellowship',
                isAcceptingApplications: false,
                eligibility: 'Seniors',
              },
            ],
          },
        });
      }
      if (url === '/users/watchedProgramPlans') {
        return Promise.resolve({
          data: {
            watchedProgramPlans: {
              p1: { privateNotes: 'Ask about housing', stage: 'SAVED' },
              p2: { privateNotes: '', stage: 'APPLIED' },
            },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const { container } = render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    expect(screen.getByRole('button', { name: /Add all deadlines to calendar/i })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});
