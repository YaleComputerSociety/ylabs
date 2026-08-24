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
let savedSearchCount = 3;
let savedSearchNewMatchCount = 0;

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

vi.mock('../../components/accounts/SavedSearches', () => {
  const MockSavedSearches = ({
    onCountChange,
    onNewMatchCountChange,
  }: {
    onCountChange?: (count: number) => void;
    onNewMatchCountChange?: (count: number) => void;
  }) => {
    useEffect(() => {
      onCountChange?.(savedSearchCount);
      onNewMatchCountChange?.(savedSearchNewMatchCount);
    }, [onCountChange, onNewMatchCountChange]);
    return <section>Saved searches list</section>;
  };

  return { default: MockSavedSearches };
});

vi.mock('../../components/accounts/ResearchInterestsEditor', () => ({
  default: () => <section>Research interests editor</section>,
}));

const renderAccount = (
  userType: string,
  initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/account'],
) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
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
  savedSearchCount = 3;
  savedSearchNewMatchCount = 0;
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

  it('wires each tab to its panel and applies roving tabindex', () => {
    renderAccount('student');

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard (2)' });
    const programTab = screen.getByRole('tab', { name: 'Program Watch (1)' });
    const [dashboardPanel, programPanel] = screen.getAllByRole('tabpanel', { hidden: true });

    expect(dashboardTab.getAttribute('aria-controls')).toBe(dashboardPanel.id);
    expect(dashboardPanel.getAttribute('aria-labelledby')).toBe(dashboardTab.id);
    expect(programTab.getAttribute('aria-controls')).toBe(programPanel.id);
    expect(programPanel.getAttribute('aria-labelledby')).toBe(programTab.id);

    expect(dashboardTab.getAttribute('tabindex')).toBe('0');
    expect(programTab.getAttribute('tabindex')).toBe('-1');

    fireEvent.click(programTab);
    expect(dashboardTab.getAttribute('tabindex')).toBe('-1');
    expect(programTab.getAttribute('tabindex')).toBe('0');
  });

  it('moves focus and activates the surface with arrow-key navigation', () => {
    renderAccount('student');

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard (2)' });
    const programTab = screen.getByRole('tab', { name: 'Program Watch (1)' });
    const searchesTab = screen.getByRole('tab', { name: 'Saved Searches (3)' });
    const interestsTab = screen.getByRole('tab', { name: 'Interests' });
    dashboardTab.focus();

    fireEvent.keyDown(dashboardTab, { key: 'ArrowRight' });
    expect(programTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(programTab);

    fireEvent.keyDown(programTab, { key: 'ArrowRight' });
    expect(searchesTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(searchesTab);

    fireEvent.keyDown(searchesTab, { key: 'ArrowRight' });
    expect(interestsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(interestsTab);

    fireEvent.keyDown(interestsTab, { key: 'ArrowRight' });
    expect(dashboardTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(dashboardTab);

    fireEvent.keyDown(dashboardTab, { key: 'End' });
    expect(interestsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(interestsTab);

    fireEvent.keyDown(interestsTab, { key: 'Home' });
    expect(dashboardTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(dashboardTab);

    fireEvent.keyDown(dashboardTab, { key: 'ArrowLeft' });
    expect(interestsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(interestsTab);
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

  it('clicking the Dashboard new-match callout jumps to the Saved Searches tab', () => {
    savedSearchNewMatchCount = 2;
    renderAccount('student');

    const callout = screen.getByRole('button', {
      name: /2 new matches for your saved searches/i,
    });
    fireEvent.click(callout);

    const searchesTab = screen.getByRole('tab', { name: 'Saved Searches (3)' });
    expect(searchesTab.getAttribute('aria-selected')).toBe('true');
  });

  it('opens directly on the Saved Searches tab when navigated with a searches surface state', () => {
    renderAccount('student', [{ pathname: '/account', state: { surface: 'searches' } }]);

    const searchesTab = screen.getByRole('tab', { name: 'Saved Searches (3)' });
    expect(searchesTab.getAttribute('aria-selected')).toBe('true');
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
