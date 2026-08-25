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
      school: { 'Yale College': 8, 'School of Medicine': 4 },
      departments: { 'Computer Science': 5, Neuroscience: 3 },
    },
    selectedSchool: '',
    selectedDepartment: '',
    currentAvailabilityOptions: [],
    selectedCurrentAvailability: [],
    compensationOptions: [],
    selectedCompensation: [],
    eligibleStudentLevelsOptions: [],
    selectedEligibleStudentLevels: [],
    isApplying: false,
    hasFacetError: false,
    departmentLabel: (value) => value,
    currentAvailabilityLabel: (value) => value,
    compensationLabel: (value) => value,
    eligibleStudentLevelsLabel: (value) => value,
    onSchoolChange: vi.fn(),
    onDepartmentChange: vi.fn(),
    onCurrentAvailabilityChange: vi.fn(),
    onCompensationChange: vi.fn(),
    onEligibleStudentLevelsChange: vi.fn(),
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
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Filter by school')).toHaveFocus(),
    );
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
    expect(
      screen.getByRole('heading', { name: 'Research filters', level: 2 }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Filter by school')).toBeTruthy();
    expect(screen.getByLabelText('Filter by department')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove School: Yale College' })).toBeTruthy();
  });

  it('toggles the current-availability filter and exposes a removable chip once coverage clears the minimum', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({
      variant: 'sidebar',
      currentAvailabilityOptions: [
        { value: 'OPEN', label: 'Open now', count: 15 },
        { value: 'ROLLING', label: 'Rolling', count: 10 },
      ],
    });

    fireEvent.click(screen.getByLabelText('Open now (15)'));
    expect(props.onCurrentAvailabilityChange).toHaveBeenCalledWith(['OPEN']);

    const { props: selectedProps } = renderFilters({
      variant: 'sidebar',
      currentAvailabilityOptions: [{ value: 'OPEN', label: 'Open now', count: 25 }],
      selectedCurrentAvailability: ['OPEN'],
      currentAvailabilityLabel: (value) => ({ OPEN: 'Open now', ROLLING: 'Rolling' }[value] ?? value),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Open now' }));
    expect(selectedProps.onCurrentAvailabilityChange).toHaveBeenCalledWith([]);
  });

  it('stays hidden when current-availability coverage is below the minimum servable threshold', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    const { container: sparseContainer } = renderFilters({
      variant: 'sidebar',
      currentAvailabilityOptions: [
        { value: 'OPEN', label: 'Open now', count: 5 },
        { value: 'ROLLING', label: 'Rolling', count: 2 },
      ],
    });
    expect(
      within(sparseContainer).queryByText('Current undergraduate availability'),
    ).toBeNull();

    const { container: emptyContainer } = renderFilters({
      variant: 'sidebar',
      currentAvailabilityOptions: [],
    });
    expect(
      within(emptyContainer).queryByText('Current undergraduate availability'),
    ).toBeNull();
  });

  it('keeps an already-selected current-availability value visible even below the coverage minimum', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    renderFilters({
      variant: 'sidebar',
      currentAvailabilityOptions: [{ value: 'OPEN', label: 'Open now', count: 1 }],
      selectedCurrentAvailability: ['OPEN'],
      currentAvailabilityLabel: (value) => ({ OPEN: 'Open now', ROLLING: 'Rolling' }[value] ?? value),
    });

    expect(screen.getByText('Current undergraduate availability')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Open now' })).toBeTruthy();
  });

  it('toggles the compensation filter and exposes a removable chip once coverage clears the minimum', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({
      variant: 'sidebar',
      compensationOptions: [
        { value: 'PAID_OR_STIPEND', label: 'Paid or stipend', count: 15 },
        { value: 'COURSE_CREDIT', label: 'Course credit', count: 10 },
      ],
    });

    fireEvent.click(screen.getByLabelText('Paid or stipend (15)'));
    expect(props.onCompensationChange).toHaveBeenCalledWith(['PAID_OR_STIPEND']);

    const { props: selectedProps } = renderFilters({
      variant: 'sidebar',
      compensationOptions: [{ value: 'PAID_OR_STIPEND', label: 'Paid or stipend', count: 25 }],
      selectedCompensation: ['PAID_OR_STIPEND'],
      compensationLabel: (value) =>
        ({ PAID_OR_STIPEND: 'Paid or stipend', COURSE_CREDIT: 'Course credit' }[value] ?? value),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Paid or stipend' }));
    expect(selectedProps.onCompensationChange).toHaveBeenCalledWith([]);
  });

  it('stays hidden when compensation coverage is below the minimum servable threshold', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    const { container: sparseContainer } = renderFilters({
      variant: 'sidebar',
      compensationOptions: [
        { value: 'PAID_OR_STIPEND', label: 'Paid or stipend', count: 5 },
        { value: 'COURSE_CREDIT', label: 'Course credit', count: 2 },
      ],
    });
    expect(within(sparseContainer).queryByText('Undergraduate compensation')).toBeNull();

    const { container: emptyContainer } = renderFilters({
      variant: 'sidebar',
      compensationOptions: [],
    });
    expect(within(emptyContainer).queryByText('Undergraduate compensation')).toBeNull();
  });

  it('keeps an already-selected compensation value visible even below the coverage minimum', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    renderFilters({
      variant: 'sidebar',
      compensationOptions: [{ value: 'PAID_OR_STIPEND', label: 'Paid or stipend', count: 1 }],
      selectedCompensation: ['PAID_OR_STIPEND'],
      compensationLabel: (value) =>
        ({ PAID_OR_STIPEND: 'Paid or stipend', COURSE_CREDIT: 'Course credit' }[value] ?? value),
    });

    expect(screen.getByText('Undergraduate compensation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Paid or stipend' })).toBeTruthy();
  });

  it('toggles the eligible-student-levels filter and exposes a removable chip once coverage clears the minimum', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({
      variant: 'sidebar',
      eligibleStudentLevelsOptions: [
        { value: 'FIRST_YEAR', label: 'Open to first-years', count: 15 },
        { value: 'SOPHOMORE', label: 'Open to sophomores', count: 10 },
      ],
    });

    fireEvent.click(screen.getByLabelText('Open to first-years (15)'));
    expect(props.onEligibleStudentLevelsChange).toHaveBeenCalledWith(['FIRST_YEAR']);

    const { props: selectedProps } = renderFilters({
      variant: 'sidebar',
      eligibleStudentLevelsOptions: [
        { value: 'FIRST_YEAR', label: 'Open to first-years', count: 25 },
      ],
      selectedEligibleStudentLevels: ['FIRST_YEAR'],
      eligibleStudentLevelsLabel: (value) =>
        ({
          FIRST_YEAR: 'Open to first-years',
          SOPHOMORE: 'Open to sophomores',
          JUNIOR: 'Open to juniors',
          SENIOR: 'Open to seniors',
        }[value] ?? value),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Open to first-years' }));
    expect(selectedProps.onEligibleStudentLevelsChange).toHaveBeenCalledWith([]);
  });

  it('stays hidden when eligible-student-levels coverage is below the minimum servable threshold', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    const { container: sparseContainer } = renderFilters({
      variant: 'sidebar',
      eligibleStudentLevelsOptions: [
        { value: 'FIRST_YEAR', label: 'Open to first-years', count: 5 },
        { value: 'SOPHOMORE', label: 'Open to sophomores', count: 2 },
      ],
    });
    expect(within(sparseContainer).queryByText('Open to class year')).toBeNull();

    const { container: emptyContainer } = renderFilters({
      variant: 'sidebar',
      eligibleStudentLevelsOptions: [],
    });
    expect(within(emptyContainer).queryByText('Open to class year')).toBeNull();
  });

  it('keeps an already-selected eligible-student-level value visible even below the coverage minimum', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    renderFilters({
      variant: 'sidebar',
      eligibleStudentLevelsOptions: [
        { value: 'FIRST_YEAR', label: 'Open to first-years', count: 1 },
      ],
      selectedEligibleStudentLevels: ['FIRST_YEAR'],
      eligibleStudentLevelsLabel: (value) =>
        ({
          FIRST_YEAR: 'Open to first-years',
          SOPHOMORE: 'Open to sophomores',
          JUNIOR: 'Open to juniors',
          SENIOR: 'Open to seniors',
        }[value] ?? value),
    });

    expect(screen.getByText('Open to class year')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Open to first-years' })).toBeTruthy();
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
        selectedSchool: '',
        selectedDepartment: '',
        currentAvailabilityOptions: [],
        selectedCurrentAvailability: [],
        compensationOptions: [],
        selectedCompensation: [],
        eligibleStudentLevelsOptions: [],
        selectedEligibleStudentLevels: [],
        isApplying: false,
        hasFacetError: false,
        departmentLabel: (value) => value,
        currentAvailabilityLabel: (value) => value,
        compensationLabel: (value) => value,
        eligibleStudentLevelsLabel: (value) => value,
        onSchoolChange: () => setHasSubmittedSearch(true),
        onDepartmentChange: vi.fn(),
        onCurrentAvailabilityChange: vi.fn(),
        onCompensationChange: vi.fn(),
        onEligibleStudentLevelsChange: vi.fn(),
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
