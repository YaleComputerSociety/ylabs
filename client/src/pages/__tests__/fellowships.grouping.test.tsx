import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import { Fellowship } from '../../types/types';
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

const renderFellowships = ({
  fellowships,
  quickFilter = null,
}: {
  fellowships: Fellowship[];
  quickFilter?: 'open' | 'closingSoon' | 'recent' | null;
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
            quickFilter,
            setQueryString: vi.fn(),
            refreshFellowships: vi.fn(),
          }}
        >
          <Fellowships />
        </FellowshipSearchContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

describe('Fellowships grouping', () => {
  afterEach(() => {
    cleanup();
  });

  it('groups by program role and orders a section by what a student can act on now', () => {
    renderFellowships({
      fellowships: [
        makeFellowship({
          id: 'closed',
          title: 'Closed Fellowship',
          programKind: 'FELLOWSHIP_FUNDING',
          deadline: pastDate(7),
        }),
        makeFellowship({
          id: 'future',
          title: 'Future Fellowship',
          programKind: 'FELLOWSHIP_FUNDING',
          isAcceptingApplications: false,
          applicationOpenDate: futureDate(14),
          deadline: futureDate(90),
        }),
        makeFellowship({ id: 'open', title: 'Open Fellowship', programKind: 'FELLOWSHIP_FUNDING' }),
        makeFellowship({
          id: 'route-in',
          title: 'Mentor Matching Program',
          programKind: 'MENTOR_MATCHING',
        }),
      ],
    });

    const routeIn = screen.getByRole('region', { name: 'Ways Into Research' });
    const funding = screen.getByRole('region', { name: "Funding for Research You've Arranged" });
    expect(within(routeIn).getByText('Mentor Matching Program')).toBeInTheDocument();
    const order = within(funding)
      .getAllByRole('article')
      .map((card) => within(card).getByText(/Fellowship$/).textContent);
    expect(order).toEqual(['Open Fellowship', 'Future Fellowship', 'Closed Fellowship']);
    expect(routeIn.compareDocumentPosition(funding)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps opening-soon fellowships out of the open quick filter', () => {
    renderFellowships({
      quickFilter: 'open',
      fellowships: [
        makeFellowship({ id: 'open', title: 'Open Fellowship', programKind: 'FELLOWSHIP_FUNDING' }),
        makeFellowship({
          id: 'future',
          title: 'Future Fellowship',
          isAcceptingApplications: false,
          applicationOpenDate: futureDate(14),
          deadline: futureDate(90),
        }),
        makeFellowship({
          id: 'closed',
          title: 'Closed Fellowship',
          deadline: pastDate(7),
        }),
      ],
    });

    expect(
      within(screen.getByTestId('browse-grid')).getByText('Open Fellowship'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Future Fellowship')).not.toBeInTheDocument();
    expect(screen.queryByText('Closed Fellowship')).not.toBeInTheDocument();
  });
});
