import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchFilterDisclosure from '../ResearchFilterDisclosure';

const originalMatchMedia = window.matchMedia;

const renderFilters = (
  overrides: Partial<ComponentProps<typeof ResearchFilterDisclosure>> = {},
) => {
  const props: ComponentProps<typeof ResearchFilterDisclosure> = {
    facetDistribution: {
      entityType: { LAB: 12, CORE_FACILITY: 4 },
      school: { 'Yale College': 8, 'School of Medicine': 4 },
      departments: { 'Computer Science': 5, Neuroscience: 3 },
    },
    selectedEntityType: '',
    selectedSchool: '',
    selectedDepartment: '',
    isApplying: false,
    hasFacetError: false,
    departmentLabel: (value) => value,
    onEntityTypeChange: vi.fn(),
    onSchoolChange: vi.fn(),
    onDepartmentChange: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  };
  return { ...render(<ResearchFilterDisclosure {...props} />), props };
};

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('ResearchFilterDisclosure', () => {
  it('moves and contains mobile focus, then restores the trigger on Escape and backdrop close', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
    renderFilters({ selectedSchool: 'Yale College' });

    const trigger = screen.getByRole('button', { name: 'Filters, 1 active' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Research filters' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = within(dialog).getByRole('button', { name: 'Close filters' });
    await waitFor(() => expect(close).toHaveFocus());

    const last = within(dialog).getByRole('button', { name: 'Clear all filters' });
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Research filters' })).toBeNull();
    expect(screen.queryByLabelText('Filter by school')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Research filters' });
    fireEvent.mouseDown(screen.getByTestId('research-filter-backdrop'));
    expect(screen.queryByRole('dialog', { name: 'Research filters' })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps the desktop disclosure non-modal and lets Tab leave it', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    renderFilters();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Research filters' });
    expect(dialog.className).toContain('sm:absolute');
    expect(dialog).not.toHaveAttribute('aria-modal');
    await waitFor(() => expect(within(dialog).getByLabelText('Filter by type')).toHaveFocus());
    expect(within(dialog).getByRole('button', { name: 'Close filters' })).not.toHaveFocus();

    const last = within(dialog).getByLabelText('Filter by department');
    last.focus();
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(last).toHaveFocus();
  });

  it.each([320, 375])(
    'keeps the mobile sheet and long active chips bounded at %ipx',
    async (width) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
      renderFilters({
        selectedSchool: 'A very long school name that must stay inside the narrow viewport',
        selectedDepartment: 'A very long department name that must not force horizontal overflow',
        facetDistribution: {},
      });

      const schoolChip = screen.getByRole('button', {
        name: /Remove School: A very long school name/,
      });
      const departmentChip = screen.getByRole('button', {
        name: /Remove Department: A very long department name/,
      });
      expect(schoolChip.className).toContain('max-w-full');
      expect(schoolChip.className).toContain('min-w-0');
      expect(departmentChip.className).toContain('max-w-full');

      fireEvent.click(screen.getByRole('button', { name: 'Filters, 2 active' }));
      const dialog = screen.getByRole('dialog', { name: 'Research filters' });
      expect(dialog.className).toContain('inset-x-0');
      expect(dialog.className).toContain('w-full');
      expect(dialog.className).toContain('max-w-full');
    },
  );

  it('renders the sidebar variant as an always-open static panel without a trigger', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    renderFilters({ variant: 'sidebar', selectedSchool: 'Yale College' });

    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Research filters', level: 2 })).toBeTruthy();
    expect(screen.getByLabelText('Filter by school')).toBeTruthy();
    expect(screen.getByLabelText('Filter by department')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove School: Yale College' })).toBeTruthy();
  });

  // The current-availability, compensation and eligible-student-levels filter
  // groups were removed because no source populates them. Pin their absence so a
  // later change cannot quietly reintroduce a facet the corpus cannot fill.
  it('renders no undergraduate availability, compensation or class-year filters', () => {
    renderFilters({ variant: 'sidebar' });

    expect(screen.queryByText(/undergraduate availability/i)).toBeNull();
    expect(screen.queryByText(/undergraduate compensation/i)).toBeNull();
    expect(screen.queryByText(/open to first-years/i)).toBeNull();
    expect(screen.queryByText(/paid or stipend/i)).toBeNull();
  });

  it('keeps a controlled popover open across a browse-to-search-results remount', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    const ModeSwitchingFilters = () => {
      const [hasSubmittedSearch, setHasSubmittedSearch] = useState(false);
      const [isOpen, setIsOpen] = useState(false);
      const shared: ComponentProps<typeof ResearchFilterDisclosure> = {
        facetDistribution: {
          school: { 'Yale College': 8, 'School of Medicine': 4 },
        },
        selectedEntityType: '',
        selectedSchool: '',
        selectedDepartment: '',
        isApplying: false,
        hasFacetError: false,
        departmentLabel: (value) => value,
        onEntityTypeChange: vi.fn(),
        onSchoolChange: () => setHasSubmittedSearch(true),
        onDepartmentChange: vi.fn(),
        onClearAll: vi.fn(),
        isOpen,
        onOpenChange: setIsOpen,
      };
      return (
        <>
          {!hasSubmittedSearch && (
            <section aria-label="Research homes to explore" data-testid="browse">
              <ResearchFilterDisclosure {...shared} />
            </section>
          )}
          {hasSubmittedSearch && (
            <section aria-label="Search results" data-testid="search-results">
              <ResearchFilterDisclosure {...shared} />
            </section>
          )}
        </>
      );
    };

    render(<ModeSwitchingFilters />);

    expect(screen.getByTestId('browse')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await screen.findByRole('dialog', { name: 'Research filters' });

    fireEvent.change(screen.getByLabelText('Filter by school'), {
      target: { value: 'Yale College' },
    });

    expect(screen.getByTestId('search-results')).toBeTruthy();
    expect(screen.queryByTestId('browse')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Research filters' })).toBeTruthy();
  });

  // The 50 served CORE_FACILITY cards and the 99 served center/institute/initiative
  // cards were indistinguishable from 3,199 lab and faculty-research cards because
  // the panel exposed only the school and department axes (#2195).
  it('exposes the entityType axis with the shared kind labels and reports the choice', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({
      facetDistribution: {
        entityType: { LAB: 1322, CORE_FACILITY: 50, FACULTY_RESEARCH_AREA: 2149 },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const typeSelect = screen.getByLabelText('Filter by type') as HTMLSelectElement;
    expect(Array.from(typeSelect.options).map((option) => option.textContent)).toEqual([
      'All types',
      'Core Facility (50)',
      'Faculty Research (2149)',
      'Lab (1322)',
    ]);

    fireEvent.change(typeSelect, { target: { value: 'CORE_FACILITY' } });
    expect(props.onEntityTypeChange).toHaveBeenCalledWith('CORE_FACILITY');
  });

  it('keeps a selected entityType clearable through a labelled chip when its facet is gone', () => {
    const { props } = renderFilters({
      facetDistribution: {},
      selectedEntityType: 'CORE_FACILITY',
    });

    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeTruthy();
    const chip = screen.getByRole('button', { name: 'Remove Type: Core Facility' });
    expect(chip.textContent).toContain('Type: Core Facility');
    fireEvent.click(chip);
    expect(props.onEntityTypeChange).toHaveBeenCalledWith('');
  });

  it('hides single and non-positive facets unless selected', () => {
    renderFilters({
      facetDistribution: {
        school: { 'Yale College': 1, Unknown: 0 },
        departments: { Neuroscience: -1 },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByLabelText('Filter by school')).toBeNull();
    expect(screen.queryByLabelText('Filter by department')).toBeNull();
    expect(screen.getByText('No additional filters can narrow these results.')).toBeTruthy();
  });
});
