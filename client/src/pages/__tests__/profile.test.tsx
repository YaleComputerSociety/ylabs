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
  netid: 'al123',
  fname: 'Ada',
  lname: 'Lovelace',
  email: 'ada.lovelace@yale.edu',
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
      <MemoryRouter initialEntries={['/profile/al123?tab=listings']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'student1', userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <Routes>
            <Route path="/profile/:netid" element={<Profile />} />
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Ada Lovelace');
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/profiles/al123');
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
              title: 'Interface superconductivity in complex oxides',
              url: 'https://doi.org/10.1000/ahn-paper',
              destinationKind: 'DOI',
              displaySource: 'DOI',
              freeFullTextUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/pdf/',
              freeFullTextLabel: 'Free PDF',
              discoveredVia: 'OPENALEX',
              year: 2024,
            },
          ],
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/al123?tab=research']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'student1', userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <Routes>
            <Route path="/profile/:netid" element={<Profile />} />
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Ada Lovelace');

    expect(screen.getByText('Research interests')).toBeTruthy();
    expect(screen.getByText('Research Activity')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Interface superconductivity in complex oxides' }).getAttribute('href'),
    ).toBe('https://doi.org/10.1000/ahn-paper');
    expect(screen.getByRole('link', { name: 'Free PDF' }).getAttribute('href')).toBe(
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/pdf/',
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
              slug: 'dept-cs-james-aspnes',
              name: 'James Aspnes Lab',
              shortDescription: 'Studies distributed algorithms and population protocols.',
              researchAreas: ['Distributed Algorithms'],
              role: 'pi',
            },
          ],
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/al123?tab=research']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'student1', userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <Routes>
            <Route path="/profile/:netid" element={<Profile />} />
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Ada Lovelace');

    expect(screen.getByRole('link', { name: 'James Aspnes Lab' }).getAttribute('href')).toBe(
      '/research/dept-cs-james-aspnes',
    );
    expect(
      screen.getByText('Studies distributed algorithms and population protocols.'),
    ).toBeTruthy();
  });

  it('writes profile tab changes to the URL so browser history can restore them', async () => {
    mockedAxios.get.mockResolvedValue({ data: { profile } });

    render(
      <MemoryRouter initialEntries={['/profile/al123']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'student1', userType: 'student' } as any,
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

    await screen.findByText('Ada Lovelace');

    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByTestId('location').textContent).toBe('/profile/al123?tab=research');
    expect(screen.getByRole('tab', { name: 'Research' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Bio' }));
    expect(screen.getByTestId('location').textContent).toBe('/profile/al123');
    expect(screen.getByRole('tab', { name: 'Bio' }).getAttribute('aria-selected')).toBe('true');
  });

  it('passes prose research-interest summaries to the research tab when chips are absent', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        profile: {
          ...profile,
          research_interests: [],
          research_interest_summary:
            'My research interests include the functional morphology and systematics of mammals.',
          topics: [],
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/sje9?tab=research']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'student1', userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <Routes>
            <Route path="/profile/:netid" element={<Profile />} />
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Ada Lovelace');

    expect(screen.getByTestId('research-interest-count').textContent).toBe('0');
    expect(
      screen.getByText(
        'My research interests include the functional morphology and systematics of mammals.',
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
      <MemoryRouter initialEntries={['/profile/zy279']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'student1', userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <Routes>
            <Route path="/profile/:netid" element={<Profile />} />
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Ada Lovelace');

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
            'The Newburgh Lab builds instruments to chart cosmic history with radio telescopes.',
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/profile/ln267']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'student1', userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <Routes>
            <Route path="/profile/:netid" element={<Profile />} />
          </Routes>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByText('Ada Lovelace');

    expect(screen.getByText('No bio available.')).toBeTruthy();
    expect(screen.queryByText('Research Summary')).toBeNull();
    expect(
      screen.queryByText(
        'The Newburgh Lab builds instruments to chart cosmic history with radio telescopes.',
      ),
    ).toBeNull();
  });
});
