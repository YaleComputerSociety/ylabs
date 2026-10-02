import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Research, { __resetResearchPageSnapshotForTests } from '../research';
import axios from '../../utils/axios';
import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import UserContext, { defaultUserContext } from '../../contexts/UserContext';
import type { User } from '../../types/types';
import { resetResearchAnalyticsDedupeForTests } from '../../utils/researchAnalytics';

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
  slug: 'synthetic-timing-lab',
  name: 'Synthetic Timing Lab',
  displayName: 'Synthetic Timing Lab',
  kind: 'lab',
  fullDescription: 'Studies synthetic fixtures.',
  departments: ['Computer Science'],
  researchAreas: ['Testing'],
  sourceUrls: ['https://example.edu/synthetic'],
};

const departments = [
  {
    abbreviation: 'CPSC',
    name: 'Computer Science',
    displayName: 'Computer Science',
    categories: ['Computing & AI'],
    primaryCategory: 'Computing & AI',
    colorKey: 0,
  },
];

type AuthState = { isLoading: boolean; user?: Partial<User> };
type ConfigState = { isLoading: boolean };

let setAuth: (next: AuthState) => void = () => {};
let setConfig: (next: ConfigState) => void = () => {};

const Harness = ({
  initialAuth,
  initialConfig,
}: {
  initialAuth: AuthState;
  initialConfig: ConfigState;
}) => {
  const [auth, updateAuth] = useState(initialAuth);
  const [config, updateConfig] = useState(initialConfig);
  setAuth = updateAuth;
  setConfig = updateConfig;
  return (
    <UserContext.Provider
      value={{
        ...defaultUserContext,
        isLoading: auth.isLoading,
        isAuthenticated: Boolean(auth.user),
        user: auth.user as User | undefined,
      }}
    >
      <ConfigContext.Provider
        value={{
          ...defaultConfigContext,
          isLoading: config.isLoading,
          isLoaded: !config.isLoading,
          departments: config.isLoading ? [] : departments,
          departmentCategories: config.isLoading ? [] : ['Computing & AI'],
        }}
      >
        <Research />
      </ConfigContext.Provider>
    </UserContext.Provider>
  );
};

const renderWithPendingAuth = (
  route = '/research',
  initialConfig: ConfigState = { isLoading: false },
) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Harness initialAuth={{ isLoading: true }} initialConfig={initialConfig} />
    </MemoryRouter>,
  );

const searchCalls = () =>
  mockedAxios.post.mock.calls.filter(([url]) => url === '/research/search') as Array<
    [string, Record<string, unknown>]
  >;

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  mockedAxios.get.mockResolvedValue({ data: {} });
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
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Research page while the session check is pending', () => {
  it('sends the first browse search before auth resolves and hides the guest notice until it does', async () => {
    renderWithPendingAuth();

    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: 'Synthetic Timing Lab' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /log in with yale cas/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /your dashboard/i })).toBeNull();

    act(() => setAuth({ isLoading: false }));

    expect(screen.getByRole('link', { name: /log in with yale cas/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /your dashboard/i })).toBeNull();
    expect(searchCalls()).toHaveLength(1);
  });

  it.each([
    ['a signed-in student', { netId: 'zz001', userType: 'undergraduate', isAdmin: false }],
    ['an admin', { netId: 'zz002', userType: 'undergraduate', isAdmin: true }],
  ])('does not repeat the browse search once auth resolves as %s', async (_label, user) => {
    renderWithPendingAuth();
    await screen.findByRole('heading', { name: 'Synthetic Timing Lab' });

    const noticeSlot = screen.getByText(/browsing as a guest/i).closest('p')?.parentElement;

    act(() => setAuth({ isLoading: false, user: user as Partial<User> }));

    const guestNotice = screen.getByText(/browsing as a guest/i).closest('p');
    const signedInNotice = screen.getByText(/you're signed in/i).closest('p');
    expect(
      guestNotice?.parentElement === noticeSlot && signedInNotice?.parentElement === noticeSlot,
    ).toBe(true);
    expect(screen.queryByRole('link', { name: /log in with yale cas/i })).toBeNull();
    expect(screen.getByRole('link', { name: /your dashboard/i }).getAttribute('href')).toBe(
      '/dashboard',
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(searchCalls()).toHaveLength(1);
    if (user.isAdmin) {
      expect(screen.queryByRole('checkbox', { name: /weakest profiles first/i })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
      expect(
        within(screen.getByRole('dialog', { name: 'Research filters' })).getByRole('checkbox', {
          name: /weakest profiles first/i,
        }),
      ).toBeTruthy();
    }
  });

  it('does not repeat the browse search when config arrives after the first search', async () => {
    renderWithPendingAuth('/research', { isLoading: true });
    await screen.findByRole('heading', { name: 'Synthetic Timing Lab' });

    act(() => setConfig({ isLoading: false }));
    act(() => setAuth({ isLoading: false }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(searchCalls()).toHaveLength(1);
  });

  it('waits for auth before honouring an admin-only browse link', async () => {
    renderWithPendingAuth('/research?weak=1');
    await act(async () => {
      await Promise.resolve();
    });
    expect(searchCalls()).toHaveLength(0);

    act(() =>
      setAuth({
        isLoading: false,
        user: { netId: 'zz002', userType: 'undergraduate', isAdmin: true } as Partial<User>,
      }),
    );

    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(searchCalls()[0][1]).toMatchObject({ browseQuality: 'low-first' });
  });

  it('waits for config before running a department link search', async () => {
    renderWithPendingAuth('/research?dept=Computer%20Science', { isLoading: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(searchCalls()).toHaveLength(0);

    act(() => setConfig({ isLoading: false }));

    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(searchCalls()[0][1]).toMatchObject({
      filters: expect.objectContaining({ departments: expect.any(Array) }),
    });
  });
});
