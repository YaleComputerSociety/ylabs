import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    views: { totalViews: 0, viewsLast7Days: 0, viewsToday: 0 },
    favorites: [],
    trendingListings: [],
    userActivity: { activeUsers: 0, avgEventsPerUser: 0 },
    mostActiveUsers: [],
    totalViewsFromCounters: 0,
    totalFavoritesFromCounters: 0,
    avgViews: 0,
    avgFavorites: 0,
    viewsByDepartment: [],
  },
  research: {
    byEventType: [],
    byEntityType: [],
    byUserType: [],
    topEntities: [],
  },
  listings: {
    overview: { total: 0, active: 0, archived: 0, unconfirmed: 0 },
    newListingsLast7Days: 0,
    newListingsToday: 0,
    byDepartment: [],
    byProfessor: [],
    listingsWithZeroViews: 0,
    topViewedListings: [],
    topFavoritedListings: [],
  },
  users: {
    overview: { total: 1, confirmed: 1 },
    byType: [{ userType: 'admin', count: 1 }],
    newUsersLast7Days: 0,
    newUsersToday: 0,
    newUsersTodayByType: [],
  },
  researchEntities: {
    overview: { active: 40, total: 40 },
    byType: [{ entityType: 'LAB', count: 40 }],
    byVisibilityTier: [{ tier: 'student_ready', count: 12 }],
    byOpenness: [{ status: 'unknown', count: 25 }],
    freshness: {
      observedLast7Days: 8,
      observedLast30Days: 20,
      neverObserved: 4,
      staleOver90Days: 6,
    },
    scholarly: { withRecentGrants: 9 },
  },
  timestamp: '2026-05-17T00:00:00.000Z',
};

const auditEventsPage1 = {
  events: [
    {
      id: 'evt-1',
      actorNetid: 'ops2001',
      action: 'admin_grant.revoke',
      targetType: 'adminGrant',
      targetId: 'subj0007',
      summary: { status: 'revoked', note: 'coverage rotation complete' },
      timestamp: '2026-05-17T14:32:00.000Z',
    },
    {
      id: 'evt-2',
      actorNetid: 'ops1001',
      action: 'admin_grant.grant',
      targetType: 'adminGrant',
      targetId: 'subj0007',
      summary: { status: 'granted', note: 'temporary operator onboarding' },
      timestamp: '2026-05-17T13:05:00.000Z',
    },
    {
      id: 'evt-3',
      actorNetid: 'ops1001',
      action: 'listing.update',
      targetType: 'listing',
      targetId: '664f0c2a9b1e4a0012ab34cd',
      summary: { fields: ['title', 'description'] },
      timestamp: '2026-05-17T11:47:00.000Z',
    },
  ],
  total: 30,
  page: 1,
  pageSize: 25,
  totalPages: 2,
};

const auditEventsPage2 = {
  events: [
    {
      id: 'evt-26',
      actorNetid: 'ops1001',
      action: 'fellowship.archive',
      targetType: 'fellowship',
      targetId: 'fel-2025-spring',
      summary: { status: 'archived' },
      timestamp: '2026-05-10T09:00:00.000Z',
    },
  ],
  total: 30,
  page: 2,
  pageSize: 25,
  totalPages: 2,
};

const adminGrantsResponse = {
  activeCount: 1,
  grants: [
    {
      netid: 'subj0007',
      status: 'active',
      source: 'manual',
      grantedAt: '2026-05-17T13:05:00.000Z',
      grantedBy: 'ops1001',
    },
  ],
  legacyAdminsWithoutGrant: [],
  history: [
    {
      action: 'revoked',
      actorNetid: 'ops2001',
      note: 'coverage rotation complete',
      at: '2026-05-17T14:32:00.000Z',
      subjectNetid: 'subj0007',
    },
    {
      action: 'granted',
      actorNetid: 'ops1001',
      note: 'temporary operator onboarding',
      at: '2026-05-17T13:05:00.000Z',
      subjectNetid: 'subj0007',
    },
    {
      action: 'granted',
      actorNetid: 'bootstrap',
      note: 'initial operator seed',
      at: '2026-05-01T08:00:00.000Z',
      subjectNetid: 'ops1001',
    },
  ],
};

const buildUserRow = (index: number) => ({
  netid: `user${String(index).padStart(2, '0')}`,
  userType: index % 2 === 0 ? 'graduate' : 'undergraduate',
  fname: 'Sample',
  lname: `User${index}`,
  totalEvents: 30 - index,
  logins: 5,
  searches: 4,
  views: 3,
  fellowshipViews: 0,
  listingFavorites: 0,
  listingUnfavorites: 0,
  fellowshipFavorites: 0,
  fellowshipUnfavorites: 0,
  outreachClicks: 0,
  outreachOutcomes: 0,
  listingCreates: 0,
  listingUpdates: 0,
  listingArchives: 0,
  listingUnarchives: 0,
  profileUpdates: 0,
  loginCount: 5,
  lastActive: `2026-05-17T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
});

const USER_TOTAL = 30;

const userPage = (offset: number, limit: number) => ({
  users: Array.from({ length: Math.max(0, Math.min(limit, USER_TOTAL - offset)) }, (_, i) =>
    buildUserRow(offset + i),
  ),
  total: USER_TOTAL,
  limit,
  offset,
});

const mockAxios = () => {
  mockedAxios.get.mockImplementation((url: string, config?: any) => {
    switch (url) {
      case '/analytics':
        return Promise.resolve({ data: analyticsData });
      case '/analytics/users': {
        const offset = config?.params?.offset ?? 0;
        const limit = config?.params?.limit ?? 4;
        return Promise.resolve({ data: userPage(offset, limit) });
      }
      case '/admin/admin-grants':
        return Promise.resolve({ data: adminGrantsResponse });
      case '/admin/audit-events': {
        const page = config?.params?.page ?? 1;
        return Promise.resolve({ data: page >= 2 ? auditEventsPage2 : auditEventsPage1 });
      }
      case '/analytics/search-quality':
        return Promise.resolve({ data: { totalSearches: 0, zeroResultSearches: 0 } });
      case '/analytics/search-queries':
        return Promise.resolve({ data: { queries: [], limit: 25 } });
      case '/analytics/funnel':
        return Promise.resolve({ data: { stages: [] } });
      case '/analytics/actions':
        return Promise.resolve({ data: { cards: [], items: [] } });
      default:
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }
  });
};

const setUserActivityLimitTo = (limit: number) => {
  fireEvent.change(screen.getByLabelText('Limit'), { target: { value: String(limit) } });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Analytics admin audit + grant history + user pagination surfaces', () => {
  it('renders the append-only audit log with mapped action labels and paginates by page', async () => {
    mockAxios();
    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Admin Action Audit Log' })).toBeTruthy();
    });

    const auditSection = screen
      .getByRole('heading', { name: 'Admin Action Audit Log' })
      .closest('section') as HTMLElement;
    const auditScope = within(auditSection);
    const auditTable = () => within(auditSection.querySelector('table') as HTMLElement);

    await waitFor(() => {
      expect(auditTable().getByText('Admin revoked')).toBeTruthy();
    });
    expect(auditTable().getByText('Admin granted')).toBeTruthy();
    expect(auditTable().getByText('Listing edited')).toBeTruthy();
    expect(auditTable().getByText('ops2001')).toBeTruthy();
    expect(auditTable().getByText('coverage rotation complete')).toBeTruthy();
    expect(auditTable().getByText('title, description')).toBeTruthy();
    expect(auditScope.getByText(/Page 1 of 2 - 30 total actions/)).toBeTruthy();

    const auditPrev = auditScope.getByRole('button', { name: 'Previous' });
    const auditNext = auditScope.getByRole('button', { name: 'Next' });
    expect(auditPrev).toHaveProperty('disabled', true);
    expect(auditNext).toHaveProperty('disabled', false);

    fireEvent.click(auditNext);

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/admin/audit-events',
        expect.objectContaining({ params: expect.objectContaining({ page: 2 }) }),
      );
    });
    await waitFor(() => {
      expect(auditScope.getByText(/Page 2 of 2 - 30 total actions/)).toBeTruthy();
    });
    expect(auditTable().getByText('Fellowship archived')).toBeTruthy();
  });

  it('filters the audit log through the action dropdown', async () => {
    mockAxios();
    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Admin Action Audit Log' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'admin_grant.grant' } });

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/admin/audit-events',
        expect.objectContaining({
          params: expect.objectContaining({ action: 'admin_grant.grant' }),
        }),
      );
    });
  });

  it('renders the merged grant history timeline newest-first', async () => {
    mockAxios();
    render(<Analytics />);

    const historyHeading = await screen.findByRole('heading', { name: 'Admin access history' });
    const historyList = await waitFor(() => {
      const list = historyHeading.parentElement?.querySelector('ol');
      if (!list) throw new Error('history list not rendered yet');
      return list as HTMLElement;
    });
    const items = within(historyList).getAllByRole('listitem');

    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('revoked')).toBeTruthy();
    expect(within(items[0]).getByText('subj0007')).toBeTruthy();
    expect(within(items[0]).getByText(/by ops2001/)).toBeTruthy();
    expect(within(items[1]).getByText('granted')).toBeTruthy();
    expect(within(items[2]).getByText('ops1001')).toBeTruthy();
  });

  it('paginates the user activity table via Previous/Next using offset', async () => {
    mockAxios();
    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'NetID User Activity' })).toBeTruthy();
    });

    setUserActivityLimitTo(10);

    await waitFor(() => {
      expect(screen.getByText(/Showing 1-10 of 30 matching users/)).toBeTruthy();
    });

    const userSection = screen
      .getByRole('heading', { name: 'NetID User Activity' })
      .closest('section') as HTMLElement;
    const userScope = within(userSection);
    const userNext = userScope.getByRole('button', { name: 'Next' });
    const userPrev = userScope.getByRole('button', { name: 'Previous' });
    expect(userPrev).toHaveProperty('disabled', true);
    expect(userNext).toHaveProperty('disabled', false);

    fireEvent.click(userNext);

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/analytics/users',
        expect.objectContaining({ params: expect.objectContaining({ offset: 10 }) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/Showing 11-20 of 30 matching users/)).toBeTruthy();
    });
    expect(userScope.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', false);
  });

  it('emits rendered HTML of the three new surfaces for visual review', async () => {
    mockAxios();
    const { container } = render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Admin Action Audit Log' })).toBeTruthy();
    });
    setUserActivityLimitTo(10);
    await waitFor(() => {
      expect(screen.getByText(/Showing 1-10 of 30 matching users/)).toBeTruthy();
    });

    const auditSection = screen
      .getByRole('heading', { name: 'Admin Action Audit Log' })
      .closest('section') as HTMLElement;
    await waitFor(() => {
      expect(within(auditSection.querySelector('table') as HTMLElement).getByText('Admin revoked'))
        .toBeTruthy();
    });
    const historyBlock = screen
      .getByRole('heading', { name: 'Admin access history' })
      .closest('div') as HTMLElement;
    const userSection = screen
      .getByRole('heading', { name: 'NetID User Activity' })
      .closest('section') as HTMLElement;

    const outPath = process.env.ADMIN_AUDIT_EVIDENCE_HTML;
    if (outPath) {
      const fragments = [
        { title: 'Admin Action Audit Log', html: auditSection.outerHTML },
        { title: 'Admin Access History Timeline', html: historyBlock.outerHTML },
        { title: 'User Activity Table Pagination', html: userSection.outerHTML },
      ];
      const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1200, initial-scale=1" />
<script src="https://cdn.tailwindcss.com"></script>
<style>
  :root {
    --yr-blue:#00356b;--yr-navy:#0b1f3a;--yr-page:#fbfaf7;--yr-parchment:#f6f2ea;
    --yr-text:#222;--yr-border:#e2e8f0;--yr-border-warm:#e7dfd2;--yr-ink:var(--yr-navy);
    --yr-muted:#5f6570;--yr-line:var(--yr-border);--yr-line-strong:#cbd5e1;
    --yr-paper:var(--yr-page);--yr-panel:#fff;--yr-panel-muted:#f7f3ec;
  }
  body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--yr-paper);color:var(--yr-ink);margin:0;padding:24px;}
  .evidence-card{background:#fff;border:1px solid var(--yr-border-warm);border-radius:12px;padding:20px;margin-bottom:28px;box-shadow:0 8px 24px rgba(11,31,58,0.06);}
  .evidence-label{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--yr-blue);margin-bottom:12px;}
</style>
</head>
<body>
<h1 style="font-size:20px;font-weight:800;margin:0 0 20px;">Yale Research - Operator Analytics: new admin audit surfaces (#446)</h1>
${fragments
  .map(
    (f) =>
      `<section class="evidence-card"><div class="evidence-label">${f.title}</div>${f.html}</section>`,
  )
  .join('\n')}
</body>
</html>`;
      const resolved = isAbsolute(outPath) ? outPath : join(process.cwd(), outPath);
      if (!existsSync(dirname(resolved))) mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, doc, 'utf8');
    }

    expect(container).toBeTruthy();
  });
});
