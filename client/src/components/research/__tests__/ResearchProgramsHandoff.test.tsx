import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import ResearchZeroResultRecovery from '../ResearchZeroResultRecovery';
import { expectNoAxeViolations } from '../../../testUtils/axe';

const renderRecovery = (programsHandoffQuery?: string) =>
  render(
    <MemoryRouter>
      <main>
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
          onClearAllFilters={vi.fn()}
          relaxedQuery={null}
          onRelaxQuery={vi.fn()}
          onBrowseAll={vi.fn()}
          programsHandoffQuery={programsHandoffQuery}
        />
      </main>
    </MemoryRouter>,
  );

describe('ResearchZeroResultRecovery programs handoff', () => {
  it('links an empty research search to the same search on programs', async () => {
    const { container } = renderRecovery('research for freshmen');
    const link = screen.getByRole('link', {
      name: /Search programs and fellowships for .research for freshmen./,
    });
    expect(link.getAttribute('href')).toBe('/programs?q=research+for+freshmen');
    await expectNoAxeViolations(container);
  });

  it('offers no handoff without a typed query', () => {
    renderRecovery('');
    expect(screen.queryByRole('link', { name: /Search programs and fellowships/ })).toBeNull();
  });
});
