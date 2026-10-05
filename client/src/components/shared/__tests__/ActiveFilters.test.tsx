import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ActiveFilters from '../ActiveFilters';

describe('ActiveFilters', () => {
  it('names each chip remove button after the filter it removes', async () => {
    const onRemove = vi.fn();
    render(
      <ActiveFilters
        chips={[{ key: 'term', label: 'Summer', colorClass: '', onRemove }]}
        onClearAll={vi.fn()}
      />,
    );

    const remove = screen.getByRole('button', { name: 'Remove Summer filter' });
    expect(remove.textContent).toBe('');
    await userEvent.click(remove);

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders as a rounded rail panel with the count above the quick filters', () => {
    render(
      <ActiveFilters
        quickFilters={[
          { label: 'Open Only', value: 'open' },
          { label: 'Closing Soon', value: 'closingSoon' },
        ]}
        activeQuickFilter={null}
        onQuickFilterChange={vi.fn()}
        totalCount={42}
        chips={[]}
        onClearAll={vi.fn()}
      />,
    );

    const group = screen.getByRole('group', { name: 'Quick filters' });
    const panel = group.parentElement!;
    const count = screen.getByRole('status');

    expect(panel).toHaveClass('yr-panel', 'rounded-card', 'p-3');
    expect(panel.className).not.toMatch(/max-w-\[1300px\]|px-6|border-b/);
    expect(panel.querySelector('.mx-auto')).toBeNull();
    expect(count).toHaveTextContent('42 results');
    expect(count.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.contains(count)).toBe(false);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('min-h-[44px]', 'rounded-control');
    }
  });
});
