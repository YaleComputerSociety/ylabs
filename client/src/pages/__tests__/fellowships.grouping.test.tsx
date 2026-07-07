import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import { Fellowship } from '../../types/types';
import Fellowships from '../fellowships';

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
    </UserContext.Provider>,
  );

describe('Fellowships grouping', () => {
  afterEach(() => {
    cleanup();
  });

  it('places open, opening-soon, and closed fellowships in distinct sections', () => {
    renderFellowships({
      fellowships: [
        makeFellowship({ id: 'open', title: 'Open Fellowship' }),
        makeFellowship({
          id: 'future',
          title: 'Future Fellowship',
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

    const openHeader = screen.getByRole('heading', { name: 'Open' });
    const openingSoonHeader = screen.getByRole('heading', { name: 'Opening Soon' });
    const closedHeader = screen.getByRole('heading', { name: 'Closed' });
    const openItem = screen.getByText('Open Fellowship');
    const futureItem = screen.getByText('Future Fellowship');
    const closedItem = screen.getByText('Closed Fellowship');

    expect(openHeader.compareDocumentPosition(openItem)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(openItem.compareDocumentPosition(openingSoonHeader)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(openingSoonHeader.compareDocumentPosition(futureItem)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(futureItem.compareDocumentPosition(closedHeader)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(closedHeader.compareDocumentPosition(closedItem)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps opening-soon fellowships out of the open quick filter', () => {
    renderFellowships({
      quickFilter: 'open',
      fellowships: [
        makeFellowship({ id: 'open', title: 'Open Fellowship' }),
        makeFellowship({
          id: 'future',
          title: 'Future Fellowship',
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
    expect(screen.queryByRole('heading', { name: 'Opening Soon' })).not.toBeInTheDocument();
    expect(screen.queryByText('Future Fellowship')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Closed' })).not.toBeInTheDocument();
    expect(screen.queryByText('Closed Fellowship')).not.toBeInTheDocument();
  });
});
