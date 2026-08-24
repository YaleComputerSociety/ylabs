import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserContext from '../../contexts/UserContext';
import axios from '../../utils/axios';
import Profile from '../profile';
import { expectNoAxeViolations } from '../../testUtils/axe';

vi.mock('../../utils/axios', () => ({ default: { get: vi.fn() } }));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const NETID = 'fixture-profile';

const profile = {
  netid: NETID,
  fname: 'Test',
  lname: 'Person',
  title: 'Professor of Computation',
  primary_department: 'Computer Science',
  secondary_departments: [],
  departments: ['Computer Science'],
  profile_urls: {},
  publications: [],
  research_interests: ['Distributed systems', 'Verification'],
  research_interest_summary: 'Builds provably correct distributed systems.',
  topics: ['formal methods'],
  bio: 'Researches computational methods for reliable software.',
  profileVerified: true,
  scholarlyLinks: [
    {
      _id: 'link-1',
      title: 'Fixture research activity',
      url: 'https://research.example.test/activity',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      freeFullTextUrl: 'https://research.example.test/activity/full-text',
      freeFullTextLabel: 'Free PDF',
      discoveredVia: 'OPENALEX',
      year: 2024,
    },
  ],
  researchEntities: [
    {
      _id: 'entity-1',
      slug: 'fixture-research-home',
      name: 'Fixture Research Home',
      shortDescription: 'Studies fixture protocols.',
      researchAreas: ['distributed algorithms'],
      role: 'pi',
    },
  ],
};

const courses = [
  {
    course_code: 'CPSC 426',
    title: 'Distributed Systems',
    season_code: '202403',
    description: 'Design and implementation of distributed systems.',
    professor_names: ['Test Person'],
  },
];

const mockProfileRoutes = () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === `/profiles/${NETID}/courses`) {
      return Promise.resolve({ data: { available: true, courses } });
    }
    if (url === `/profiles/${NETID}`) {
      return Promise.resolve({ data: { profile } });
    }
    return Promise.resolve({ data: {} });
  });
};

const renderProfile = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: { netId: 'fixture-student', userType: 'student' } as any,
          checkContext: vi.fn(),
        }}
      >
        <Routes>
          <Route path="/profile/:netid" element={<Profile />} />
          <Route path="/research" element={<div>Explore Research</div>} />
        </Routes>
      </UserContext.Provider>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('faculty profile accessibility', () => {
  it('has no serious or critical axe violations on the bio tab', async () => {
    mockProfileRoutes();
    const { container } = renderProfile(`/profile/${NETID}`);
    await screen.findByText('Test Person');
    expect(screen.getByRole('tab', { name: 'Bio' }).getAttribute('aria-selected')).toBe('true');
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations after switching to the research tab', async () => {
    mockProfileRoutes();
    const { container } = renderProfile(`/profile/${NETID}`);
    await screen.findByText('Test Person');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    await screen.findByText('Research Activity');
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations on the courses tab', async () => {
    mockProfileRoutes();
    const { container } = renderProfile(`/profile/${NETID}?tab=courses`);
    await screen.findByText('Test Person');
    await screen.findByText('Distributed Systems');
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations in the not-found state', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === `/profiles/${NETID}`) {
        return Promise.reject({ response: { status: 404 } });
      }
      return Promise.resolve({ data: {} });
    });
    const { container } = renderProfile(`/profile/${NETID}`);
    await screen.findByText('Profile not found.');
    await expectNoAxeViolations(container);
  });
});
