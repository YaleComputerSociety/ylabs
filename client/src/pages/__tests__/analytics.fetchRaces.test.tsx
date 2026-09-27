import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Analytics from '../analytics';
import axios from '../../utils/axios';
import { AnalyticsData } from '../../reducers/analyticsReducer';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

vi.mock('../../components/admin/AdminPanel', () => ({
  default: () => <div data-testid="admin-panel" />,
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

interface RequestConfig {
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

interface PendingRequest {
  url: string;
  config?: RequestConfig;
  resolve: (data: unknown) => void;
}

const analyticsData: AnalyticsData = {
  visitors: {
    lifetime: { total: 1, byType: [{ userType: 'admin', count: 1 }] },
    last7Days: { total: 1, byType: [{ userType: 'admin', count: 1 }] },
    today: { total: 1, byType: [{ userType: 'admin', count: 1 }] },
    loginFrequency: { totalLogins: 1, loginsLast7Days: 1, loginsToday: 1 },
  },
  engagement: {
    search: { totalSearches: 0, searchesLast7Days: 0, searchesToday: 0 },
    topSearchQueries: [],
    userActivity: { activeUsers: 0, avgEventsPerUser: 0 },
    mostActiveUsers: [],
  },
  research: {
    byEventType: [],
    byEntityType: [],
    byUserType: [],
    topEntities: [],
  },
  users: {
    overview: { total: 1, confirmed: 1 },
    byType: [{ userType: 'admin', count: 1 }],
    newUsersLast7Days: 0,
    newUsersToday: 0,
    newUsersTodayByType: [],
  },
  researchEntities: {
    overview: { active: 1, total: 1 },
    byType: [{ entityType: 'LAB', count: 1 }],
    byVisibilityTier: [{ tier: 'student_ready', count: 1 }],
    freshness: {
      observedLast7Days: 1,
      observedLast30Days: 1,
      neverObserved: 0,
      staleOver90Days: 0,
    },
    scholarly: { withRecentGrants: 0 },
  },
  timestamp: '2026-05-17T00:00:00.000Z',
};

const userRow = (netid: string, lname: string, totalEvents: number) => ({
  netid,
  userType: 'undergraduate',
  fname: 'Sample',
  lname,
  totalEvents,
  logins: 1,
  searches: 1,
  researchViews: 1,
  fellowshipViews: 0,
  profileUpdates: 0,
  loginCount: 1,
  lastActive: '2026-05-17T10:00:00.000Z',
});

const ROW_A = userRow('fixa001', 'Alpha', 11);
const ROW_B = userRow('fixb002', 'Beta', 22);

const userPage = (users: unknown[], offset: number, total = 60) => ({
  users,
  total,
  limit: 25,
  offset,
});

const drilldown = (row: typeof ROW_A, eventQuery: string) => ({
  user: row,
  events: [
    {
      id: `${row.netid}-event`,
      eventType: 'search',
      searchQuery: eventQuery,
      timestamp: '2026-05-17T09:00:00.000Z',
    },
  ],
  limit: 50,
});

const auditPage = (page: number, actorNetid: string) => ({
  events: [
    {
      id: `evt-${actorNetid}-${page}`,
      actorNetid,
      action: 'fellowship.update',
      targetType: 'fellowship',
      targetId: `fixture-target-${page}`,
      summary: { note: `note for ${actorNetid} page ${page}` },
      timestamp: '2026-05-17T11:47:00.000Z',
    },
  ],
  total: 60,
  page,
  pageSize: 25,
  totalPages: 3,
});

let pending: PendingRequest[] = [];

const deferredGet = (url: string, config?: RequestConfig) =>
  new Promise((resolve) => {
    pending.push({ url, config, resolve: (data) => resolve({ data }) });
  });

const staticResponses: Record<string, unknown> = {
  '/analytics': analyticsData,
  '/admin/admin-grants': { activeCount: 0, grants: [], legacyAdminsWithoutGrant: [], history: [] },
  '/analytics/search-quality': { totalSearches: 0, zeroResultSearches: 0 },
  '/analytics/search-queries': { queries: [], limit: 25 },
  '/analytics/funnel': { stages: [] },
  '/analytics/actions': { cards: [], items: [] },
};

const isControlled = (url: string) =>
  url === '/analytics/users' ||
  url.startsWith('/analytics/users/') ||
  url === '/admin/audit-events';

const findPending = (predicate: (request: PendingRequest) => boolean) => {
  const match = pending.find(predicate);
  if (!match) throw new Error('expected request was not issued');
  return match;
};

const settle = async (request: PendingRequest, data: unknown) => {
  await act(async () => {
    request.resolve(data);
    await Promise.resolve();
  });
};

const usersRequest = (params: Record<string, unknown>) => (request: PendingRequest) =>
  request.url === '/analytics/users' &&
  Object.entries(params).every(([key, value]) => request.config?.params?.[key] === value);

const auditRequest = (params: Record<string, unknown>) => (request: PendingRequest) =>
  request.url === '/admin/audit-events' &&
  Object.entries(params).every(([key, value]) => request.config?.params?.[key] === value);

const userSection = () =>
  screen.getByRole('heading', { name: 'NetID User Activity' }).closest('section') as HTMLElement;

const auditSection = () =>
  screen.getByRole('heading', { name: 'Admin Action Audit Log' }).closest('section') as HTMLElement;

const renderWithInitialPages = async () => {
  render(<Analytics />);
  await waitFor(() => {
    expect(pending.some(usersRequest({ offset: 0 }))).toBe(true);
    expect(pending.some(auditRequest({ page: 1 }))).toBe(true);
  });
  await settle(findPending(usersRequest({ offset: 0 })), userPage([ROW_A, ROW_B], 0));
  await settle(findPending(auditRequest({ page: 1 })), auditPage(1, 'ops0001'));
  await waitFor(() => {
    expect(within(userSection()).getByText('fixa001')).toBeTruthy();
  });
};

beforeEach(() => {
  pending = [];
  mockedAxios.get.mockImplementation((url: string, config?: RequestConfig) => {
    if (isControlled(url)) return deferredGet(url, config);
    if (url in staticResponses) return Promise.resolve({ data: staticResponses[url] });
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Analytics admin fetches ignore superseded responses', () => {
  it('never shows the previous row in the drilldown header while the next row loads', async () => {
    await renderWithInitialPages();
    const scope = within(userSection());

    fireEvent.click(scope.getByText('fixa001'));
    await settle(
      findPending((request) => request.url === '/analytics/users/fixa001'),
      drilldown(ROW_A, 'alpha query'),
    );
    await waitFor(() => {
      expect(scope.getByText('Query: alpha query')).toBeTruthy();
    });

    fireEvent.click(scope.getByText('fixb002'));

    const aside = within(userSection().querySelector('aside') as HTMLElement);
    expect(aside.getByRole('heading', { name: 'Sample Beta' })).toBeTruthy();
    expect(aside.getByText(/22 events/)).toBeTruthy();
    expect(aside.queryByText(/11 events/)).toBeNull();
    expect(aside.queryByText('Query: alpha query')).toBeNull();
    expect(aside.getByText('Loading recent events…')).toBeTruthy();
  });

  it('keeps the latest selection when an earlier drilldown response lands last', async () => {
    await renderWithInitialPages();
    const scope = within(userSection());

    fireEvent.click(scope.getByText('fixa001'));
    await waitFor(() => {
      expect(pending.some((request) => request.url === '/analytics/users/fixa001')).toBe(true);
    });
    fireEvent.click(scope.getByText('fixb002'));
    await waitFor(() => {
      expect(pending.some((request) => request.url === '/analytics/users/fixb002')).toBe(true);
    });

    const staleRequest = findPending((request) => request.url === '/analytics/users/fixa001');
    expect(staleRequest.config?.signal?.aborted).toBe(true);

    await settle(
      findPending((request) => request.url === '/analytics/users/fixb002'),
      drilldown(ROW_B, 'beta query'),
    );
    await settle(staleRequest, drilldown(ROW_A, 'alpha query'));

    const aside = within(userSection().querySelector('aside') as HTMLElement);
    expect(aside.getByRole('heading', { name: 'Sample Beta' })).toBeTruthy();
    expect(aside.getByText('Query: beta query')).toBeTruthy();
    expect(aside.queryByText('Query: alpha query')).toBeNull();
    expect(aside.queryByText('Loading recent events…')).toBeNull();
  });

  it('resets the user offset with the search change and ignores the older page response', async () => {
    await renderWithInitialPages();
    const scope = within(userSection());

    fireEvent.click(scope.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(pending.some(usersRequest({ offset: 25 }))).toBe(true);
    });
    const stalePage = findPending(usersRequest({ offset: 25 }));

    fireEvent.change(screen.getByLabelText('Search NetID'), { target: { value: 'fixb' } });
    await waitFor(() => {
      expect(pending.some(usersRequest({ search: 'fixb', offset: 0 }))).toBe(true);
    });
    expect(pending.some(usersRequest({ search: 'fixb', offset: 25 }))).toBe(false);
    expect(stalePage.config?.signal?.aborted).toBe(true);

    await settle(findPending(usersRequest({ search: 'fixb', offset: 0 })), userPage([ROW_B], 0, 1));
    await settle(stalePage, userPage([userRow('fixz099', 'Stale', 3)], 25));

    expect(scope.getByText('fixb002')).toBeTruthy();
    expect(scope.queryByText('fixz099')).toBeNull();
    expect(scope.getByText(/Showing 1-1 of 1 matching users/)).toBeTruthy();
  });

  it('debounces the NetID search so typing issues one request for the final value', async () => {
    await renderWithInitialPages();
    const input = screen.getByLabelText('Search NetID');

    fireEvent.change(input, { target: { value: 'f' } });
    fireEvent.change(input, { target: { value: 'fi' } });
    fireEvent.change(input, { target: { value: 'fix' } });

    await waitFor(() => {
      expect(pending.some(usersRequest({ search: 'fix' }))).toBe(true);
    });
    expect(pending.some(usersRequest({ search: 'f' }))).toBe(false);
    expect(pending.some(usersRequest({ search: 'fi' }))).toBe(false);
  });

  it('resets the audit page with the actor filter change and ignores the older page response', async () => {
    await renderWithInitialPages();
    const scope = within(auditSection());

    fireEvent.click(scope.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(pending.some(auditRequest({ page: 2 }))).toBe(true);
    });
    const stalePage = findPending(auditRequest({ page: 2 }));

    fireEvent.change(screen.getByLabelText('Actor NetID'), { target: { value: 'ops0002' } });
    await waitFor(() => {
      expect(pending.some(auditRequest({ actor: 'ops0002', page: 1 }))).toBe(true);
    });
    expect(pending.some(auditRequest({ actor: 'ops0002', page: 2 }))).toBe(false);
    expect(stalePage.config?.signal?.aborted).toBe(true);

    await settle(findPending(auditRequest({ actor: 'ops0002', page: 1 })), {
      ...auditPage(1, 'ops0002'),
      total: 1,
      totalPages: 1,
    });
    await settle(stalePage, auditPage(2, 'ops0001'));

    expect(scope.getByText('ops0002')).toBeTruthy();
    expect(scope.queryByText('note for ops0001 page 2')).toBeNull();
    expect(scope.getByText(/Page 1 of 1 - 1 total actions/)).toBeTruthy();
  });
});
