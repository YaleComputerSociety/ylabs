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
    selectedHostsUndergrads: false,
    isApplying: false,
    hasFacetError: false,
    departmentLabel: (value) => value,
    onEntityTypeChange: vi.fn(),
    onSchoolChange: vi.fn(),
    onDepartmentChange: vi.fn(),
    onHostsUndergradsChange: vi.fn(),
    onWelcomesUndergradsChange: vi.fn(),
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
  it('says the filter options are loading, not that nothing can narrow the results, before the first counts arrive (#5146)', () => {
    renderFilters({ variant: 'sidebar', facetDistribution: {}, isLoadingOptions: true });

    expect(screen.getByText('Filter options will appear when this search finishes.')).toBeTruthy();
    expect(screen.queryByText('No additional filters can narrow these results.')).toBeNull();
  });

  it('offers the hosted-undergraduates filter with the count it returns, and unchecks it', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props, rerender } = renderFilters({
      variant: 'sidebar',
      facetDistribution: {
        entityType: { LAB: 12, CORE_FACILITY: 4 },
        hostsUndergrads: { true: 7 },
      },
    });

    const toggle = screen.getByRole('checkbox', {
      name: 'Hosted undergrads (7)',
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(props.onHostsUndergradsChange).toHaveBeenCalledWith(true);

    rerender(<ResearchFilterDisclosure {...props} selectedHostsUndergrads />);
    const checked = screen.getByRole('checkbox', { name: 'Hosted undergrads (7)' });
    expect(checked).toBeChecked();
    fireEvent.click(checked);
    expect(props.onHostsUndergradsChange).toHaveBeenCalledWith(false);
  });

  it('offers the welcomes-undergraduates filter with its count, and unchecks it', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props, rerender } = renderFilters({
      variant: 'sidebar',
      facetDistribution: {
        hostsUndergrads: { true: 7 },
        welcomesUndergrads: { true: 4 },
      },
    });

    const toggle = screen.getByRole('checkbox', { name: 'Welcomes undergrads (4)' });
    fireEvent.click(toggle);
    expect(props.onWelcomesUndergradsChange).toHaveBeenCalledWith(true);

    rerender(<ResearchFilterDisclosure {...props} selectedWelcomesUndergrads />);
    const checked = screen.getByRole('checkbox', { name: 'Welcomes undergrads (4)' });
    expect(checked).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Hosted undergrads (7)' })).not.toBeChecked();
    fireEvent.click(checked);
    expect(props.onWelcomesUndergradsChange).toHaveBeenCalledWith(false);
  });

  it('hides the welcomes-undergraduates filter at zero unless it is already applied', () => {
    const { props, rerender } = renderFilters({
      variant: 'sidebar',
      facetDistribution: { welcomesUndergrads: { true: 0 }, hostsUndergrads: { true: 3 } },
    });

    expect(screen.queryByRole('checkbox', { name: /^Welcomes undergrads/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Hosted undergrads (3)' })).toBeEnabled();

    rerender(<ResearchFilterDisclosure {...props} selectedWelcomesUndergrads />);
    expect(screen.getByRole('checkbox', { name: 'Welcomes undergrads (0)' })).toBeChecked();
  });

  it('shows the hosted-undergraduates filter at zero with a note that missing evidence is not absence', () => {
    renderFilters({ variant: 'sidebar', facetDistribution: { hostsUndergrads: { true: 0 } } });

    const toggle = screen.getByRole('checkbox', {
      name: 'Hosted undergrads (0)',
    });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription('Missing evidence is not proof there is none.');
  });

  it('moves desktop focus past a disabled hosted-undergraduates toggle to the first usable field', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    renderFilters({
      facetDistribution: {
        hostsUndergrads: { true: 0 },
        entityType: { LAB: 12, CORE_FACILITY: 4 },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Research filters' });
    expect(within(dialog).getByRole('checkbox', { name: 'Hosted undergrads (0)' })).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByLabelText('Filter by type')).toHaveFocus());
  });

  it('moves and contains mobile focus, then restores the trigger on Escape and backdrop close', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
    renderFilters({ selectedSchool: 'Yale College' });

    const trigger = screen.getByRole('button', { name: 'Filters, 1 active' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Research filters' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = within(dialog).getByRole('button', { name: 'Close filters' });
    await waitFor(() => expect(close).toHaveFocus());

    const last = within(dialog).getByRole('button', { name: 'Show results' });
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

  it('closes the sheet from a button that names how many results the filters leave', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
    const { rerender, props } = renderFilters({ resultCount: 1234 });

    const trigger = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Research filters' });
    expect(within(dialog).getByRole('button', { name: 'Show 1,234 results' })).toBeTruthy();

    rerender(<ResearchFilterDisclosure {...props} resultCount={1234} resultCountPending />);
    expect(within(dialog).getByRole('button', { name: 'Updating results…' })).toBeTruthy();

    const onShowResults = vi.fn();
    rerender(<ResearchFilterDisclosure {...props} resultCount={1} onShowResults={onShowResults} />);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show 1 result' }));
    expect(screen.queryByRole('dialog', { name: 'Research filters' })).toBeNull();
    expect(onShowResults).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('offers one clear-all control in the sidebar, not one beside the fields and another beside the chips', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    renderFilters({ variant: 'sidebar', selectedSchool: 'Yale College' });

    expect(screen.getAllByRole('button', { name: /^Clear all/ })).toHaveLength(1);
  });

  it('renders the sidebar variant as an always-open static panel without a trigger', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    renderFilters({ variant: 'sidebar', selectedSchool: 'Yale College' });

    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Research filters', level: 2 })).toBeTruthy();
    expect(screen.getByLabelText('Filter by school')).toBeTruthy();
    expect(screen.getByLabelText('Filter by department')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove School: Yale College' })).toBeNull();
    expect(screen.getByLabelText('Filter by school')).toHaveValue('Yale College');
  });

  it('clears every filter from the sidebar header instead of a row of its own', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({ variant: 'sidebar', selectedSchool: 'Yale College' });

    const header = screen.getByRole('heading', {
      name: 'Research filters',
      level: 2,
    }).parentElement;
    const clearAll = screen.getByRole('button', { name: 'Clear all filters' });
    expect(header).toContainElement(clearAll);
    fireEvent.click(clearAll);
    expect(props.onClearAll).toHaveBeenCalled();
  });

  it('keeps focus on the sidebar heading after clearing every filter from its header', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props, rerender } = renderFilters({
      variant: 'sidebar',
      selectedSchool: 'Yale College',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    rerender(<ResearchFilterDisclosure {...props} selectedSchool="" />);

    expect(screen.queryByRole('button', { name: 'Clear all filters' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Research filters', level: 2 })).toHaveFocus(),
    );
  });

  it('moves focus to the Filters trigger after clearing every filter beside the chips', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props, rerender } = renderFilters({ selectedSchool: 'Yale College' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    rerender(<ResearchFilterDisclosure {...props} selectedSchool="" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus());
  });

  it('keeps focus inside the open filter panel after clearing every filter there', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props, rerender } = renderFilters({ selectedSchool: 'Yale College', isOpen: true });
    const dialog = screen.getByRole('dialog', { name: 'Research filters' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear all filters' }));
    rerender(<ResearchFilterDisclosure {...props} selectedSchool="" isOpen />);

    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  });

  it('keeps the active-filter chips beside the collapsed popover trigger', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({ selectedWelcomesUndergrads: true });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Undergraduates: Welcomes now' }));
    expect(props.onWelcomesUndergradsChange).toHaveBeenCalledWith(false);
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
            <section aria-label="Research to explore" data-testid="browse">
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
  it('exposes the entityType axis with per-type labels and reports the choice', () => {
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
      'Core facility (50)',
      'Faculty research (2149)',
      'Lab (1322)',
    ]);

    fireEvent.change(typeSelect, { target: { value: 'CORE_FACILITY' } });
    expect(props.onEntityTypeChange).toHaveBeenCalledWith('CORE_FACILITY');
  });

  // A kind label would give FACULTY_RESEARCH_AREA and FACULTY_PROJECT the same
  // visible text, and would call FACULTY_PROJECT "Group" while its own cards read
  // "Faculty Research"; the retired types #2219 left stored cannot round-trip
  // through `?type=`, so they are not offered at all.
  it('gives every offered type a distinct label and drops types outside the enum', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    renderFilters({
      facetDistribution: {
        entityType: {
          FACULTY_RESEARCH_AREA: 2149,
          FACULTY_PROJECT: 2,
          FACULTY_RESEARCH: 7,
          INDIVIDUAL_RESEARCH: 3,
        },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const typeSelect = screen.getByLabelText('Filter by type') as HTMLSelectElement;
    expect(Array.from(typeSelect.options).map((option) => option.textContent)).toEqual([
      'All types',
      'Faculty project (2)',
      'Faculty research (2149)',
    ]);
    expect(Array.from(typeSelect.options).map((option) => option.value)).toEqual([
      '',
      'FACULTY_PROJECT',
      'FACULTY_RESEARCH_AREA',
    ]);
  });

  it('keeps a selected entityType clearable through a labelled chip when its facet is gone', () => {
    const { props } = renderFilters({
      facetDistribution: {},
      selectedEntityType: 'CORE_FACILITY',
    });

    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeTruthy();
    const chip = screen.getByRole('button', { name: 'Remove Type: Core facility' });
    expect(chip.textContent).toBe('Core facility');
    fireEvent.click(chip);
    expect(props.onEntityTypeChange).toHaveBeenCalledWith('');
  });

  it('shows only the value on a chip beside the trigger so it fits a phone strip', () => {
    renderFilters({ selectedHostsUndergrads: true });

    const chip = screen.getByRole('button', { name: 'Remove Undergraduates: Hosted before' });
    expect(chip.textContent).toBe('Hosted undergrads');
  });

  it('applies a department picked from the open list at once', () => {
    const { props } = renderFilters({ variant: 'sidebar' });

    fireEvent.change(screen.getByLabelText('Filter by department'), {
      target: { value: 'Neuroscience' },
    });

    expect(props.onDepartmentChange).toHaveBeenCalledWith('Neuroscience');
  });

  it('waits for Enter before applying a department reached by typing, and keeps focus', async () => {
    const { props } = renderFilters({ variant: 'sidebar' });
    const department = screen.getByLabelText('Filter by department') as HTMLSelectElement;
    department.focus();

    fireEvent.keyDown(department, { key: 'n' });
    fireEvent.change(department, { target: { value: 'Neuroscience' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.keyDown(department, { key: 'ArrowUp' });
    fireEvent.change(department, { target: { value: 'Computer Science' } });

    expect(props.onDepartmentChange).not.toHaveBeenCalled();
    expect(department.value).toBe('Computer Science');

    fireEvent.keyDown(department, { key: 'Enter' });

    expect(props.onDepartmentChange).toHaveBeenCalledTimes(1);
    expect(props.onDepartmentChange).toHaveBeenCalledWith('Computer Science');
    expect(document.activeElement).toBe(department);
  });

  it('holds a typed letter whose keypress arrives after the keydown task has finished', async () => {
    const { props } = renderFilters({ variant: 'sidebar' });
    const department = screen.getByLabelText('Filter by department') as HTMLSelectElement;

    fireEvent.keyDown(department, { key: 'n' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.keyPress(department, { key: 'n', code: 'KeyN', charCode: 110 });
    fireEvent.change(department, { target: { value: 'Neuroscience' } });

    expect(props.onDepartmentChange).not.toHaveBeenCalled();
    expect(department.value).toBe('Neuroscience');
  });

  it('puts focus back on the department select when applying it swaps in a new filter bar', async () => {
    const SwappingFilters = () => {
      const [department, setDepartment] = useState('');
      return (
        <ResearchFilterDisclosure
          key={department ? 'search-view' : 'browse-view'}
          variant="sidebar"
          facetDistribution={{ departments: { 'Computer Science': 5, Neuroscience: 3 } }}
          selectedEntityType=""
          selectedSchool=""
          selectedDepartment={department}
          isApplying={false}
          hasFacetError={false}
          departmentLabel={(value) => value}
          onEntityTypeChange={vi.fn()}
          onSchoolChange={vi.fn()}
          onDepartmentChange={setDepartment}
          onClearAll={vi.fn()}
        />
      );
    };
    render(<SwappingFilters />);
    const browseSelect = screen.getByLabelText('Filter by department') as HTMLSelectElement;
    browseSelect.focus();

    fireEvent.keyDown(browseSelect, { key: 'n' });
    fireEvent.change(browseSelect, { target: { value: 'Neuroscience' } });
    fireEvent.keyDown(browseSelect, { key: 'Enter' });

    const searchSelect = screen.getByLabelText('Filter by department');
    expect(searchSelect).not.toBe(browseSelect);
    expect(searchSelect).toHaveValue('Neuroscience');
    await waitFor(() => expect(searchSelect).toHaveFocus());
  });

  it('shows the applied value when the list opens over a typed choice, so picking that choice applies it', async () => {
    const { props } = renderFilters({ variant: 'sidebar' });
    const department = screen.getByLabelText('Filter by department') as HTMLSelectElement;

    fireEvent.keyDown(department, { key: 'n' });
    fireEvent.change(department, { target: { value: 'Neuroscience' } });
    fireEvent.mouseDown(department);
    expect(department.value).toBe('');

    fireEvent.keyDown(department, { key: 'n' });
    fireEvent.change(department, { target: { value: 'Neuroscience' } });
    fireEvent.keyDown(department, { key: 'ArrowDown', altKey: true });
    expect(department.value).toBe('');

    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.change(department, { target: { value: 'Neuroscience' } });
    expect(props.onDepartmentChange).toHaveBeenCalledTimes(1);
    expect(props.onDepartmentChange).toHaveBeenCalledWith('Neuroscience');
  });

  it('keeps the applied value when the student tabs away from a typed choice or presses Escape', () => {
    const { props } = renderFilters({ variant: 'sidebar' });
    const school = screen.getByLabelText('Filter by school') as HTMLSelectElement;

    fireEvent.keyDown(school, { key: 'y' });
    fireEvent.change(school, { target: { value: 'Yale College' } });
    fireEvent.blur(school);
    expect(school.value).toBe('');
    expect(props.onSchoolChange).not.toHaveBeenCalled();

    const type = screen.getByLabelText('Filter by type') as HTMLSelectElement;
    fireEvent.keyDown(type, { key: 'l' });
    fireEvent.change(type, { target: { value: 'LAB' } });
    fireEvent.keyDown(type, { key: 'Escape' });
    fireEvent.blur(type);
    expect(type.value).toBe('');
    expect(props.onEntityTypeChange).not.toHaveBeenCalled();
  });

  it('hides non-positive facets unless selected', () => {
    renderFilters({
      facetDistribution: {
        school: { Unknown: 0 },
        departments: { Neuroscience: -1 },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByLabelText('Filter by school')).toBeNull();
    expect(screen.queryByLabelText('Filter by department')).toBeNull();
    expect(screen.getByText('No additional filters can narrow these results.')).toBeTruthy();
  });

  it('shows a facet with one value, so a filtered list still says which type and department it holds', () => {
    renderFilters({
      variant: 'sidebar',
      facetDistribution: {
        entityType: { FACULTY_RESEARCH_AREA: 24 },
        departments: { Music: 23 },
      },
      selectedSchool: 'School of Music',
    });

    expect(
      within(screen.getByLabelText('Filter by type'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All types', 'Faculty research (24)']);
    expect(
      within(screen.getByLabelText('Filter by department'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All departments', 'Music (23)']);
  });
});
