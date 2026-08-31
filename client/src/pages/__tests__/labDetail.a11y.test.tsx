import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LabDetail from '../labDetail';
import axios from '../../utils/axios';
import { LabDetailPayload } from '../../types/labDetail';
import { resetResearchAnalyticsDedupeForTests } from '../../utils/researchAnalytics';
import UserContext, { defaultUserContext } from '../../contexts/UserContext';
import { expectNoAxeViolations } from '../../testUtils/axe';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() },
}));

vi.mock('../../utils/errorTracking', () => ({ captureClientError: vi.fn() }));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const SLUG = 'sample-research-home';
const ENTITY_NAME = 'Sample Research Home';

const richPayload: LabDetailPayload = {
  group: {
    _id: 'entity-1',
    slug: SLUG,
    name: ENTITY_NAME,
    kind: 'lab',
    entityType: 'FACULTY_RESEARCH_AREA',
    fullDescription:
      'Investigates the neural circuits underlying memory formation using imaging and behavioral models.',
    shortDescription: 'Neural circuits of memory.',
    websiteUrl: 'https://research-home.example.test/sample-lab/',
    location: 'New Haven, CT',
    departments: ['Neurology'],
    researchAreas: ['Neuroscience', 'Imaging'],
    school: 'School of Medicine',
    typicalUndergradRoles: ['Research assistant'],
    prerequisiteCourses: ['Introductory neuroscience'],
    creditOptions: ['Course credit'],
    fundingPrograms: [],
    contactEmail: 'lab-contact@example.test',
    contactName: 'Lab Coordinator',
    contactRole: 'Coordinator',
    sourceUrls: ['https://example.yale.edu/lab'],
  },
  members: [
    {
      role: 'pi',
      user: {
        netid: 'fixture.pi',
        fname: 'Alex',
        lname: 'Investigator',
        displayName: 'Alex Investigator',
        primary_department: 'Neurology',
        profileUrls: { official: 'https://profile.example.test/profile/alex-investigator' },
      },
    },
    {
      role: 'grad-student',
      user: {
        netid: 'fixture.member',
        fname: 'Jordan',
        lname: 'Scholar',
        displayName: 'Jordan Scholar',
        primary_department: 'Neurology',
      },
    },
  ],
  accessSignals: [],
  relatedResearchEntities: [
    {
      id: 'entity-2',
      slug: 'related-imaging-group',
      name: 'Related Imaging Group',
      kind: 'lab',
      entityType: 'FACULTY_RESEARCH_AREA',
      departments: ['Radiology'],
    },
  ],
  similarResearchEntities: [
    {
      id: 'entity-3',
      slug: 'similar-memory-lab',
      name: 'Similar Memory Lab',
      kind: 'lab',
      entityType: 'FACULTY_RESEARCH_AREA',
      departments: ['Psychology'],
    },
  ],
};

function renderLabDetail(payload: LabDetailPayload, { isAuthenticated = true } = {}) {
  mockedAxios.post.mockResolvedValue({ status: 202 });
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchEntityIds') {
      return Promise.resolve({ data: { savedResearchEntityIds: [] } });
    }
    if (url === `/research/${SLUG}`) {
      return Promise.resolve({ data: payload });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  return render(
    <UserContext.Provider value={{ ...defaultUserContext, isLoading: false, isAuthenticated }}>
      <MemoryRouter initialEntries={[`/research/${SLUG}`]}>
        <Routes>
          <Route path="/research/:slug" element={<LabDetail />} />
          <Route path="/login" element={<div>Yale sign in</div>} />
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetResearchAnalyticsDedupeForTests();
  localStorage.clear();
});

describe('research-home detail accessibility', () => {
  it('has no serious or critical axe violations in the loaded state', async () => {
    const { container } = renderLabDetail(richPayload);
    await screen.findByText(ENTITY_NAME);
    await screen.findByText('More like this');
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations for an anonymous visitor', async () => {
    const { container } = renderLabDetail(richPayload, { isAuthenticated: false });
    await screen.findByText(ENTITY_NAME);
    await expectNoAxeViolations(container);
  });

  it('announces the loading state with an accessible name and no violations', async () => {
    mockedAxios.post.mockResolvedValue({ status: 202 });
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: [] } });
      }
      return new Promise(() => {});
    });

    const { container } = render(
      <UserContext.Provider
        value={{ ...defaultUserContext, isLoading: false, isAuthenticated: true }}
      >
        <MemoryRouter initialEntries={[`/research/${SLUG}`]}>
          <Routes>
            <Route path="/research/:slug" element={<LabDetail />} />
          </Routes>
        </MemoryRouter>
      </UserContext.Provider>,
    );

    expect(await screen.findByRole('status', { name: /loading research profile/i })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations in the error state', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: [] } });
      }
      return Promise.reject({ response: { status: 500 } });
    });

    const { container } = render(
      <UserContext.Provider
        value={{ ...defaultUserContext, isLoading: false, isAuthenticated: true }}
      >
        <MemoryRouter initialEntries={[`/research/${SLUG}`]}>
          <Routes>
            <Route path="/research/:slug" element={<LabDetail />} />
            <Route path="/research" element={<div>Explore Research</div>} />
          </Routes>
        </MemoryRouter>
      </UserContext.Provider>,
    );

    await screen.findByText('Failed to load this research profile.');
    await expectNoAxeViolations(container);
  });
});
