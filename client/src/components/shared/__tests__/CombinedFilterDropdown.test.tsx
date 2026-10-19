import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CombinedFilterDropdown from '../CombinedFilterDropdown';

describe('CombinedFilterDropdown', () => {
  it('preserves the anchored non-modal presentation for listing filters by default', async () => {
    render(
      <CombinedFilterDropdown
        tabs={[
          {
            key: 'department',
            label: 'Department',
            options: ['Physics'],
            selected: [],
            setSelected: vi.fn(),
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Physics').closest('.absolute')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Close filters' })).toBeNull();
  });

  it('renders labelFn copy for options while selecting on the raw value', async () => {
    const setSelected = vi.fn();
    render(
      <CombinedFilterDropdown
        tabs={[
          {
            key: 'programKind',
            label: 'Program Kind',
            options: ['SENIOR_THESIS_FUNDING'],
            labelFn: (item) =>
              item === 'SENIOR_THESIS_FUNDING' ? 'Senior research funding' : item,
            selected: [],
            setSelected,
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(screen.getByText('Senior research funding')).not.toBeNull();
    expect(screen.queryByText('SENIOR_THESIS_FUNDING')).toBeNull();

    await userEvent.click(screen.getByText('Senior research funding'));

    expect(setSelected).toHaveBeenCalledTimes(1);
    const updater = setSelected.mock.calls[0][0];
    expect(updater([])).toEqual(['SENIOR_THESIS_FUNDING']);
  });

  it('matches searchable options against their labelFn copy', async () => {
    render(
      <CombinedFilterDropdown
        tabs={[
          {
            key: 'programKind',
            label: 'Program Kind',
            options: ['SENIOR_THESIS_FUNDING', 'MENTOR_MATCHING'],
            labelFn: (item) =>
              item === 'SENIOR_THESIS_FUNDING' ? 'Senior research funding' : 'Mentor matching',
            searchable: true,
            selected: [],
            setSelected: vi.fn(),
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.type(screen.getByRole('textbox'), 'senior');

    expect(screen.getByText('Senior research funding')).not.toBeNull();
    expect(screen.queryByText('Mentor matching')).toBeNull();
  });

  it('restores the listing filter trigger on Escape', async () => {
    render(
      <CombinedFilterDropdown
        tabs={[
          {
            key: 'department',
            label: 'Department',
            options: ['Physics'],
            selected: [],
            setSelected: vi.fn(),
          },
        ]}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Filters' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByText('Physics')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('dims the page behind the mobile sheet with the scrim and closes when it is pressed', async () => {
    render(
      <CombinedFilterDropdown
        mobileSheet
        dialogLabel="Program filters"
        tabs={[
          {
            key: 'department',
            label: 'Department',
            options: ['Physics'],
            selected: [],
            setSelected: vi.fn(),
          },
        ]}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Filters' });
    await userEvent.click(trigger);
    const backdrop = screen.getByTestId('filter-sheet-backdrop');

    expect(backdrop).toHaveClass('fixed', 'inset-0', 'bg-scrim', 'sm:hidden');
    await userEvent.click(backdrop);

    expect(screen.queryByRole('dialog', { name: 'Program filters' })).toBeNull();
    expect(screen.queryByTestId('filter-sheet-backdrop')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('draws no backdrop for the anchored listing dropdown', async () => {
    render(
      <CombinedFilterDropdown
        tabs={[
          {
            key: 'department',
            label: 'Department',
            options: ['Physics'],
            selected: [],
            setSelected: vi.fn(),
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(screen.queryByTestId('filter-sheet-backdrop')).toBeNull();
  });
});
