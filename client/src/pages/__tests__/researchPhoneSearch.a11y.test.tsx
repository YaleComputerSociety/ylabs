import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Research, { __resetResearchPageSnapshotForTests } from '../research';
import axios from '../../utils/axios';
import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import UserContext, { defaultUserContext } from '../../contexts/UserContext';
import type { User } from '../../types/types';
import { resetResearchAnalyticsDedupeForTests } from '../../utils/researchAnalytics';
import { expectNoAxeViolations } from '../../testUtils/axe';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const syntheticEntity = {
  _id: 'synthetic-entity',
  slug: 'synthetic-phone-lab',
  name: 'Synthetic Phone Lab',
  displayName: 'Synthetic Phone Lab',
  kind: 'lab',
  fullDescription: 'Studies synthetic fixtures.',
  departments: ['Computer Science'],
  researchAreas: ['Testing'],
  sourceUrls: ['https://example.edu/synthetic'],
};

const syntheticStudent = { netId: 'zz001', userType: 'undergraduate', isAdmin: false };
const watchedDeadlineLink = /watched program closes within 2 weeks/;

type AuthState = { isLoading: boolean; user?: Partial<User> };

let setAuth: (next: AuthState) => void = () => {};

const Harness = ({ initialAuth }: { initialAuth: AuthState }) => {
  const [auth, updateAuth] = useState(initialAuth);
  // eslint-disable-next-line react-hooks/globals
  setAuth = updateAuth;
  return (
    <UserContext.Provider
      value={{
        ...defaultUserContext,
        isLoading: auth.isLoading,
        isAuthenticated: Boolean(auth.user),
        user: auth.user as User | undefined,
      }}
    >
      <ConfigContext.Provider value={{ ...defaultConfigContext, isLoading: false, isLoaded: true }}>
        <Research />
      </ConfigContext.Provider>
    </UserContext.Provider>
  );
};

const renderResearch = (initialAuth: AuthState, route = '/research') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Harness initialAuth={initialAuth} />
    </MemoryRouter>,
  );

const stubViewport = (isPhone: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    (queryString: string) =>
      ({
        matches: isPhone && queryString === '(max-width: 639px)',
        media: queryString,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );

const submitSearch = async (text: string) => {
  const searchBox = screen.getByRole('searchbox', { name: 'Search y/labs' });
  fireEvent.change(searchBox, { target: { value: text } });
  fireEvent.submit(searchBox.closest('form') as HTMLFormElement);
  await screen.findByText(`1 result for '${text}'`);
};

const pageHeading = () =>
  screen.getByRole('heading', { level: 1, name: 'Find Yale research that fits you.' });

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/watchedPrograms') {
      return Promise.resolve({
        data: {
          watchedPrograms: [
            {
              _id: 'p1',
              title: 'Synthetic Fellowship',
              deadline: new Date(Date.now() + 5 * 86400000).toISOString(),
            },
          ],
        },
      });
    }
    if (url === '/users/watchedProgramPlans') {
      return Promise.resolve({ data: { watchedProgramPlans: {} } });
    }
    return Promise.resolve({ data: {} });
  });
  mockedAxios.post.mockImplementation((url: string) =>
    url === '/research/search'
      ? Promise.resolve({
          data: {
            researchEntities: [syntheticEntity],
            estimatedTotalHits: 1,
            page: 1,
            pageSize: 24,
          },
        })
      : Promise.resolve({ data: { ok: true, accepted: 1 }, status: 202 }),
  );
});

afterEach(() => {
  cleanup();
  __resetResearchPageSnapshotForTests();
  resetResearchAnalyticsDedupeForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Research search header on a phone', () => {
  it('keeps the guest log-in prompt and hides the tagline only visually after a search', async () => {
    stubViewport(true);
    const { container } = renderResearch({ isLoading: false });
    await screen.findByRole('heading', { name: 'Synthetic Phone Lab' });
    expect(pageHeading().className).not.toContain('sr-only');

    await submitSearch('neural circuits');

    expect(pageHeading().className).toContain('sr-only');
    expect(screen.getByRole('link', { name: /log in with yale cas/i })).toBeTruthy();
    const summary = screen.getByText("1 result for 'neural circuits'");
    const stickyBar = summary.closest('.sticky');
    expect(stickyBar).not.toBeNull();
    const bar = within(stickyBar as HTMLElement);
    expect(bar.getByRole('button', { name: /^Filters/ })).toBeTruthy();
    expect(bar.getByRole('combobox', { name: 'Sort research, currently Best match' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('drops the signed-in notice and collapses the watched deadline into one line', async () => {
    stubViewport(true);
    const { container } = renderResearch({ isLoading: false, user: syntheticStudent });
    await screen.findByRole('link', { name: watchedDeadlineLink });
    expect(screen.getByText(/1 still marked Saved/)).toBeTruthy();

    await submitSearch('neural circuits');

    expect(screen.queryByText(/you're signed in/i)).toBeNull();
    expect(screen.queryByText(/browsing as a guest/i)).toBeNull();
    const deadline = screen.getByRole('link', { name: /1 still marked Saved/ });
    expect(deadline.textContent).toMatch(watchedDeadlineLink);
    expect(screen.queryByText(/- 1 still marked Saved/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('keeps the reserved slot when the search painted before the session answered', async () => {
    stubViewport(true);
    renderResearch({ isLoading: true }, '/research?q=neural%20circuits');
    await screen.findByText("1 result for 'neural circuits'");
    const slot = screen.getByText(/browsing as a guest/i).closest('p')?.parentElement;

    act(() => setAuth({ isLoading: false, user: syntheticStudent }));
    const deadline = await screen.findByRole('link', { name: watchedDeadlineLink });

    expect(screen.getByText(/browsing as a guest/i).closest('p')?.parentElement).toBe(slot);
    expect(deadline.closest('p')?.parentElement).toBe(slot);
  });

  it('leaves the header unchanged above the phone breakpoint', async () => {
    stubViewport(false);
    renderResearch({ isLoading: false, user: syntheticStudent });
    await screen.findByRole('link', { name: watchedDeadlineLink });

    await submitSearch('neural circuits');

    expect(pageHeading().className).not.toContain('sr-only');
    expect(screen.getByText(/you're signed in/i)).toBeTruthy();
    expect(screen.getByText(/- 1 still marked Saved/)).toBeTruthy();
  });
});
