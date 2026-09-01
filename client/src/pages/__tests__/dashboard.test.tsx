import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserContext from '../../contexts/UserContext';
import Dashboard from '../dashboard';

type ProgramSummary = {
  count: number;
  nextDeadlineLabel?: string;
  nextDeadlineDate?: string;
  approachingCount?: number;
  notStartedCount?: number;
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

const renderDashboard = (userType: string, initialEntries: string[] = ['/dashboard']) =>
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
        <Dashboard />
      </UserContext.Provider>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  savedResearchCount = 2;
  programSummary = { count: 1 };
});

describe('Dashboard page', () => {
  it('renders exactly two surfaces with live counts', () => {
    renderDashboard('student');

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Dashboard (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Program Watch (1)' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Saved Searches/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Interests' })).toBeNull();
    expect(screen.getByText('Saved research plans')).toBeTruthy();
    expect(screen.getByText('Program watch list')).toBeTruthy();
    expect(screen.getByText(/2 research plans/)).toBeTruthy();
    expect(screen.getByText(/1 watched program/)).toBeTruthy();
  });

  it('lets an account switch between the Dashboard and Program Watch surfaces', () => {
    renderDashboard('student');

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard (2)' });
    const programTab = screen.getByRole('tab', { name: 'Program Watch (1)' });
    expect(dashboardTab.getAttribute('aria-selected')).toBe('true');
    expect(programTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(programTab);
    expect(programTab.getAttribute('aria-selected')).toBe('true');
    expect(dashboardTab.getAttribute('aria-selected')).toBe('false');
  });

  it('wires each tab to its panel and applies roving tabindex', () => {
    renderDashboard('student');

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
    renderDashboard('student');

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard (2)' });
    const programTab = screen.getByRole('tab', { name: 'Program Watch (1)' });
    dashboardTab.focus();

    fireEvent.keyDown(dashboardTab, { key: 'ArrowRight' });
    expect(programTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(programTab);

    fireEvent.keyDown(programTab, { key: 'ArrowRight' });
    expect(dashboardTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(dashboardTab);

    fireEvent.keyDown(dashboardTab, { key: 'End' });
    expect(programTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(programTab);

    fireEvent.keyDown(programTab, { key: 'Home' });
    expect(dashboardTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(dashboardTab);

    fireEvent.keyDown(dashboardTab, { key: 'ArrowLeft' });
    expect(programTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(programTab);
  });

  it('uses the watched program deadline as the next planning cue', () => {
    programSummary = {
      count: 1,
      nextDeadlineDate: '2099-06-30T00:00:00.000Z',
      nextDeadlineLabel: 'Summer Research Grant: Due Jun 30, 2099',
    };

    renderDashboard('student');

    expect(screen.getByText('Summer Research Grant: Due Jun 30, 2099')).toBeTruthy();
  });

  it('surfaces the watched-deadline urgency signal and routes to Program Watch', () => {
    programSummary = { count: 3, approachingCount: 2, notStartedCount: 1 };
    renderDashboard('student');

    const cta = screen.getByRole('button', {
      name: '2 watched programs close within 2 weeks, 1 not started',
    });
    const programTab = screen.getByRole('tab', { name: 'Program Watch (3)' });
    expect(programTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(cta);
    expect(programTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(programTab);
  });

  it('stays silent on the dashboard when no watched deadline is approaching', () => {
    programSummary = { count: 3, approachingCount: 0, notStartedCount: 0 };
    renderDashboard('student');

    expect(screen.queryByText(/close within/)).toBeNull();
  });

  it('deep-links to the Program Watch tab via a tab query param', () => {
    renderDashboard('student', ['/dashboard?tab=programs']);

    expect(
      screen.getByRole('tab', { name: 'Program Watch (1)' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('shows every account the same read-only surfaces with no faculty edit surface', () => {
    renderDashboard('professor');

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
