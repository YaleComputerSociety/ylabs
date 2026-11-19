import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import ProgramWatch from '../ProgramWatch';
import SavedResearchPlans from '../SavedResearchPlans';
import { DEFAULT_PLAN_LIST_VIEW, type PlanListView } from '../../../utils/dashboardPlanListView';
import { expectNoAxeViolations } from '../../../testUtils/axe';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../../utils/appDialogs', () => ({ showAlert: vi.fn(), confirmAction: vi.fn() }));

vi.mock('../../../utils/researchAnalytics', async () => ({
  ...(await vi.importActual<typeof import('../../../utils/researchAnalytics')>(
    '../../../utils/researchAnalytics',
  )),
  trackResearchEvent: vi.fn(),
  createResearchAnalyticsInteractionId: () => 'test-interaction',
}));

vi.mock('../shared/LoadingSpinner', () => ({ default: () => <div>Loading</div> }));

vi.mock('../ResearchHomeComparison', () => ({
  default: ({ entities }: { entities: Array<{ _id: string }> }) => (
    <div data-testid="comparison">comparing {entities.length}</div>
  ),
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

interface SyntheticPlan {
  slug: string;
  name: string;
  stage: string;
  createdAt?: string;
}

const RESEARCH_PLANS: SyntheticPlan[] = [
  { slug: 'alpha-lab', name: 'Alpha Lab', stage: 'CONTACTED', createdAt: '2026-01-10T00:00:00Z' },
  { slug: 'beta-lab', name: 'Beta Lab', stage: 'SAVED', createdAt: '2026-03-05T00:00:00Z' },
  { slug: 'gamma-lab', name: 'Gamma Lab', stage: 'APPLIED', createdAt: '2026-02-20T00:00:00Z' },
  { slug: 'delta-lab', name: 'Delta Lab', stage: 'EXPLORING' },
  { slug: 'epsilon-lab', name: 'Epsilon Lab', stage: 'CLOSED', createdAt: '2026-04-01T00:00:00Z' },
];

const withResearchPlans = (plans: SyntheticPlan[] = RESEARCH_PLANS) => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchEntityIds') {
      return Promise.resolve({ data: { savedResearchEntityIds: plans.map((plan) => plan.slug) } });
    }
    if (url === '/users/savedResearchEntities') {
      return Promise.resolve({
        data: {
          savedResearchEntities: plans.map((plan) => ({
            _id: `id-${plan.slug}`,
            slug: plan.slug,
            name: plan.name,
            kind: 'lab',
            departments: [],
          })),
        },
      });
    }
    if (url === '/users/savedResearchEntityPlans') {
      return Promise.resolve({
        data: {
          savedResearchEntityPlans: Object.fromEntries(
            plans.map((plan) => [
              `id-${plan.slug}`,
              { stage: plan.stage, createdAt: plan.createdAt, updatedAt: plan.createdAt },
            ]),
          ),
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
};

interface SyntheticProgram {
  id: string;
  title: string;
  stage: string;
  createdAt: string;
  deadline?: string;
}

const PROGRAMS: SyntheticProgram[] = [
  {
    id: 'p1',
    title: 'Sample Summer Grant',
    stage: 'APPLIED',
    createdAt: '2026-01-01T00:00:00Z',
    deadline: '2099-02-01T00:00:00.000Z',
  },
  {
    id: 'p2',
    title: 'Sample Travel Fellowship',
    stage: 'SAVED',
    createdAt: '2026-05-01T00:00:00Z',
    deadline: '2099-09-01T00:00:00.000Z',
  },
  {
    id: 'p3',
    title: 'Sample Thesis Award',
    stage: 'PREPARING',
    createdAt: '2026-03-01T00:00:00Z',
    deadline: '2099-04-01T00:00:00.000Z',
  },
];

const withPrograms = (programs: SyntheticProgram[] = PROGRAMS) => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/watchedProgramIds') {
      return Promise.resolve({
        data: { watchedProgramIds: programs.map((program) => program.id) },
      });
    }
    if (url === '/users/watchedPrograms') {
      return Promise.resolve({
        data: {
          watchedPrograms: programs.map((program) => ({
            _id: program.id,
            id: program.id,
            title: program.title,
            deadline: program.deadline,
            isAcceptingApplications: true,
          })),
        },
      });
    }
    if (url === '/users/watchedProgramPlans') {
      return Promise.resolve({
        data: {
          watchedProgramPlans: Object.fromEntries(
            programs.map((program) => [
              program.id,
              { stage: program.stage, createdAt: program.createdAt, updatedAt: program.createdAt },
            ]),
          ),
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
};

const StatefulResearch = ({ initial }: { initial: PlanListView }) => {
  const [view, setView] = useState(initial);
  return <SavedResearchPlans listView={view} onListViewChange={setView} />;
};

const StatefulPrograms = ({ initial }: { initial: PlanListView }) => {
  const [view, setView] = useState(initial);
  return <ProgramWatch listView={view} onListViewChange={setView} />;
};

const renderResearch = (initial: PlanListView = DEFAULT_PLAN_LIST_VIEW) =>
  render(
    <MemoryRouter>
      <StatefulResearch initial={initial} />
    </MemoryRouter>,
  );

const renderPrograms = (initial: PlanListView = DEFAULT_PLAN_LIST_VIEW) =>
  render(
    <MemoryRouter>
      <StatefulPrograms initial={initial} />
    </MemoryRouter>,
  );

const researchOrder = () =>
  screen
    .getAllByRole('link', { name: 'Open' })
    .map((link) => link.getAttribute('href')?.replace('/research/', ''));

const programOrder = () =>
  screen
    .getAllByRole('combobox', { name: /^Application stage for / })
    .map((select) => select.getAttribute('aria-label')?.replace('Application stage for ', ''));

const stageFilterGroup = () => screen.getByRole('group', { name: 'Show plans at' });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('saved research list view', () => {
  it('lists the most recently saved plan first by default, with undated plans last', async () => {
    withResearchPlans();
    renderResearch();

    await screen.findByText('Alpha Lab');
    expect(researchOrder()).toEqual([
      'epsilon-lab',
      'beta-lab',
      'gamma-lab',
      'alpha-lab',
      'delta-lab',
    ]);
    expect((screen.getByRole('combobox', { name: 'Sort by' }) as HTMLSelectElement).value).toBe(
      'recent',
    );
  });

  it('orders by stage when the student picks the stage sort', async () => {
    withResearchPlans();
    renderResearch();

    await screen.findByText('Alpha Lab');
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), {
      target: { value: 'stage' },
    });
    expect(researchOrder()).toEqual([
      'beta-lab',
      'delta-lab',
      'alpha-lab',
      'gamma-lab',
      'epsilon-lab',
    ]);
  });

  it('offers no deadline sort on saved research', async () => {
    withResearchPlans();
    renderResearch();

    await screen.findByText('Alpha Lab');
    const options = within(screen.getByRole('combobox', { name: 'Sort by' })).getAllByRole(
      'option',
    );
    expect(options.map((option) => option.textContent)).toEqual(['Recently saved', 'Stage']);
  });

  it('shows Contacted and Applied plans under the waiting to hear back preset, with counts', async () => {
    withResearchPlans();
    renderResearch();

    await screen.findByText('Alpha Lab');
    const group = stageFilterGroup();
    expect(within(group).getByRole('radio', { name: 'All (5)' })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: 'Contacted (1)' })).toBeTruthy();
    const waiting = within(group).getByRole('radio', { name: 'Waiting to hear back (2)' });

    fireEvent.click(waiting);
    expect((waiting as HTMLInputElement).checked).toBe(true);
    expect(researchOrder()).toEqual(['gamma-lab', 'alpha-lab']);
    const summary = screen.getByText('Showing 2 of 5 saved research plans: Waiting to hear back');
    expect(summary.getAttribute('role')).toBe('status');
    expect(summary.getAttribute('aria-live')).toBe('polite');
  });

  it('combines a single-stage filter with the stage sort', async () => {
    withResearchPlans([
      ...RESEARCH_PLANS,
      { slug: 'zeta-lab', name: 'Zeta Lab', stage: 'CONTACTED', createdAt: '2026-06-01T00:00:00Z' },
    ]);
    renderResearch({ stageFilter: 'CONTACTED', sort: 'stage' });

    await screen.findByText('Alpha Lab');
    expect(researchOrder()).toEqual(['alpha-lab', 'zeta-lab']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), {
      target: { value: 'recent' },
    });
    expect(researchOrder()).toEqual(['zeta-lab', 'alpha-lab']);
  });

  it('keeps a row on screen after its stage changes so focus has somewhere to stay', async () => {
    withResearchPlans();
    mockedAxios.put.mockResolvedValue({ data: { savedResearchEntityPlans: {} } });
    renderResearch({ stageFilter: 'CONTACTED', sort: 'recent' });

    await screen.findByText('Alpha Lab');
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Outreach stage for Alpha Lab' }), {
        target: { value: 'APPLIED' },
      });
    });
    expect(researchOrder()).toEqual(['alpha-lab']);
    expect(within(stageFilterGroup()).getByRole('radio', { name: 'Contacted (0)' })).toBeTruthy();
  });

  it('says so and offers Show all when a filter matches nothing', async () => {
    withResearchPlans();
    renderResearch({ stageFilter: 'PREPARING', sort: 'recent' });

    expect(
      await screen.findByRole('heading', { name: 'No saved research plans at Preparing' }),
    ).toBeTruthy();
    expect(screen.queryAllByRole('link', { name: 'Open' })).toHaveLength(0);
  });

  it('returns every plan and focus to the All option from Show all', async () => {
    withResearchPlans();
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    renderResearch({ stageFilter: 'PREPARING', sort: 'recent' });

    fireEvent.click(await screen.findByRole('button', { name: 'Show all' }));
    expect(researchOrder()).toHaveLength(5);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(stageFilterGroup()).getByRole('radio', { name: 'All (5)' }),
      ),
    );
    frame.mockRestore();
  });

  it('names the preset stages in its empty state', async () => {
    withResearchPlans(
      RESEARCH_PLANS.filter((plan) => !['CONTACTED', 'APPLIED'].includes(plan.stage)),
    );
    renderResearch({ stageFilter: 'waiting', sort: 'recent' });

    expect(
      await screen.findByRole('heading', { name: 'No saved research plans waiting to hear back' }),
    ).toBeTruthy();
    expect(screen.getByText(/Plans you move to Contacted or Applied show up here/)).toBeTruthy();
  });

  it('does not let a hidden row be newly selected to compare', async () => {
    withResearchPlans();
    renderResearch();

    await screen.findByText('Alpha Lab');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha Lab to compare' }));
    fireEvent.click(within(stageFilterGroup()).getByRole('radio', { name: 'Saved (1)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beta Lab to compare' }));

    expect(screen.getByText('2 selected to compare')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Select Alpha Lab to compare' })).toBeNull();
  });

  it('is free of serious accessibility violations with a filter applied and when empty', async () => {
    withResearchPlans();
    const { container, unmount } = renderResearch({ stageFilter: 'waiting', sort: 'stage' });
    await screen.findByText('Alpha Lab');
    await expectNoAxeViolations(container);
    unmount();

    withResearchPlans();
    const empty = renderResearch({ stageFilter: 'PREPARING', sort: 'recent' });
    await screen.findByRole('button', { name: 'Show all' });
    await expectNoAxeViolations(empty.container);
  });
});

describe('watched programs list view', () => {
  it('lists the most recently watched program first by default', async () => {
    withPrograms();
    renderPrograms();

    await screen.findByText('Sample Summer Grant');
    expect(programOrder()).toEqual([
      'Sample Travel Fellowship',
      'Sample Thesis Award',
      'Sample Summer Grant',
    ]);
  });

  it('puts the soonest deadline first under the deadline sort', async () => {
    withPrograms();
    renderPrograms({ stageFilter: 'all', sort: 'deadline' });

    await screen.findByText('Sample Summer Grant');
    expect(programOrder()).toEqual([
      'Sample Summer Grant',
      'Sample Thesis Award',
      'Sample Travel Fellowship',
    ]);
  });

  it('counts only Applied under waiting to hear back, and offers no Contacted stage', async () => {
    withPrograms();
    renderPrograms();

    await screen.findByText('Sample Summer Grant');
    const group = stageFilterGroup();
    expect(within(group).queryByRole('radio', { name: /^Contacted/ })).toBeNull();
    expect(within(group).getByRole('radio', { name: 'No longer applying (0)' })).toBeTruthy();
    fireEvent.click(within(group).getByRole('radio', { name: 'Waiting to hear back (1)' }));
    expect(programOrder()).toEqual(['Sample Summer Grant']);
  });

  it('shows the empty state for a stage with no programs', async () => {
    withPrograms();
    renderPrograms({ stageFilter: 'AWARDED', sort: 'recent' });

    expect(
      await screen.findByRole('heading', { name: 'No watched programs at Awarded' }),
    ).toBeTruthy();
  });
});
