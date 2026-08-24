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

describe('PlanningOverview saved-search new-match signal', () => {
  it('surfaces the aggregate new-match count and routes to saved searches on click', () => {
    const onViewSavedSearches = vi.fn();
    renderOverview({
      savedResearchCount: 3,
      savedFellowshipCount: 0,
      savedSearchNewMatchCount: 2,
      onViewSavedSearches,
    });

    const cta = screen.getByRole('button', { name: '2 new matches for your saved searches' });
    fireEvent.click(cta);
    expect(onViewSavedSearches).toHaveBeenCalledTimes(1);
  });

  it('uses singular phrasing for a single new match', () => {
    renderOverview({
      savedResearchCount: 3,
      savedFellowshipCount: 0,
      savedSearchNewMatchCount: 1,
      onViewSavedSearches: vi.fn(),
    });

    expect(
      screen.getByRole('button', { name: '1 new match for your saved searches' }),
    ).toBeTruthy();
  });

  it('stays silent when there are no new saved-search matches', () => {
    renderOverview({
      savedResearchCount: 3,
      savedFellowshipCount: 0,
      savedSearchNewMatchCount: 0,
      onViewSavedSearches: vi.fn(),
    });

    expect(screen.queryByText(/new matches for your saved searches/)).toBeNull();
  });
});
