import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Research, { __resetResearchPageSnapshotForTests } from '../pages/research';
import axios from '../utils/axios';
import UserContextProvider from '../providers/UserContextProvider';
import ConfigContextProvider from '../providers/ConfigContextProvider';
import { resetResearchAnalyticsDedupeForTests } from '../utils/researchAnalytics';

vi.mock('../utils/axios', () => ({
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
  slug: 'synthetic-cold-visit-lab',
  name: 'Synthetic Cold Visit Lab',
  displayName: 'Synthetic Cold Visit Lab',
  kind: 'lab',
  fullDescription: 'Studies synthetic fixtures.',
  departments: ['Computer Science'],
  researchAreas: ['Testing'],
  sourceUrls: ['https://example.edu/synthetic'],
};

const syntheticConfig = {
  researchAreas: { areas: [{ name: 'Testing', colorKey: 'blue' }], fields: [], fieldOrder: [] },
  departments: {
    list: [
      {
        abbreviation: 'CPSC',
        name: 'Computer Science',
        displayName: 'Computer Science',
        categories: ['Computing & AI'],
        primaryCategory: 'Computing & AI',
        colorKey: 0,
      },
    ],
    categories: ['Computing & AI'],
    pillEligibleLabels: [],
  },
};

type SessionCheck = { answer: () => void; fail: () => void };

let sessionCheck: SessionCheck;

const requestedEndpoints = (): string[] =>
  [...mockedAxios.get.mock.calls, ...mockedAxios.post.mock.calls]
    .map(([url]) => String(url))
    .filter((url) => !url.startsWith('/analytics'))
    .sort();

const renderColdVisit = () =>
  render(
    <MemoryRouter initialEntries={['/research']}>
      <UserContextProvider>
        <ConfigContextProvider>
          <Research />
        </ConfigContextProvider>
      </UserContextProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/check') {
      return new Promise((resolve, reject) => {
        sessionCheck = {
          answer: () => resolve({ data: { auth: false } }),
          fail: () => reject(new Error('network')),
        };
      });
    }
    if (url === '/config') return Promise.resolve({ data: syntheticConfig });
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
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('a cold visit to a public page', () => {
  it('sends only the session check and the first search before the session cookie exists', async () => {
    renderColdVisit();

    expect(await screen.findByRole('heading', { name: 'Synthetic Cold Visit Lab' })).toBeTruthy();
    expect(requestedEndpoints()).toEqual(['/check', '/research/search']);

    await act(async () => sessionCheck.answer());

    await waitFor(() => expect(requestedEndpoints()).toContain('/config'));
    expect(requestedEndpoints().filter((url) => url === '/config')).toHaveLength(1);
  });

  it('still loads config when the session check fails', async () => {
    renderColdVisit();
    await screen.findByRole('heading', { name: 'Synthetic Cold Visit Lab' });

    await act(async () => sessionCheck.fail());

    await waitFor(() => expect(requestedEndpoints()).toContain('/config'));
  });
});
