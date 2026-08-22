import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import PlanningOverview from '../PlanningOverview';

const renderOverview = (props: Parameters<typeof PlanningOverview>[0]) =>
  render(
    <MemoryRouter>
      <PlanningOverview {...props} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('PlanningOverview Next up card', () => {
  it('reflects saved research plans when no program deadline is set', () => {
    renderOverview({ savedResearchCount: 3, savedFellowshipCount: 0 });

    expect(screen.getByText('Reach out to a saved research home')).toBeTruthy();
  });

  it('describes only features the Dashboard actually offers', () => {
    renderOverview({ savedResearchCount: 3, savedFellowshipCount: 2 });

    const detail = screen.getByText(/Open a saved research home to email its PI/);
    expect(detail.textContent).toContain('keep private notes');
    expect(detail.textContent).toContain('Watch programs to track');
    expect(screen.queryByText(/checklist steps/i)).toBeNull();
    expect(screen.queryByText(/funding matches/i)).toBeNull();
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
