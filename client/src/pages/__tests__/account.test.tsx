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

let savedPathwaySummary: PlanningSummary = {
  count: 2,
  nextDeadlineLabel: 'Archive assistant: Due May 20, 2026',
};
let savedProgramSummary: PlanningSummary = { count: 1 };

vi.mock('../../components/accounts/ProfileEditor', () => ({
  default: () => <section>Profile editor</section>,
}));

vi.mock('../../components/accounts/FavoritesManager', () => {
  const MockFavoritesManager = ({
    onSummaryChange,
    variant = 'student',
  }: {
    onSummaryChange?: (summary: {
      count: number;
      nextDeadlineLabel?: string;
      nextDeadlineDate?: string;
    }) => void;
    variant?: 'student' | 'professor';
  }) => {
    useEffect(() => {
      onSummaryChange?.(savedProgramSummary);
    }, [onSummaryChange]);
    return <section>Favorites manager: {variant}</section>;
  };

  return { default: MockFavoritesManager };
});

vi.mock('../../components/accounts/SavedPathwaysSection', () => {
  const MockSavedPathwaysSection = ({
    onSummaryChange,
  }: {
    onSummaryChange?: (summary: { count: number; nextDeadlineLabel?: string }) => void;
  }) => {
    useEffect(() => {
      onSummaryChange?.(savedPathwaySummary);
    }, [onSummaryChange]);
    return <section>Saved research plans</section>;
  };

  return { default: MockSavedPathwaysSection };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  savedPathwaySummary = { count: 2, nextDeadlineLabel: 'Archive assistant: Due May 20, 2026' };
  savedProgramSummary = { count: 1 };
});

describe('Account page', () => {
  it('renders a compact student command center without duplicate launch CTAs', () => {
    render(
      <MemoryRouter>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: {
              netId: 'student1',
              userType: 'student',
              userConfirmed: true,
            } as any,
            checkContext: vi.fn(),
          }}
        >
          <Account />
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText(/2 research plans/)).toBeTruthy();
    expect(screen.getByText(/1 saved program/)).toBeTruthy();
    expect(screen.queryByText('Your plan')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Plan your next research move' })).toBeNull();
    expect(screen.getByText('Archive assistant: Due May 20, 2026')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Find more research homes' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Yale Labs' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Programs & Fellowships' })).toBeNull();
  });

  it('uses the saved program deadline as the next planning cue when no saved research plan has one', () => {
    savedPathwaySummary = { count: 0, nextDeadlineLabel: '' };
    savedProgramSummary = {
      count: 1,
      nextDeadlineDate: '2099-06-30T00:00:00.000Z',
      nextDeadlineLabel: 'Summer Research Grant: Due Jun 30, 2099',
    };

    render(
      <MemoryRouter>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: {
              netId: 'student1',
              userType: 'student',
              userConfirmed: true,
            } as any,
            checkContext: vi.fn(),
          }}
        >
          <Account />
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Summer Research Grant: Due Jun 30, 2099')).toBeTruthy();
  });

  it('does not expose legacy listing management in the professor dashboard', () => {
    render(
      <MemoryRouter>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: {
              netId: 'prof1',
              userType: 'professor',
              userConfirmed: true,
            } as any,
            checkContext: vi.fn(),
          }}
        >
          <Account />
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Profile editor')).toBeTruthy();
    expect(screen.queryByText('Your Posted Roles')).toBeNull();
  });

  it('renders a faculty-centered dashboard for professors', () => {
    render(
      <MemoryRouter>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: {
              netId: 'prof1',
              userType: 'professor',
              userConfirmed: true,
            } as any,
            checkContext: vi.fn(),
          }}
        >
          <Account />
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Faculty profile center')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Manage your public research profile' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View public profile' }).getAttribute('href')).toBe(
      '/profile/prof1',
    );
    expect(screen.getByText('Favorites manager: professor')).toBeTruthy();
    expect(screen.queryByText('Your plan')).toBeNull();
    expect(screen.queryByText('Saved research plans')).toBeNull();
  });
});
