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
    selectedResearchAreas: [],
    researchAreaOptions: [],
    hostsUndergrads: false,
    currentAvailabilityOptions: [],
    selectedCurrentAvailability: [],
    isApplying: false,
    hasFacetError: false,
    departmentLabel: (value) => value,
    currentAvailabilityLabel: (value) => value,
    onSchoolChange: vi.fn(),
    onDepartmentChange: vi.fn(),
    onResearchAreasChange: vi.fn(),
    onHostsUndergradsChange: vi.fn(),
    onCurrentAvailabilityChange: vi.fn(),
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
      expect(within(dialog).getByLabelText('Has hosted undergrads before')).toHaveFocus(),
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

  it('toggles the hosts-undergrads filter and exposes a removable chip', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({ variant: 'sidebar' });

    fireEvent.click(screen.getByLabelText('Has hosted undergrads before'));
    expect(props.onHostsUndergradsChange).toHaveBeenCalledWith(true);

    const { props: selectedProps } = renderFilters({ variant: 'sidebar', hostsUndergrads: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Has hosted undergrads before' }));
    expect(selectedProps.onHostsUndergradsChange).toHaveBeenCalledWith(false);
  });

  it('toggles the current-availability filter, exposes a removable chip, and stays hidden with no coverage', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({
      variant: 'sidebar',
      currentAvailabilityOptions: [
        { value: 'OPEN', label: 'Open now', count: 5 },
        { value: 'ROLLING', label: 'Rolling', count: 2 },
      ],
    });

    fireEvent.click(screen.getByLabelText('Open now (5)'));
    expect(props.onCurrentAvailabilityChange).toHaveBeenCalledWith(['OPEN']);

    const { props: selectedProps } = renderFilters({
      variant: 'sidebar',
      currentAvailabilityOptions: [{ value: 'OPEN', label: 'Open now', count: 5 }],
      selectedCurrentAvailability: ['OPEN'],
      currentAvailabilityLabel: (value) => ({ OPEN: 'Open now', ROLLING: 'Rolling' }[value] ?? value),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Open now' }));
    expect(selectedProps.onCurrentAvailabilityChange).toHaveBeenCalledWith([]);

    const { container: emptyContainer } = renderFilters({
      variant: 'sidebar',
      currentAvailabilityOptions: [],
    });
    expect(
      within(emptyContainer).queryByText('Current undergraduate availability'),
    ).toBeNull();
  });

  it('adds a research area from the dropdown and removes it via its chip', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const { props } = renderFilters({
      variant: 'sidebar',
      researchAreaOptions: [
        { value: 'Genomics', count: 3 },
        { value: 'Robotics', count: 2 },
      ],
    });

    const areaInput = screen.getByLabelText('Filter by research area');
    fireEvent.focus(areaInput);
    expect(screen.getByRole('option', { name: 'Robotics (2)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'Robotics (2)' }));
    expect(props.onResearchAreasChange).toHaveBeenCalledWith(['Robotics']);

    const { props: selectedProps } = renderFilters({
      variant: 'sidebar',
      researchAreaOptions: [
        { value: 'Genomics', count: 3 },
        { value: 'Robotics', count: 2 },
      ],
      selectedResearchAreas: ['Robotics'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Research area: Robotics' }));
    expect(selectedProps.onResearchAreasChange).toHaveBeenCalledWith([]);
  });

  it('keeps a controlled popover open across a browse-to-search-results remount', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    const ModeSwitchingFilters = () => {
      const [hasSubmittedSearch, setHasSubmittedSearch] = useState(false);
      const [isOpen, setIsOpen] = useState(false);
      const shared: ComponentProps<typeof ResearchFilterDisclosure> = {
        facetDistribution: {},
        selectedSchool: '',
        selectedDepartment: '',
        selectedResearchAreas: [],
        researchAreaOptions: [{ value: 'Artificial Intelligence', count: 23 }],
        hostsUndergrads: false,
        currentAvailabilityOptions: [],
        selectedCurrentAvailability: [],
        isApplying: false,
        hasFacetError: false,
        departmentLabel: (value) => value,
        currentAvailabilityLabel: (value) => value,
        onSchoolChange: vi.fn(),
        onDepartmentChange: vi.fn(),
        onResearchAreasChange: () => setHasSubmittedSearch(true),
        onHostsUndergradsChange: vi.fn(),
        onCurrentAvailabilityChange: vi.fn(),
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

    const areaInput = screen.getByLabelText('Filter by research area');
    fireEvent.focus(areaInput);
    fireEvent.click(screen.getByRole('option', { name: 'Artificial Intelligence (23)' }));

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
