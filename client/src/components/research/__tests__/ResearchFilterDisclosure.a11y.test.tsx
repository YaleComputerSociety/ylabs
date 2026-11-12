import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import ResearchFilterDisclosure from '../ResearchFilterDisclosure';
import { expectNoAxeViolations } from '../../../testUtils/axe';

const originalMatchMedia = window.matchMedia;

const props = (
  overrides: Partial<ComponentProps<typeof ResearchFilterDisclosure>> = {},
): ComponentProps<typeof ResearchFilterDisclosure> => ({
  facetDistribution: {
    entityType: { LAB: 1327, CORE_FACILITY: 50, FACULTY_RESEARCH_AREA: 2149 },
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
});

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('ResearchFilterDisclosure accessibility', () => {
  it('conforms in the sidebar variant with every filter axis rendered', async () => {
    const { container } = render(
      <ResearchFilterDisclosure {...props({ variant: 'sidebar', selectedEntityType: 'LAB' })} />,
    );

    await expectNoAxeViolations(container);
  });

  it('conforms in the open popover, in the applying state, and in the facet-error state', async () => {
    const { container } = render(
      <ResearchFilterDisclosure {...props({ isApplying: true, hasFacetError: true })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await expectNoAxeViolations(container);
  });

  it('conforms with the Undergrads group rendered, one option ticked and one disabled at zero (#5963)', async () => {
    const { container } = render(
      <ResearchFilterDisclosure
        {...props({
          variant: 'sidebar',
          selectedWelcomesUndergrads: true,
          facetDistribution: {
            welcomesUndergrads: { true: 4 },
            hostsUndergrads: { true: 0 },
            mentorsUndergrads: { true: 2 },
            entityType: { LAB: 4 },
          },
          onWelcomesUndergradsChange: vi.fn(),
          onHostsUndergradsChange: vi.fn(),
          onMentorsUndergradsChange: vi.fn(),
        })}
      />,
    );

    await expectNoAxeViolations(container);
  });

  it('conforms with the Undergrads group in the open popover (#5963)', async () => {
    const { container } = render(
      <ResearchFilterDisclosure
        {...props({
          facetDistribution: {
            welcomesUndergrads: { true: 4 },
            hostsUndergrads: { true: 7 },
            mentorsUndergrads: { true: 2 },
          },
          onWelcomesUndergradsChange: vi.fn(),
          onHostsUndergradsChange: vi.fn(),
          onMentorsUndergradsChange: vi.fn(),
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await expectNoAxeViolations(container);
  });

  it('conforms when a selected type has no facet counts left to render', async () => {
    const { container } = render(
      <ResearchFilterDisclosure
        {...props({ facetDistribution: {}, selectedEntityType: 'CORE_FACILITY' })}
      />,
    );

    await expectNoAxeViolations(container);
  });
});
