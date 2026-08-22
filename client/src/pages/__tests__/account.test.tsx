import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserContext from '../../contexts/UserContext';
import Account from '../account';

type ProgramSummary = {
  count: number;
  nextDeadlineLabel?: string;
  nextDeadlineDate?: string;
};

let savedResearchCount = 2;
let programSummary: ProgramSummary = { count: 1 };

vi.mock('../../components/accounts/SavedResearchPlans', () => {
  const MockSavedResearchPlans = ({
    onCountChange,
  }: {
    onCountChange?: (count: number) => void;
  }) => {
    useEffect(() => {
      onCountChange?.(savedResearchCount);
    }, [onCountChange]);
    return <section>Saved research plans</section>;
  };

  return { default: MockSavedResearchPlans };
});

vi.mock('../../components/accounts/ProgramWatch', () => {
  const MockProgramWatch = ({
    onSummaryChange,
  }: {
    onSummaryChange?: (summary: ProgramSummary) => void;
  }) => {
    useEffect(() => {
      onSummaryChange?.(programSummary);
    }, [onSummaryChange]);
    return <section>Program watch list</section>;
  };

  return { default: MockProgramWatch };
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
  savedResearchCount = 2;
  programSummary = { count: 1 };
});

describe('Account page', () => {
  it('renders exactly two surfaces with live counts', () => {
    renderAccount('student');

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Dashboard (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Program Watch (1)' })).toBeTruthy();
    expect(screen.getByText('Saved research plans')).toBeTruthy();
    expect(screen.getByText('Program watch list')).toBeTruthy();
    expect(screen.getByText(/2 research plans/)).toBeTruthy();
    expect(screen.getByText(/1 watched program/)).toBeTruthy();
  });

  it('lets an account switch between the Dashboard and Program Watch surfaces', () => {
    renderAccount('student');

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard (2)' });
    const programTab = screen.getByRole('tab', { name: 'Program Watch (1)' });
    expect(dashboardTab.getAttribute('aria-selected')).toBe('true');
    expect(programTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(programTab);
    expect(programTab.getAttribute('aria-selected')).toBe('true');
    expect(dashboardTab.getAttribute('aria-selected')).toBe('false');
  });

  it('uses the watched program deadline as the next planning cue', () => {
    programSummary = {
      count: 1,
      nextDeadlineDate: '2099-06-30T00:00:00.000Z',
      nextDeadlineLabel: 'Summer Research Grant: Due Jun 30, 2099',
    };

    renderAccount('student');

    expect(screen.getByText('Summer Research Grant: Due Jun 30, 2099')).toBeTruthy();
  });

  it('shows every account the same read-only surfaces with no faculty edit surface', () => {
    renderAccount('professor');

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText('Saved research plans')).toBeTruthy();
    expect(screen.getByText('Program watch list')).toBeTruthy();
    expect(screen.queryByText('Profile editor')).toBeNull();
    expect(screen.queryByText('Faculty profile center')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Manage your public research profile' }),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'View public profile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Faculty Profile Preview' })).toBeNull();
  });
});
