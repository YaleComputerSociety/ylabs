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
});
