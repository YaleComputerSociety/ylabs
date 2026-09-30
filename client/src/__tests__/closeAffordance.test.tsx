import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminFellowshipEditModal from '../components/admin/AdminFellowshipEditModal';
import ActiveFilterChip from '../components/research/ActiveFilterChip';
import ResearchFilterDisclosure from '../components/research/ResearchFilterDisclosure';
import CombinedFilterDropdown from '../components/shared/CombinedFilterDropdown';
import type { Fellowship } from '../types/types';

vi.mock('../utils/axios', () => ({ default: { put: vi.fn(), delete: vi.fn() } }));
vi.mock('sweetalert', () => ({ default: vi.fn(() => Promise.resolve(true)) }));

const TYPED_CLOSE_GLYPH = /[×✕✖✗╳⨯]|^\s*[xX]\s*$/;

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

const expectIconCloseButton = (button: HTMLElement) => {
  expect(button.textContent ?? '').not.toMatch(TYPED_CLOSE_GLYPH);
  const icon = button.querySelector('svg');
  expect(icon).not.toBeNull();
  expect(icon).toHaveAttribute('aria-hidden', 'true');
};

const expectNoTypedCloseGlyph = (container: HTMLElement) => {
  for (const button of within(container).queryAllByRole('button', { hidden: true })) {
    expect(button.textContent ?? '').not.toMatch(TYPED_CLOSE_GLYPH);
  }
};

describe('close and remove affordances', () => {
  it('draws the active filter chip remove affordance as an icon', () => {
    const { container } = render(
      <ActiveFilterChip axis="School" value="Synthetic School" onRemove={vi.fn()} />,
    );

    expectIconCloseButton(screen.getByRole('button', { name: 'Remove School: Synthetic School' }));
    expectNoTypedCloseGlyph(container);
  });

  it('draws the research filter sheet close affordance as an icon', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
    const { container } = render(
      <ResearchFilterDisclosure
        facetDistribution={{ school: { 'Synthetic School': 1 } }}
        selectedEntityType=""
        selectedSchool="Synthetic School"
        selectedDepartment=""
        isApplying={false}
        hasFacetError={false}
        departmentLabel={(value) => value}
        onEntityTypeChange={vi.fn()}
        onSchoolChange={vi.fn()}
        onDepartmentChange={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filters, 1 active' }));

    const dialog = screen.getByRole('dialog', { name: 'Research filters' });
    expectIconCloseButton(within(dialog).getByRole('button', { name: 'Close filters' }));
    expectNoTypedCloseGlyph(container);
  });

  it('draws the combined filter sheet close affordance as an icon', () => {
    const { container } = render(
      <CombinedFilterDropdown
        mobileSheet
        tabs={[
          {
            key: 'department',
            label: 'Department',
            options: ['Synthetic Department'],
            selected: [],
            setSelected: vi.fn(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expectIconCloseButton(screen.getByRole('button', { name: 'Close filters' }));
    expectNoTypedCloseGlyph(container);
  });

  it('draws the fellowship editor close affordance as an icon', () => {
    const fellowship = {
      id: 'f1',
      title: 'Synthetic Fellowship',
      isAcceptingApplications: true,
      archived: false,
      yearOfStudy: ['Senior'],
    } as unknown as Fellowship;
    const { container } = render(
      <AdminFellowshipEditModal fellowship={fellowship} onClose={vi.fn()} onSave={vi.fn()} />,
    );

    expectIconCloseButton(screen.getByRole('button', { name: 'Close fellowship editor' }));
    expectNoTypedCloseGlyph(container);
  });
});
