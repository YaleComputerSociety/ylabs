import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserContext from '../../contexts/UserContext';
import Account from '../account';

type PlanningSummary = {
  count: number;
  nextDeadlineLabel?: string;
  nextDeadlineDate?: string;
};

let savedResearchEntityIds: string[] = ['entity-1', 'entity-2'];
let savedProgramSummary: PlanningSummary = { count: 1 };

vi.mock('../../hooks/useFavorites', () => ({
  default: () => ({
    favIds: savedResearchEntityIds,
    setFavorite: vi.fn(),
    toggleFavorite: vi.fn(),
    reloadFavorites: vi.fn(),
  }),
}));

vi.mock('../../components/accounts/FavoritesManager', () => {
  const MockFavoritesManager = ({
    onSummaryChange,
  }: {
    onSummaryChange?: (summary: {
      count: number;
      nextDeadlineLabel?: string;
      nextDeadlineDate?: string;
    }) => void;
  }) => {
    useEffect(() => {
      onSummaryChange?.(savedProgramSummary);
    }, [onSummaryChange]);
    return <section>Favorites manager</section>;
  };

  return { default: MockFavoritesManager };
});

const renderAccount = (userType: string) =>
  render(
    <MemoryRouter>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: {
            netId: 'user1',
            userType,
            userConfirmed: true,
          } as any,
          checkContext: vi.fn(),
        }}
      >
        <Account />
      </UserContext.Provider>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  savedResearchEntityIds = ['entity-1', 'entity-2'];
  savedProgramSummary = { count: 1 };
});

describe('Account page', () => {
  it('renders a compact student command center without duplicate launch CTAs', () => {
    renderAccount('student');

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText(/2 research plans/)).toBeTruthy();
    expect(screen.getByText(/1 saved program/)).toBeTruthy();
    expect(screen.queryByText('Your plan')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Plan your next research move' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Find more research homes' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Yale Labs' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Programs & Fellowships' })).toBeNull();
  });

  it('uses the saved program deadline as the next planning cue', () => {
    savedProgramSummary = {
      count: 1,
      nextDeadlineDate: '2099-06-30T00:00:00.000Z',
      nextDeadlineLabel: 'Summer Research Grant: Due Jun 30, 2099',
    };

    renderAccount('student');

    expect(screen.getByText('Summer Research Grant: Due Jun 30, 2099')).toBeTruthy();
  });

  it('shows every account the same read-only dashboard with no faculty edit surface', () => {
    renderAccount('professor');

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText('Favorites manager')).toBeTruthy();
    expect(screen.getByText(/2 research plans/)).toBeTruthy();
    expect(screen.queryByText('Profile editor')).toBeNull();
    expect(screen.queryByText('Faculty profile center')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Manage your public research profile' }),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'View public profile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Faculty Profile Preview' })).toBeNull();
  });
});
