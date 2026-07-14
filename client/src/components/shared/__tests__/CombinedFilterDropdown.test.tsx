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
});
