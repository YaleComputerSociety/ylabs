import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import UIContext, { defaultUIContext } from '../../../contexts/UIContext';
import UserContext from '../../../contexts/UserContext';
import { BrowsableItem } from '../../../types/browsable';
import { Fellowship, Listing } from '../../../types/types';
import BrowseGrid from '../BrowseGrid';

vi.mock('../../../hooks/useViewTracking', () => ({
  useViewTracking: () => vi.fn(),
}));

const listing: Listing = {
  id: '507f1f77bcf86cd799439011',
  ownerId: '',
  ownerFirstName: 'Ada',
  ownerLastName: 'Lovelace',
  ownerEmail: '',
  ownerTitle: 'Professor',
  ownerPrimaryDepartment: 'Computer Science',
  professorIds: [],
  professorNames: [],
  title: 'Computing lab',
  departments: ['Computer Science'],
  emails: [],
  websites: [],
  description: 'Research description',
  applicantDescription: 'Python experience preferred.',
  keywords: [],
  researchAreas: ['Algorithms'],
  established: '',
  views: 0,
  favorites: 0,
  hiringStatus: 1,
  archived: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  confirmed: true,
  audited: false,
};

const futureDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const makeFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f-1',
  title: 'Future fellowship',
  competitionType: '',
  summary: '',
  description: 'Fellowship description',
  applicationInformation: '',
  eligibility: 'Open to Yale College students.',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [],
  applicationLink: '',
  awardAmount: '',
  isAcceptingApplications: true,
  applicationOpenDate: null,
  deadline: futureDate(30),
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
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderGrid = (
  viewMode: 'card' | 'list',
  onOpenModal = vi.fn(),
  items: BrowsableItem[] = [{ type: 'listing' as const, data: listing }],
) => {
  render(
    <UserContext.Provider
      value={{
        isLoading: false,
        isAuthenticated: false,
        user: undefined,
        checkContext: vi.fn(),
      }}
    >
      <ConfigContext.Provider value={defaultConfigContext}>
        <UIContext.Provider value={{ ...defaultUIContext, viewMode }}>
          <BrowseGrid
            items={items}
            favIds={[]}
            onToggleFavorite={vi.fn()}
            onOpenModal={onOpenModal}
            isLoading={false}
          />
        </UIContext.Provider>
      </ConfigContext.Provider>
    </UserContext.Provider>,
  );

  return onOpenModal;
};

describe('BrowseGrid accessibility', () => {
  it('opens card-view listings from the keyboard with a descriptive button name', async () => {
    const user = userEvent.setup();
    const onOpenModal = renderGrid('card');

    await user.tab();

    expect(
      screen.getByRole('button', {
        name: /view ada lovelace research listing, computing lab/i,
      }),
    ).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(onOpenModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: /has application details/i })).toBeTruthy();
  });

  it('opens list-view listings from the keyboard with favorite as a separate control', async () => {
    const user = userEvent.setup();
    const onOpenModal = renderGrid('list');

    await user.tab();

    expect(
      screen.getByRole('button', {
        name: /view ada lovelace research listing, computing lab/i,
      }),
    ).toHaveFocus();

    await user.keyboard(' ');

    expect(onOpenModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /add to favorites/i })).toBeTruthy();
  });

  it('shows a closed StatusBadge for future fellowship application windows', () => {
    renderGrid('list', vi.fn(), [
      {
        type: 'fellowship',
        data: makeFellowship({
          applicationOpenDate: futureDate(7),
          deadline: futureDate(30),
        }),
      },
    ]);

    expect(screen.getByText('Opens soon')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText(/^Open$/)).not.toBeInTheDocument();
  });

  it('shows an open StatusBadge for currently accepting fellowship windows', () => {
    renderGrid('list', vi.fn(), [
      {
        type: 'fellowship',
        data: makeFellowship({
          applicationOpenDate: null,
          deadline: futureDate(30),
        }),
      },
    ]);

    expect(screen.getByText('Open')).toBeInTheDocument();
  });
});
