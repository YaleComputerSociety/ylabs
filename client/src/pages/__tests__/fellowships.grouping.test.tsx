import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import { Fellowship } from '../../types/types';
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

const renderFellowships = ({
  fellowships,
  quickFilter = null,
}: {
  fellowships: Fellowship[];
  quickFilter?: FellowshipQuickFilter;
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

  it('groups by application status, soonest action first', () => {
    renderFellowships({
      fellowships: [
        makeFellowship({
          id: 'closed',
          title: 'Closed Fellowship',
          programKind: 'FELLOWSHIP_FUNDING',
          deadline: pastDate(7),
          applicationLink: 'https://example.org/apply',
        }),
        makeFellowship({
          id: 'future',
          title: 'Future Fellowship',
          programKind: 'FELLOWSHIP_FUNDING',
          isAcceptingApplications: false,
          applicationOpenDate: futureDate(14),
          deadline: futureDate(90),
        }),
        makeFellowship({
          id: 'open-late',
          title: 'Later Open Fellowship',
          programKind: 'FELLOWSHIP_FUNDING',
          deadline: futureDate(120),
        }),
        makeFellowship({
          id: 'open-early',
          title: 'Earlier Open Fellowship',
          programKind: 'MENTOR_MATCHING',
          deadline: futureDate(45),
        }),
        makeFellowship({
          id: 'closing',
          title: 'Closing Fellowship',
          programKind: 'FELLOWSHIP_FUNDING',
          deadline: futureDate(5),
        }),
      ],
    });

    const regions = [
      'Due in the Next 30 Days',
      'Accepting Applications',
      'Opening Soon',
      'Plan for the Next Cycle',
    ].map((name) => screen.getByRole('region', { name }));
    for (let index = 1; index < regions.length; index += 1) {
      expect(regions[index - 1].compareDocumentPosition(regions[index])).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
    expect(
      within(regions[1])
        .getAllByRole('article')
        .map((card) => card.textContent),
    ).toEqual(['Earlier Open Fellowship', 'Later Open Fellowship']);
    expect(within(regions[0]).getByText('Closing Fellowship')).toBeInTheDocument();
    expect(within(regions[2]).getByText('Future Fellowship')).toBeInTheDocument();
    expect(within(regions[3]).getByText('Closed Fellowship')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Get Started in Research' })).toBeNull();
  });

  it('narrows to programs open to first-years', () => {
    renderFellowships({
      quickFilter: 'firstYear',
      fellowships: [
        makeFellowship({
          id: 'first-year',
          title: 'First-Year Fellowship',
          yearOfStudy: ['First-Year Student', 'Sophomore'],
          deadline: futureDate(60),
        }),
        makeFellowship({
          id: 'upper',
          title: 'Upper-Level Fellowship',
          yearOfStudy: ['Junior', 'Senior'],
          deadline: futureDate(60),
        }),
      ],
    });

    expect(screen.getByText('First-Year Fellowship')).toBeInTheDocument();
    expect(screen.queryByText('Upper-Level Fellowship')).not.toBeInTheDocument();
  });

  it('narrows to programs that do not need a mentor lined up first', () => {
    renderFellowships({
      quickFilter: 'noMentorFirst',
      fellowships: [
        makeFellowship({
          id: 'mentor-first',
          title: 'Mentor First Fellowship',
          requiresMentorBeforeApply: true,
          deadline: futureDate(60),
        }),
        makeFellowship({
          id: 'matching',
          title: 'Matching Program',
          programKind: 'MENTOR_MATCHING',
          requiresMentorBeforeApply: false,
          mentorMatching: true,
          deadline: futureDate(60),
        }),
      ],
    });

    expect(screen.getByText('Matching Program')).toBeInTheDocument();
    expect(screen.queryByText('Mentor First Fellowship')).not.toBeInTheDocument();
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
