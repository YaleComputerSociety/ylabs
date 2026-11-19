import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ResearchZeroResultRecovery from '../ResearchZeroResultRecovery';

const renderRecovery = (
  overrides: Partial<ComponentProps<typeof ResearchZeroResultRecovery>> = {},
) =>
  render(
    <ResearchZeroResultRecovery
      isDepartmentSearch={false}
      activeFilterCount={0}
      selectedEntityType=""
      selectedSchool=""
      selectedDepartment=""
      departmentLabel={(value) => value}
      onRemoveEntityType={vi.fn()}
      onRemoveSchool={vi.fn()}
      onRemoveDepartment={vi.fn()}
      onRemoveHostsUndergrads={vi.fn()}
      onClearAllFilters={vi.fn()}
      relaxedQuery={null}
      onRelaxQuery={vi.fn()}
      onBrowseAll={vi.fn()}
      {...overrides}
    />,
  );

describe('ResearchZeroResultRecovery', () => {
  it('names a department coverage gap when no filter is active', () => {
    renderRecovery({ isDepartmentSearch: true });

    const region = screen.getByRole('region', { name: 'Ways to recover this search' });
    expect(region.textContent).toContain('coverage gap');
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).toBeNull();
  });

  it('offers clearing filters instead of a coverage-gap claim when active filters emptied a department search', () => {
    renderRecovery({
      isDepartmentSearch: true,
      activeFilterCount: 1,
      selectedHostsUndergrads: true,
    });

    const region = screen.getByRole('region', { name: 'Ways to recover this search' });
    expect(region.textContent).not.toContain('coverage gap');
    expect(
      screen.getByText('Active filters removed every match. Clear them to widen your search.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeTruthy();
  });
});
