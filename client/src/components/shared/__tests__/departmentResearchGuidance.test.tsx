import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BrowseCard from '../BrowseCard';
import BrowseListItem from '../BrowseListItem';
import FellowshipModal from '../../fellowship/FellowshipModal';
import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../../contexts/FellowshipSearchContext';
import UserContext, { defaultUserContext } from '../../../contexts/UserContext';
import type { BrowsableItem } from '../../../types/browsable';
import { createFellowship } from '../../../utils/createFellowship';
import { programBoardSectionOf } from '../../../utils/programBoard';

vi.mock('../../../utils/axios', () => ({
  default: { put: vi.fn(() => Promise.resolve({ data: {} })) },
}));

vi.mock('../../../utils/researchAnalytics', async () => ({
  ...(await vi.importActual<typeof import('../../../utils/researchAnalytics')>(
    '../../../utils/researchAnalytics',
  )),
  trackResearchEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const GUIDANCE_PAGE = 'https://fixture.yale.edu/undergraduate/undergraduate-research';

const guidance = createFellowship({
  _id: 'synthetic-guidance',
  title: 'Fixture Studies Undergraduate Research',
  programKind: 'DEPARTMENT_RESEARCH_GUIDE',
  programRole: 'STARTS_RESEARCH',
  entryMode: 'CONTACT_FACULTY',
  studentFacingCategory: 'Department research guidance',
  summary: 'How undergraduates find a faculty mentor in this department.',
  bestNextStep: "Use the department's guide to find faculty whose research fits your interests.",
  sourceUrl: GUIDANCE_PAGE,
  applicationLink: GUIDANCE_PAGE,
  isAcceptingApplications: false,
  deadline: null,
  applicationOpenDate: null,
});

const item: BrowsableItem = { type: 'fellowship', data: guidance };

const APPLICATION_AFFORDANCE =
  /\bapply\b|apply now|open now|accepting applications|closing soon|opens soon|no dates posted|\bdue\b|days left|deadline passed|no deadline|\bclosed\b/i;

const withContexts = (children: ReactNode) =>
  render(
    <MemoryRouter>
      <UserContext.Provider value={{ ...defaultUserContext, isLoading: false }}>
        <ConfigContext.Provider value={defaultConfigContext}>
          <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
            {children}
          </FellowshipSearchContext.Provider>
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

const expectGuidanceAction = (link: HTMLElement) => {
  expect(link.getAttribute('href')).toBe(GUIDANCE_PAGE);
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toContain('noopener');
};

describe('department research guidance (#4285)', () => {
  it('renders a browse card with no application affordance and a guidance action', () => {
    const onOpenModal = vi.fn();
    const { container } = withContexts(
      <BrowseCard
        item={item}
        isFavorite={false}
        onOpenModal={onOpenModal}
        onToggleFavorite={vi.fn()}
      />,
    );

    expect(screen.getByText('Department guidance')).toBeTruthy();
    expect(screen.getByText('Not an application')).toBeTruthy();
    expect(container.textContent).not.toMatch(APPLICATION_AFFORDANCE);
    expect(screen.queryByRole('button', { name: 'View details' })).toBeNull();

    const action = screen.getByRole('link', { name: "Read the department's guidance" });
    expectGuidanceAction(action);
    expect(action.className).toContain('after:inset-0');
    expect(action.className).toContain('min-h-11');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'View details for Fixture Studies Undergraduate Research',
      }),
    );
    expect(onOpenModal).toHaveBeenCalledTimes(1);
  });

  it('renders a list row, as the watched-program view does, with no application affordance', () => {
    const { container } = withContexts(
      <BrowseListItem item={item} isFavorite onOpenModal={vi.fn()} onToggleFavorite={vi.fn()} />,
    );

    expect(screen.getByText('Department guidance')).toBeTruthy();
    expect(container.textContent).not.toMatch(APPLICATION_AFFORDANCE);
    const action = screen.getByRole('link', { name: "Read the department's guidance" });
    expectGuidanceAction(action);
    expect(action.className).toContain('min-h-11');
    expect(action.className).toContain('z-[1]');
  });

  it('renders the detail modal with no dates, no application process and no apply action', () => {
    withContexts(
      <FellowshipModal
        fellowship={guidance}
        isOpen
        onClose={vi.fn()}
        isFavorite={false}
        toggleFavorite={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toMatch(APPLICATION_AFFORDANCE);
    expect(within(dialog).queryByText('Key Dates')).toBeNull();
    expect(within(dialog).queryByText('Application Process')).toBeNull();
    expect(within(dialog).queryByText('Eligibility Filters')).toBeNull();
    expect(within(dialog).queryByText(/Do you need a mentor first/)).toBeNull();
    const actions = within(dialog).getAllByRole('link', {
      name: "Read the department's guidance",
    });
    expect(actions.length).toBeGreaterThan(0);
    actions.forEach(expectGuidanceAction);
  });

  it('keeps an application program on its application affordances', () => {
    const application = createFellowship({
      ...guidance,
      _id: 'synthetic-application',
      programKind: 'MENTOR_MATCHING',
      deadline: '2999-06-01T00:00:00.000Z',
      isAcceptingApplications: true,
    });
    withContexts(
      <BrowseCard
        item={{ type: 'fellowship', data: application }}
        isFavorite={false}
        onOpenModal={vi.fn()}
      />,
    );

    expect(screen.getByText(/^Due /)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View details' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: "Read the department's guidance" })).toBeNull();
  });

  it('files guidance in its own board section rather than among undated programs', () => {
    expect(programBoardSectionOf(guidance, 'closed')).toBe('guidance');
  });
});
