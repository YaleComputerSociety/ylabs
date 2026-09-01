import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PlanningOverview from '../PlanningOverview';

const renderOverview = (props: Parameters<typeof PlanningOverview>[0]) =>
  render(
    <MemoryRouter>
      <PlanningOverview {...props} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('PlanningOverview workspace eyebrow', () => {
  it('labels the shared account view with a neutral workspace eyebrow', () => {
    renderOverview({ savedResearchCount: 1, savedFellowshipCount: 1 });

    expect(screen.getByText('Your workspace')).toBeTruthy();
    expect(screen.queryByText('Student workspace')).toBeNull();
  });
});

describe('PlanningOverview Next up card', () => {
  it('reflects saved research plans when no program deadline is set', () => {
    renderOverview({ savedResearchCount: 3, savedFellowshipCount: 0 });

    expect(screen.getByText('Reach out to a saved research home')).toBeTruthy();
  });

  it('describes only features the Dashboard actually offers', () => {
    renderOverview({ savedResearchCount: 3, savedFellowshipCount: 2 });

    const detail = screen.getByText(/Open a saved research home to find its official profile/);
    expect(detail.textContent).toContain('reach out');
    expect(detail.textContent).toContain('keep private notes');
    expect(detail.textContent).toContain('Watch programs to track');
    expect(screen.queryByText(/checklist steps/i)).toBeNull();
    expect(screen.queryByText(/funding matches/i)).toBeNull();
    expect(screen.queryByText(/email/i)).toBeNull();
  });

  it('keeps an upcoming program deadline as the primary Next up cue', () => {
    renderOverview({
      savedResearchCount: 3,
      savedFellowshipCount: 1,
      nextDeadlineLabel: 'Summer Research Grant: Due Jun 30, 2099',
    });

    expect(screen.getByText('Summer Research Grant: Due Jun 30, 2099')).toBeTruthy();
    expect(screen.queryByText('Reach out to a saved research home')).toBeNull();
  });

  it('prompts a first save when nothing is tracked yet', () => {
    renderOverview({ savedResearchCount: 0, savedFellowshipCount: 0 });

    expect(screen.getByText('Save a research home to start planning')).toBeTruthy();
  });
});

describe('PlanningOverview open-homes rollup', () => {
  it('summarizes how many saved homes are currently open to undergraduates', () => {
    renderOverview({ savedResearchCount: 3, savedOpenCount: 2, savedFellowshipCount: 0 });

    expect(
      screen.getByText('2 of your saved homes are currently open to undergraduates.'),
    ).toBeTruthy();
  });

  it('uses singular phrasing for a single open home', () => {
    renderOverview({ savedResearchCount: 3, savedOpenCount: 1, savedFellowshipCount: 0 });

    expect(
      screen.getByText('1 of your saved home is currently open to undergraduates.'),
    ).toBeTruthy();
  });

  it('stays silent when no saved home is currently open', () => {
    renderOverview({ savedResearchCount: 3, savedOpenCount: 0, savedFellowshipCount: 0 });

    expect(screen.queryByText(/currently open to undergraduates/)).toBeNull();
  });
});

describe('PlanningOverview watched-deadline urgency signal', () => {
  it('surfaces the aggregate near-term count and routes to Program Watch on click', () => {
    const onViewProgramWatch = vi.fn();
    renderOverview({
      savedResearchCount: 0,
      savedFellowshipCount: 3,
      watchedDeadlineApproachingCount: 2,
      watchedDeadlineNotStartedCount: 0,
      onViewProgramWatch,
    });

    const cta = screen.getByRole('button', {
      name: '2 watched programs close within 2 weeks',
    });
    expect(cta.textContent).toContain('2 watched programs close within 2 weeks');
    fireEvent.click(cta);
    expect(onViewProgramWatch).toHaveBeenCalledTimes(1);
  });

  it('emphasizes the not-started-and-closing-soon case in the accessible label', () => {
    renderOverview({
      savedResearchCount: 0,
      savedFellowshipCount: 3,
      watchedDeadlineApproachingCount: 3,
      watchedDeadlineNotStartedCount: 1,
      onViewProgramWatch: vi.fn(),
    });

    const cta = screen.getByRole('button', {
      name: '3 watched programs close within 2 weeks, 1 not started',
    });
    expect(cta.textContent).toContain('1 not started');
  });

  it('uses singular phrasing for a single approaching program', () => {
    renderOverview({
      savedResearchCount: 0,
      savedFellowshipCount: 1,
      watchedDeadlineApproachingCount: 1,
      watchedDeadlineNotStartedCount: 0,
      onViewProgramWatch: vi.fn(),
    });

    expect(
      screen.getByRole('button', { name: '1 watched program closes within 2 weeks' }),
    ).toBeTruthy();
  });

  it('stays silent when no watched deadline is approaching', () => {
    renderOverview({
      savedResearchCount: 0,
      savedFellowshipCount: 3,
      watchedDeadlineApproachingCount: 0,
      watchedDeadlineNotStartedCount: 0,
      onViewProgramWatch: vi.fn(),
    });

    expect(screen.queryByText(/close within/)).toBeNull();
    expect(screen.queryByRole('button', { name: /close within/ })).toBeNull();
  });
});
