import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import { Fellowship, ProgramCitizenshipCounts } from '../../types/types';
import type { FellowshipQuickFilter } from '../../reducers/fellowshipSearchReducer';
import Fellowships from '../fellowships';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { favFellowshipIds: [] } })),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../components/shared/BrowseGrid', () => ({
  default: ({ items }: any) => (
    <div data-testid="browse-grid">
      {items.map((item: any) => (
        <article key={item.data.id}>{item.data.title}</article>
      ))}
    </div>
  ),
}));

vi.mock('../../components/fellowship/FellowshipModal', () => ({
  default: () => null,
}));

vi.mock('../../components/admin/AdminFellowshipEditModal', () => ({
  default: () => null,
}));

const futureDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const pastDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

const makeFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f-1',
  programCategory: '',
  programKind: '',
  entryMode: '',
  studentFacingCategory: '',
  requiresMentorBeforeApply: false,
  mentorMatching: false,
  undergraduateOnly: true,
  audience: 'UNDERGRADUATE',
  yaleCollegeOnly: true,
  compensationSummary: '',
  hoursPerWeek: null,
  programDates: '',
  bestNextStep: '',
  prepSteps: [],
  sourceName: '',
  sourceUrl: '',
  sourceKey: '',
  sourceFingerprint: '',
  sourceLastVerifiedAt: null,
  sourceLastChangedAt: null,
  title: 'Fellowship',
  competitionType: '',
  summary: '',
  description: '',
  applicationInformation: '',
  eligibility: 'Open to Yale College students.',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [],
  applicationLink: '',
  awardAmount: '',
  isAcceptingApplications: true,
  applicationOpenDate: null,
  deadline: futureDate(90),
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: ['Junior'],
  termOfAward: [],
  purpose: [],
  globalRegions: [],
  citizenshipStatus: [],
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: futureDate(0),
  createdAt: pastDate(10),
  ...overrides,
});

const US = 'U.S. citizens are eligible';
const NON_US = 'Non-U.S. citizens are eligible';

const renderFellowships = ({
  fellowships,
  selectedCitizenship = [NON_US],
  citizenshipCounts = null,
  resultsRankedByRelevance = false,
  quickFilter = null,
}: {
  fellowships: Fellowship[];
  quickFilter?: FellowshipQuickFilter;
  selectedCitizenship?: string[];
  citizenshipCounts?: ProgramCitizenshipCounts | null;
  resultsRankedByRelevance?: boolean;
}) =>
  render(
    <MemoryRouter>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: { userType: 'student' } as any,
          checkContext: vi.fn(),
        }}
      >
        <FellowshipSearchContext.Provider
          value={{
            ...defaultFellowshipSearchContext,
            fellowships,
            total: fellowships.length,
            searchExhausted: true,
            selectedCitizenship,
            citizenshipCounts,
            resultsRankedByRelevance,
            quickFilter,
            filterOptions: {
              ...defaultFellowshipSearchContext.filterOptions,
              citizenshipStatus: [NON_US, US],
            },
            setQueryString: vi.fn(),
            refreshFellowships: vi.fn(),
          }}
        >
          <Fellowships />
        </FellowshipSearchContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

const saysOpen = (id: string, deadlineDays: number) =>
  makeFellowship({
    id,
    title: `Says Open ${id}`,
    programKind: 'FELLOWSHIP_FUNDING',
    citizenshipStatus: [US, NON_US],
    deadline: futureDate(deadlineDays),
  });

const doesntSay = (id: string, deadlineDays: number) =>
  makeFellowship({
    id,
    title: `Doesnt Say ${id}`,
    programKind: 'FELLOWSHIP_FUNDING',
    citizenshipStatus: [],
    deadline: futureDate(deadlineDays),
  });

const MIXED = [doesntSay('d1', 5), saysOpen('s1', 60), doesntSay('d2', 60), saysOpen('s2', 6)];

const DOESNT_SAY_REGION = /^Doesn't say/;

const articleTitles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('article')).map((article) => article.textContent);

describe('Fellowships citizenship split (#5299)', () => {
  afterEach(() => {
    cleanup();
  });

  it("lists every program that states its rule before the doesn't-say divider", () => {
    const { container } = renderFellowships({ fellowships: MIXED });

    const titles = articleTitles(container);
    const firstDoesntSay = titles.findIndex((title) => title?.startsWith('Doesnt Say'));
    expect(titles.slice(0, firstDoesntSay).every((title) => title?.startsWith('Says Open'))).toBe(
      true,
    );
    expect(titles.slice(firstDoesntSay).every((title) => title?.startsWith('Doesnt Say'))).toBe(
      true,
    );

    const divider = screen.getByRole('region', { name: DOESNT_SAY_REGION });
    expect(
      within(divider)
        .getAllByRole('article')
        .map((card) => card.textContent),
    ).toEqual(['Doesnt Say d1', 'Doesnt Say d2']);
    expect(divider.textContent).toContain(
      'These programs do not say whether non-U.S. citizens can apply. Check the official page before you apply.',
    );
  });

  it('announces the divider count as programs and keeps the divider out of the tab order', () => {
    renderFellowships({ fellowships: MIXED });

    const heading = screen.getByRole('heading', { level: 2, name: "Doesn't say, 2 programs" });
    expect(heading.hasAttribute('tabindex')).toBe(false);
    const dividerBand = heading.closest('div.rounded-card') as HTMLElement;
    expect(dividerBand.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
    const pill = Array.from(dividerBand.querySelectorAll('span')).find(
      (span) => span.textContent === '2',
    );
    expect(pill?.getAttribute('aria-hidden')).toBe('true');
  });

  it('nests the timing sections under the divider one heading level down', () => {
    renderFellowships({ fellowships: MIXED });

    const divider = screen.getByRole('region', { name: DOESNT_SAY_REGION });
    const inner = within(divider).getAllByRole('heading', { level: 3 });
    expect(inner.map((heading) => heading.textContent)).toEqual([
      'Due in the next 2 weeks',
      'Accepting applications',
    ]);
    const ids = Array.from(document.querySelectorAll('h2[id], h3[id]')).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders the same split the server counted', () => {
    const { container } = renderFellowships({
      fellowships: MIXED,
      citizenshipCounts: {
        options: [{ value: NON_US, says: 2, doesntSay: 2 }],
      },
    });

    const divider = screen.getByRole('region', { name: DOESNT_SAY_REGION });
    const doesntSayRendered = within(divider).getAllByRole('article').length;
    expect(doesntSayRendered).toBe(2);
    expect(articleTitles(container).length - doesntSayRendered).toBe(2);
  });

  it('shows no divider when every program states its rule, or when no citizenship is chosen', () => {
    renderFellowships({ fellowships: [saysOpen('s1', 60), saysOpen('s2', 6)] });
    expect(screen.queryByRole('region', { name: DOESNT_SAY_REGION })).toBeNull();
    cleanup();

    renderFellowships({ fellowships: MIXED, selectedCitizenship: [] });
    expect(screen.queryByRole('region', { name: DOESNT_SAY_REGION })).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('says so when no program states it is open, and still lists the ones that do not say', () => {
    renderFellowships({ fellowships: [doesntSay('d1', 5), doesntSay('d2', 60)] });

    expect(screen.getByText('No program here says it is open to non-U.S. citizens.')).toBeTruthy();
    const divider = screen.getByRole('region', { name: DOESNT_SAY_REGION });
    expect(within(divider).getAllByRole('article')).toHaveLength(2);
  });

  it('names every chosen citizenship in the divider', () => {
    renderFellowships({ fellowships: MIXED, selectedCitizenship: [US, NON_US] });

    expect(screen.getByRole('region', { name: DOESNT_SAY_REGION }).textContent).toContain(
      'do not say whether U.S. citizens or non-U.S. citizens can apply',
    );
  });

  it('splits ranked search results the same way, keeping their order', () => {
    renderFellowships({
      fellowships: [saysOpen('s1', 60), doesntSay('d1', 5), saysOpen('s2', 6)],
      resultsRankedByRelevance: true,
    });

    expect(
      within(screen.getAllByRole('region', { name: 'Best matches' })[0])
        .getAllByRole('article')
        .map((card) => card.textContent),
    ).toEqual(['Says Open s1', 'Says Open s2']);
    const divider = screen.getByRole('region', { name: DOESNT_SAY_REGION });
    expect(within(divider).getByRole('heading', { level: 3 }).textContent).toBe('Best matches');
  });

  it("shows each option's says-open and doesn't-say counts in the citizenship filter", async () => {
    renderFellowships({
      fellowships: MIXED,
      selectedCitizenship: [],
      citizenshipCounts: {
        options: [
          { value: NON_US, says: 126, doesntSay: 38 },
          { value: US, says: 1, doesntSay: 1 },
        ],
      },
    });

    await userEvent.click(screen.getByRole('button', { name: /filters/i }));
    const dialog = screen.getByRole('dialog', { name: 'Program filters' });
    await userEvent.click(within(dialog).getByRole('button', { name: /citizenship/i }));

    const nonUs = within(dialog).getByRole('checkbox', {
      name: 'Open to non-U.S. citizens, or not stated',
    });
    expect(nonUs.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(nonUs.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      "126 say they are open, 38 don't say",
    );
    const us = within(dialog).getByRole('checkbox', {
      name: 'Open to U.S. citizens, or not stated',
    });
    expect(document.getElementById(us.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      "1 says it is open, 1 doesn't say",
    );
    expect(dialog.textContent).toContain(
      'Programs that do not state this are included, listed after the ones that do.',
    );
  });

  it('leaves the option counts out until the server has counted them', async () => {
    renderFellowships({ fellowships: MIXED, selectedCitizenship: [] });

    await userEvent.click(screen.getByRole('button', { name: /filters/i }));
    const dialog = screen.getByRole('dialog', { name: 'Program filters' });
    await userEvent.click(within(dialog).getByRole('button', { name: /citizenship/i }));

    const nonUs = within(dialog).getByRole('checkbox', {
      name: 'Open to non-U.S. citizens, or not stated',
    });
    expect(nonUs.hasAttribute('aria-describedby')).toBe(false);
    expect(dialog.textContent).not.toMatch(/say they are open/);
  });

  it('leaves the option counts out while a quick filter narrows the list past what they count', async () => {
    renderFellowships({
      fellowships: MIXED,
      selectedCitizenship: [],
      quickFilter: 'closingSoon',
      citizenshipCounts: { options: [{ value: NON_US, says: 126, doesntSay: 38 }] },
    });

    await userEvent.click(screen.getByRole('button', { name: /filters/i }));
    const dialog = screen.getByRole('dialog', { name: 'Program filters' });
    await userEvent.click(within(dialog).getByRole('button', { name: /citizenship/i }));

    const nonUs = within(dialog).getByRole('checkbox', {
      name: 'Open to non-U.S. citizens, or not stated',
    });
    expect(nonUs.hasAttribute('aria-describedby')).toBe(false);
    expect(dialog.textContent).not.toMatch(/say they are open/);
  });
});
