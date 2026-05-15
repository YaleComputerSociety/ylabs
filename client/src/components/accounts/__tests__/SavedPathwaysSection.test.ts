import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PathwaySearchHit } from '../../../types/pathway';
import axios from '../../../utils/axios';
import SavedPathwaysSection, {
  deadlineReminderForPathway,
  defaultIntentForPathway,
  fundingCueForPathway,
  type FellowshipFundingMatch,
} from '../SavedPathwaysSection';
import {
  getLocalOnlySavedPathwayPlanIds,
  mergeSavedPathwayPlansForHydration,
  type PathwayPlan,
} from '../SavedPathwaysSection';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const plan = (overrides: Partial<PathwayPlan> = {}): PathwayPlan => ({
  intent: 'later',
  stage: 'saved',
  note: '',
  checklist: {},
  ...overrides,
});

const pathway = (overrides: Partial<PathwaySearchHit> = {}): PathwaySearchHit => ({
  _id: 'pathway-1',
  pathwayType: 'EXPLORATORY_CONTACT',
  status: 'PLAUSIBLE',
  evidenceStrength: 'INDIRECT',
  studentFacingLabel: 'Explore archival climate records',
  bestNextStepCategory: 'plan-outreach',
  sourceUrls: ['https://example.edu/pathway'],
  researchEntity: {
    _id: 'entity-1',
    slug: 'climate-archive',
    name: 'Climate Archive',
    displayName: 'Climate Archive',
    departments: ['History'],
    researchAreas: ['Environmental history'],
  },
  evidence: [
    {
      signalType: 'posted_opening',
      confidence: 'HIGH',
      sourceUrl: 'https://example.edu/evidence',
    },
  ],
  ...overrides,
});

const fellowshipMatch = (
  overrides: Partial<FellowshipFundingMatch> = {},
): FellowshipFundingMatch => ({
  fellowshipId: 'fellowship-1',
  pathwayId: 'pathway-1',
  title: 'Summer Research Grant',
  score: 0.8,
  strength: 'candidate',
  reasons: ['Similar topic'],
  caveats: [],
  sourceUrls: ['https://example.edu/fellowship'],
  deadline: '2026-05-08T00:00:00.000Z',
  applicationLink: 'https://example.edu/fellowship/apply',
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  mockedAxios.get.mockReset();
  mockedAxios.put.mockReset();
  mockedAxios.delete.mockReset();
  mockedAxios.put.mockResolvedValue({ data: {} });
  mockedAxios.delete.mockResolvedValue({ data: {} });
  Object.defineProperty(window.URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:saved-pathways'),
  });
  Object.defineProperty(window.URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saved pathway plan hydration helpers', () => {
  it('lets server plans win over local drafts when both exist', () => {
    expect(
      mergeSavedPathwayPlansForHydration(
        {
          shared: plan({ note: 'local draft' }),
          localOnly: plan({ intent: 'thesis' }),
        },
        {
          shared: plan({ note: 'server copy', stage: 'ready' }),
          serverOnly: plan({ intent: 'apply' }),
        },
      ),
    ).toEqual({
      shared: plan({ note: 'server copy', stage: 'ready' }),
      localOnly: plan({ intent: 'thesis' }),
      serverOnly: plan({ intent: 'apply' }),
    });
  });

  it('migrates only local plans for currently saved pathways', () => {
    expect(
      getLocalOnlySavedPathwayPlanIds(
        {
          localOnlySaved: plan(),
          localOnlyStale: plan(),
          alreadyOnServer: plan(),
        },
        {
          alreadyOnServer: plan({ stage: 'researching' }),
        },
        ['localOnlySaved', 'alreadyOnServer'],
      ),
    ).toEqual(['localOnlySaved']);
  });
});

describe('saved pathway planning helpers', () => {
  it('maps pathway next steps into thesis and outreach planning defaults', () => {
    expect(defaultIntentForPathway(pathway({ bestNextStepCategory: 'save-for-thesis' }))).toBe(
      'thesis',
    );
    expect(defaultIntentForPathway(pathway({ bestNextStepCategory: 'contact-program' }))).toBe(
      'outreach',
    );
  });

  it('builds funding cues for saved pathway and fellowship bundles', () => {
    expect(
      fundingCueForPathway(pathway({ bestNextStepCategory: 'find-funding' }), plan()),
    ).toMatchObject({
      label: 'Funding likely matters',
      confidence: 'possible',
    });
    expect(
      fundingCueForPathway(pathway({ pathwayType: 'POSTED_ROLE' }), plan({ intent: 'thesis' })),
    ).toBeNull();
  });

  it('chooses the closest future posted-opportunity or fellowship deadline', () => {
    const result = deadlineReminderForPathway(
      pathway({
        activePostedOpportunity: {
          _id: 'posted-1',
          title: 'Archive assistant',
          deadline: '2026-05-20T00:00:00.000Z',
          applicationUrl: 'https://example.edu/apply',
          status: 'OPEN',
        },
      }),
      [fellowshipMatch()],
      new Date('2026-05-01T12:00:00.000Z'),
    );

    expect(result).toMatchObject({
      kind: 'fellowship',
      label: 'Fellowship deadline',
      title: 'Summer Research Grant',
      date: '2026-05-08T00:00:00.000Z',
      urgency: 'soon',
      sourceUrl: 'https://example.edu/fellowship/apply',
    });
  });
});

describe('SavedPathwaysSection advising export', () => {
  it('requires an explicit opt-in before private notes are requested for export', async () => {
    const user = userEvent.setup();

    mockedAxios.get.mockImplementation((url, config) => {
      if (url === '/users/favPathways') {
        return Promise.resolve({ data: { favPathways: [pathway()] } });
      }
      if (url === '/users/favPathwayPlans') {
        return Promise.resolve({
          data: {
            savedPathwayPlans: {
              'pathway-1': plan({
                intent: 'outreach',
                note: 'Discuss with my advisor.',
              }),
            },
          },
        });
      }
      if (url === '/users/favPathwayFundingMatches') {
        return Promise.resolve({ data: { matchesByPathwayId: {} } });
      }
      if (url === '/users/favPathwayPlans/export') {
        return Promise.resolve({
          data: {
            privacy: {
              includesPrivateNotes: config?.params?.includePrivateNotes === 'true',
            },
            items: [],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(createElement(MemoryRouter, null, createElement(SavedPathwaysSection)));

    await screen.findByText('Explore archival climate records');

    await user.click(screen.getByLabelText('Include private notes'));
    await user.click(screen.getByRole('button', { name: 'Export for advising' }));

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/users/favPathwayPlans/export',
        expect.objectContaining({
          withCredentials: true,
          params: { includePrivateNotes: 'true' },
        }),
      );
    });
  });
});
