import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserContext from '../../contexts/UserContext';
import axios from '../../utils/axios';
import Profile from '../profile';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../components/profile/ProfileHeader', () => ({
  default: ({ profile }: { profile: any }) => (
    <header>
      {profile.fname} {profile.lname}
    </header>
  ),
}));

vi.mock('../../components/profile/ResearchInterests', () => ({
  default: ({
    interests,
    summary,
    topics,
  }: {
    interests: string[];
    summary?: string;
    topics: string[];
  }) => (
    <section>
      Research interests
      <span data-testid="research-interest-count">{interests.length + topics.length}</span>
      {summary && <p>{summary}</p>}
    </section>
  ),
}));

vi.mock('../../components/profile/CourseTableSection', () => ({
  default: () => <section>Course table</section>,
}));

vi.mock('../../components/labs/LabPapersList', () => ({
  default: ({ papers }: { papers: any[] }) => (
    <section>
      {papers.map((paper) => (
        <div key={paper._id}>
          <a href={paper.url}>{paper.title}</a>
          {paper.freeFullTextUrl && (
            <a href={paper.freeFullTextUrl}>{paper.freeFullTextLabel || 'Free full text'}</a>
          )}
        </div>
      ))}
    </section>
  ),
}));

vi.mock('../../components/admin/AdminProfileEditModal', () => ({
  default: () => null,
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
};

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

const profile = {
  netid: 'fixture-profile',
  fname: 'Test',
  lname: 'Person',
  email: 'profile@example.test',
  title: 'Professor of Computation',
  primary_department: 'Computer Science',
  secondary_departments: [],
  departments: ['Computer Science'],
  profile_urls: {},
  publications: [],
  research_interests: [],
  topics: [],
  bio: 'Researches computational methods.',
  profileVerified: true,
  ownListings: ['listing-1'],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Profile page', () => {
  it('removes the legacy posted roles tab and ignores old tab=listings links', async () => {
    mockedAxios.get.mockResolvedValue({ data: { profile } });

    render(
      <MemoryRouter initialEntries={['/profile/fixture-profile?tab=listings']}>
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
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Test Person');
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/profiles/fixture-profile');
    });

    expect(screen.queryByRole('button', { name: 'Posted Roles' })).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Profile sections' })).toBeTruthy();
    const bioTab = screen.getByRole('tab', { name: 'Bio' });
    expect(bioTab.getAttribute('aria-selected')).toBe('true');
    expect(bioTab.className).toContain('min-h-[44px]');
    expect(screen.getByText('Researches computational methods.')).toBeTruthy();
  });

  it('shows scholarly links on the research tab', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        profile: {
          ...profile,
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
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/fixture-profile?tab=research']}>
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
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Test Person');

    expect(screen.getByText('Research interests')).toBeTruthy();
    expect(screen.getByText('Research Activity')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Fixture research activity' }).getAttribute('href'),
    ).toBe('https://research.example.test/activity');
    expect(screen.getByRole('link', { name: 'Free PDF' }).getAttribute('href')).toBe(
      'https://research.example.test/activity/full-text',
    );
  });

  it('shows linked research homes on the research tab', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        profile: {
          ...profile,
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
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/fixture-profile?tab=research']}>
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
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Test Person');

    expect(screen.getByRole('link', { name: 'Fixture Research Home' }).getAttribute('href')).toBe(
      '/research/fixture-research-home',
    );
    expect(screen.getByText('Studies fixture protocols.')).toBeTruthy();
    expect(screen.getByText('Principal Investigator')).toBeTruthy();
    expect(screen.getByText('Distributed Algorithms')).toBeTruthy();
    expect(screen.queryByText('distributed algorithms')).toBeNull();
  });

  it('writes profile tab changes to the URL so browser history can restore them', async () => {
    mockedAxios.get.mockResolvedValue({ data: { profile } });

    render(
      <MemoryRouter initialEntries={['/profile/fixture-profile']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'fixture-student', userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <Routes>
            <Route
              path="/profile/:netid"
              element={
                <>
                  <LocationProbe />
                  <Profile />
                </>
              }
            />
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Test Person');

    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/profile/fixture-profile?tab=research',
    );
    expect(screen.getByRole('tab', { name: 'Research' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Bio' }));
    expect(screen.getByTestId('location').textContent).toBe('/profile/fixture-profile');
    expect(screen.getByRole('tab', { name: 'Bio' }).getAttribute('aria-selected')).toBe('true');
  });

  it('passes prose research-interest summaries to the research tab when chips are absent', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        profile: {
          ...profile,
          research_interests: [],
          research_interest_summary:
            'My research interests include fixture morphology and synthetic systematics.',
          topics: [],
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/fixture-profile?tab=research']}>
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
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Test Person');

    expect(screen.getByTestId('research-interest-count').textContent).toBe('0');
    expect(
      screen.getByText(
        'My research interests include fixture morphology and synthetic systematics.',
      ),
    ).toBeTruthy();
  });

  it('does not use the faculty title as the bio fallback when a profile has no usable bio', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        profile: {
          ...profile,
          title: 'Assistant Professor of Statistics & Data Science',
          bio: '',
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/fixture-profile']}>
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
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Test Person');

    expect(screen.getByText('No bio available.')).toBeTruthy();
    expect(screen.queryByText('Assistant Professor of Statistics & Data Science')).toBeNull();
  });

  it('does not render lab descriptions as profile bio fallback', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        profile: {
          ...profile,
          bio: '',
          researchSummaryFallback:
            'The Fixture Research Home builds instruments for synthetic astronomy examples.',
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/fixture-profile']}>
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
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Test Person');

    expect(screen.getByText('No bio available.')).toBeTruthy();
    expect(screen.queryByText('Research Summary')).toBeNull();
    expect(
      screen.queryByText(
        'The Fixture Research Home builds instruments for synthetic astronomy examples.',
      ),
    ).toBeNull();
  });

  it('sanitizes linked faculty research descriptions on the research tab', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        profile: {
          ...profile,
          researchEntities: [
            {
              _id: 'entity-1',
              slug: 'faculty-research',
              name: 'Fixture Faculty Research',
              kind: 'individual',
              entityType: 'FACULTY_RESEARCH_AREA',
              role: 'pi',
              description:
                'The Fixture Lab conducts research focused on synthetic systems. Review the lab site before contacting this lab.',
              researchAreas: ['Synthetic systems'],
            },
          ],
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/fixture-profile?tab=research']}>
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
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Test Person');

    expect(screen.getByText('Research Homes')).toBeTruthy();
    expect(screen.getByText(/Fixture's research focuses on synthetic systems/)).toBeTruthy();
    expect(screen.getByText(/research website before contacting this research profile/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('lab site');
    expect(document.body.textContent).not.toContain('this lab');
  });
});
