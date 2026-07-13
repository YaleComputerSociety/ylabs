import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PathwaySearchHit } from '../../../types/pathway';
import axios from '../../../utils/axios';
import SavedPathwaysSection, {
  MAX_PLAN_STORAGE_VALUE_LENGTH,
  PLAN_STORAGE_KEY,
  deadlineReminderForPathway,
  defaultIntentForPathway,
  fundingCueForPathway,
  readStoredPlans,
  type FellowshipFundingMatch,
  writeStoredPlans,
} from '../SavedPathwaysSection';
import {
  filterStoredPlansForSavedPathways,
  getLocalOnlySavedPathwayPlanIds,
  mergeSavedPathwayPlansForHydration,
  type PathwayPlan,
} from '../SavedPathwaysSection';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const plan = (overrides: Partial<PathwayPlan> = {}): PathwayPlan => ({
  intent: 'later',
  stage: 'saved',
  note: '',
  checklist: {},
  checklistHistory: [],
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
  mockedAxios.post.mockReset();
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
  cleanup();
  vi.restoreAllMocks();
});

describe('saved research plan hydration helpers', () => {
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

  it('normalizes untrusted local saved-plan payloads before hydration merge', () => {
    const oversizedNote = 'a'.repeat(2500);
    const unsafeLocalPlans = {
      valid_plan: {
        intent: 'funding',
        stage: 'ready',
        note: oversizedNote,
        checklist: {
          safe_key: true,
          unchecked_key: false,
          $unsafe: true,
        },
      },
      '../bad': plan({ note: 'should be dropped' }),
    } as unknown as Record<string, PathwayPlan>;

    const merged = mergeSavedPathwayPlansForHydration(unsafeLocalPlans, {});

    expect(Object.keys(merged)).toEqual(['valid_plan']);
    expect(merged.valid_plan.note).toHaveLength(2000);
    expect(merged.valid_plan.checklist).toEqual({ safe_key: true });
  });

  it('drops oversized local saved-plan payloads before parsing', () => {
    localStorage.setItem(PLAN_STORAGE_KEY, 'x'.repeat(MAX_PLAN_STORAGE_VALUE_LENGTH + 1));

    expect(readStoredPlans()).toEqual({});
    expect(localStorage.getItem(PLAN_STORAGE_KEY)).toBeNull();
  });

  it('drops malformed local saved-plan payloads after parse failure', () => {
    localStorage.setItem(PLAN_STORAGE_KEY, 'not json');

    expect(readStoredPlans()).toEqual({});
    expect(localStorage.getItem(PLAN_STORAGE_KEY)).toBeNull();
  });

  it('does not persist private saved-plan notes or checklist state to localStorage', () => {
    writeStoredPlans(
      {
        valid_plan: plan({
          intent: 'outreach',
          stage: 'ready',
          note: 'Private advising note',
          checklist: { outreach_question: true },
        }),
      },
      'avery1',
    );

    expect(JSON.parse(localStorage.getItem(`${PLAN_STORAGE_KEY}.avery1`) || '{}')).toEqual({
      valid_plan: plan({
        intent: 'outreach',
        stage: 'ready',
        note: '',
        checklist: {},
      }),
    });
  });

  it('migrates only local plans for currently saved research plans', () => {
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

  it('filters local saved-plan drafts to pathways saved by the current account', () => {
    expect(
      filterStoredPlansForSavedPathways(
        {
          currentUserPathway: plan({ note: 'current account draft' }),
          previousUserPathway: plan({ note: 'previous account draft' }),
        },
        ['currentUserPathway'],
      ),
    ).toEqual({
      currentUserPathway: plan({ note: 'current account draft' }),
    });
  });
});

describe('saved research planning helpers', () => {
  it('maps pathway next steps into thesis and outreach planning defaults', () => {
    expect(defaultIntentForPathway(pathway({ bestNextStepCategory: 'save-for-thesis' }))).toBe(
      'thesis',
    );
    expect(defaultIntentForPathway(pathway({ bestNextStepCategory: 'contact-program' }))).toBe(
      'outreach',
    );
  });

  it('builds funding cues for saved research plans and program bundles', () => {
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

  it('does not promote expired weak fellowship candidates into next-up reminders', () => {
    const result = deadlineReminderForPathway(
      pathway(),
      [
        fellowshipMatch({
          title: 'Expired Weak Award',
          strength: 'weak_candidate',
          deadline: '2026-02-12T00:00:00.000Z',
        }),
      ],
      new Date('2026-05-01T12:00:00.000Z'),
    );

    expect(result).toBeNull();
  });
});

describe('SavedPathwaysSection advising export', () => {
  const mockSavedPlanLoad = (savedPlan: PathwayPlan) => {
    mockedAxios.get.mockImplementation((url) => {
      if (url === '/users/savedResearchPlans') {
        return Promise.resolve({ data: { savedResearchPlans: [pathway()] } });
      }
      if (url === '/users/savedResearchPlanDetails') {
        return Promise.resolve({
          data: { savedResearchPlanDetails: { 'pathway-1': savedPlan } },
        });
      }
      if (url === '/users/savedResearchPlanFundingMatches') {
        return Promise.resolve({ data: { matchesByPathwayId: {} } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
  };

  it('preserves hydrated intent and stage on the first checklist interaction', async () => {
    const user = userEvent.setup();
    mockSavedPlanLoad(plan({ intent: 'outreach', stage: 'ready' }));

    render(createElement(MemoryRouter, null, createElement(SavedPathwaysSection)));
    await user.click(await screen.findByRole('button', { name: 'Plan details' }));
    await user.click(screen.getByLabelText('Review the official contact route or policy'));

    await waitFor(() => expect(mockedAxios.put).toHaveBeenCalledTimes(1));
    expect(mockedAxios.put.mock.calls[0][1]).toEqual({
      data: {
        plan: plan({
          intent: 'outreach',
          stage: 'ready',
          checklist: { 'outreach-route': true },
        }),
      },
    });
    expect(screen.getByText('Checklist for: Outreach')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Plan saved.');
  });

  it('never PUTs fallback plan state when plan hydration fails', async () => {
    const user = userEvent.setup();
    mockedAxios.get.mockImplementation((url) => {
      if (url === '/users/savedResearchPlans') {
        return Promise.resolve({ data: { savedResearchPlans: [pathway()] } });
      }
      if (url === '/users/savedResearchPlanDetails') return Promise.reject(new Error('offline'));
      if (url === '/users/savedResearchPlanFundingMatches') {
        return Promise.resolve({ data: { matchesByPathwayId: {} } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(createElement(MemoryRouter, null, createElement(SavedPathwaysSection)));
    await user.click(await screen.findByRole('button', { name: 'Plan details' }));

    expect(screen.getByLabelText('Intent')).toBeDisabled();
    expect(screen.getByLabelText('Review the official contact route or policy')).toBeDisabled();
    expect(screen.getByRole('status').textContent).toBe('Plan details are loading.');
    expect(mockedAxios.put).not.toHaveBeenCalled();
  });

  it('requires confirmation before replacing progress and cancel preserves state and focus', async () => {
    const user = userEvent.setup();
    mockSavedPlanLoad(plan({ intent: 'outreach', checklist: { 'outreach-route': true } }));

    render(createElement(MemoryRouter, null, createElement(SavedPathwaysSection)));
    await user.click(await screen.findByRole('button', { name: 'Plan details' }));
    const intent = screen.getByLabelText('Intent');
    await user.selectOptions(intent, 'credit');

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/1 completed step will move to completed step history/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update checklist' })).toHaveFocus();
    expect(mockedAxios.put).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(intent).toHaveFocus());
    expect(intent).toHaveValue('outreach');
    expect(screen.getByLabelText('Review the official contact route or policy')).toBeChecked();
    expect(mockedAxios.put).not.toHaveBeenCalled();
  });

  it('archives completed labels once when an intent change is confirmed', async () => {
    const user = userEvent.setup();
    mockSavedPlanLoad(
      plan({ intent: 'outreach', stage: 'researching', checklist: { 'outreach-route': true } }),
    );

    render(createElement(MemoryRouter, null, createElement(SavedPathwaysSection)));
    await user.click(await screen.findByRole('button', { name: 'Plan details' }));
    const intent = screen.getByLabelText('Intent');
    await user.selectOptions(intent, 'credit');
    await user.click(screen.getByRole('button', { name: 'Update checklist' }));

    await waitFor(() => expect(mockedAxios.put).toHaveBeenCalledTimes(1));
    const savedPlan = mockedAxios.put.mock.calls[0][1].data.plan as PathwayPlan;
    expect(savedPlan.intent).toBe('credit');
    expect(savedPlan.stage).toBe('researching');
    expect(savedPlan.checklist).toEqual({});
    expect(savedPlan.checklistHistory).toEqual([
      expect.objectContaining({
        intent: 'outreach',
        label: 'Review the official contact route or policy',
      }),
    ]);
    expect(screen.getByText('Completed step history (1)')).toBeTruthy();
    await waitFor(() => expect(intent).toHaveFocus());

    await user.selectOptions(intent, 'funding');
    await waitFor(() => expect(mockedAxios.put).toHaveBeenCalledTimes(2));
    expect(mockedAxios.put.mock.calls[1][1].data.plan.checklistHistory).toHaveLength(1);
  });

  it('keeps detailed planning controls collapsed until a saved plan is expanded', async () => {
    const user = userEvent.setup();

    mockedAxios.get.mockImplementation((url) => {
      if (url === '/users/savedResearchPlans') {
        return Promise.resolve({ data: { savedResearchPlans: [pathway()] } });
      }
      if (url === '/users/savedResearchPlanDetails') {
        return Promise.resolve({
          data: {
            savedResearchPlanDetails: {
              'pathway-1': plan({ intent: 'outreach', stage: 'researching' }),
            },
          },
        });
      }
      if (url === '/users/savedResearchPlanFundingMatches') {
        return Promise.resolve({
          data: {
            matchesByPathwayId: {
              'pathway-1': [fellowshipMatch({
                reasons: ['The award timing aligns with an academic-year or thesis plan.'],
                caveats: ['The listed years do not include your current senior standing.'],
              })],
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(createElement(MemoryRouter, null, createElement(SavedPathwaysSection)));

    await screen.findByText('Explore archival climate records');

    expect(screen.getByRole('link', { name: 'Open profile' }).getAttribute('href')).toBe(
      '/research/climate-archive',
    );
    expect(screen.getByRole('button', { name: 'Plan details' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open profile' }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'Plan details' }).className).toContain(
      'min-h-[44px]',
    );
    expect(screen.getByRole('button', { name: 'Remove' }).className).toContain('min-h-[44px]');
    expect(screen.getByText('Researching')).toBeTruthy();
    expect(screen.queryByLabelText('Note')).toBeNull();
    expect(screen.queryByText('Checklist')).toBeNull();
    expect(screen.queryByText('Fellowship candidates')).toBeNull();
    expect(screen.queryByText('Source 1')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Plan details' }));

    expect(screen.getByLabelText('Note')).toBeTruthy();
    expect(screen.getByText('Checklist for: Outreach')).toBeTruthy();
    expect(screen.getByText('Fellowship candidates')).toBeTruthy();
    expect(screen.getByText('Source 1')).toBeTruthy();
    expect(screen.getByText('The award timing aligns with an academic-year or thesis plan.')).toBeTruthy();
    expect(screen.getByText('Caveat: The listed years do not include your current senior standing.')).toBeTruthy();
  });

  it('reports saved research plan count and next deadline summary', async () => {
    const onSummaryChange = vi.fn();

    mockedAxios.get.mockImplementation((url) => {
      if (url === '/users/savedResearchPlans') {
        return Promise.resolve({
          data: {
            savedResearchPlans: [
              pathway({
                activePostedOpportunity: {
                  _id: 'posted-1',
                  title: 'Archive assistant',
                  deadline: '2099-05-20T00:00:00.000Z',
                  applicationUrl: 'https://example.edu/apply',
                  status: 'OPEN',
                },
              }),
            ],
          },
        });
      }
      if (url === '/users/savedResearchPlanDetails') {
        return Promise.resolve({ data: { savedResearchPlanDetails: {} } });
      }
      if (url === '/users/savedResearchPlanFundingMatches') {
        return Promise.resolve({ data: { matchesByPathwayId: {} } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(
      createElement(MemoryRouter, null, createElement(SavedPathwaysSection, { onSummaryChange })),
    );

    await screen.findByText('Explore archival climate records');

    await waitFor(() => {
      expect(onSummaryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 1,
          nextDeadlineLabel: expect.stringContaining('Archive assistant'),
        }),
      );
    });
  });

  it('requires finalist selection and keeps each note private by default', async () => {
    const user = userEvent.setup();

    mockedAxios.get.mockImplementation((url) => {
      if (url === '/users/savedResearchPlans') {
        return Promise.resolve({ data: { savedResearchPlans: [pathway()] } });
      }
      if (url === '/users/savedResearchPlanDetails') {
        return Promise.resolve({
          data: {
            savedResearchPlanDetails: {
              'pathway-1': plan({
                intent: 'outreach',
                note: 'Discuss with my advisor.',
              }),
            },
          },
        });
      }
      if (url === '/users/savedResearchPlanFundingMatches') {
        return Promise.resolve({ data: { matchesByPathwayId: {} } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(createElement(MemoryRouter, null, createElement(SavedPathwaysSection)));

    await screen.findByText('Explore archival climate records');
    await user.click(screen.getByRole('button', { name: 'Advising export' }));
    expect(screen.getByText('0 of 1 finalists selected')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Preview advising export' }));
    expect(screen.getByText('Select at least one finalist to preview.')).toBeTruthy();
    await user.click(screen.getByLabelText('Explore archival climate records'));
    await user.click(screen.getByRole('button', { name: 'Preview advising export' }));
    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(screen.queryByText('Discuss with my advisor.')).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('previews translated labels, unknown professor, opted-in note, and prints', async () => {
    const user = userEvent.setup();
    let exportedBlob: Blob | null = null;
    vi.mocked(window.URL.createObjectURL).mockImplementation((blob) => {
      exportedBlob = blob as Blob;
      return 'blob:saved-pathways';
    });

    mockedAxios.get.mockImplementation((url) => {
      if (url === '/users/savedResearchPlans') {
        return Promise.resolve({ data: { savedResearchPlans: [pathway()] } });
      }
      if (url === '/users/savedResearchPlanDetails')
        return Promise.resolve({
          data: {
            savedResearchPlanDetails: {
              'pathway-1': plan({
                intent: 'outreach',
                stage: 'ready',
                note: 'Advisor-only context',
                checklist: { 'outreach-route': true },
              }),
            },
          },
        });
      if (url === '/users/savedResearchPlanFundingMatches') {
        return Promise.resolve({ data: { matchesByPathwayId: {} } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(createElement(MemoryRouter, null, createElement(SavedPathwaysSection)));

    await screen.findByText('Explore archival climate records');
    await user.click(screen.getByRole('button', { name: 'Advising export' }));
    await user.click(screen.getByLabelText('Explore archival climate records'));
    await user.click(screen.getByLabelText('Include this plan note'));
    await user.click(screen.getByRole('button', { name: 'Preview advising export' }));
    const preview = screen.getByTestId('advising-export-preview');
    expect(preview.textContent).toContain('Lead professor unavailable');
    expect(preview.textContent).toContain('Ready to act');
    expect(preview.textContent).toContain('Review the official contact route or policy');
    expect(preview.textContent).toContain('Advisor-only context');
    await user.click(screen.getByRole('button', { name: 'Print or save PDF' }));
    expect(print).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Download Markdown' }));

    await waitFor(() => expect(exportedBlob).not.toBeNull());
    const text = await exportedBlob!.text();
    expect(text).toContain('# Saved Research Plans');
    expect(text).toContain('## 1. Explore archival climate records');
    expect(text).toContain('Research home: Climate Archive');
    expect(text).toContain('- https://example.edu/pathway');
    expect(text.trim()).not.toMatch(/^{/);
  });
});
