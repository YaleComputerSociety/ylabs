import { describe, expect, it } from 'vitest';

import type { SavedSearchFilters, SavedSearchView } from '../../types/savedSearch';
import {
  savedSearchDisplayLabel,
  savedSearchFilterChips,
  savedSearchSummaryText,
  savedSearchTargetPath,
} from '../savedSearchSummary';

const emptyFilters = (): SavedSearchFilters => ({
  school: [],
  departments: [],
  researchAreas: [],
  entityType: [],
  currentAvailability: [],
  compensation: [],
  eligibleStudentLevels: [],
  hostsUndergrads: false,
  hasDocumentedWayIn: false,
});

const view = (overrides: Partial<SavedSearchView> = {}): SavedSearchView => ({
  _id: 's1',
  label: '',
  queryText: '',
  filters: emptyFilters(),
  urlParams: '',
  newMatchCount: 0,
  ...overrides,
});

describe('savedSearchFilterChips', () => {
  it('renders human-readable chips for each filter facet', () => {
    const chips = savedSearchFilterChips({
      ...emptyFilters(),
      departments: ['Computer Science'],
      researchAreas: ['Machine Learning'],
      entityType: ['research_group'],
      currentAvailability: ['OPEN'],
      compensation: ['COURSE_CREDIT'],
      hostsUndergrads: true,
    });
    expect(chips).toEqual([
      'Computer Science',
      'Machine Learning',
      'Research Group',
      'Open now',
      'Course credit',
      'Hosts undergrads',
    ]);
  });
});

describe('savedSearchSummaryText', () => {
  it('combines the query and filters', () => {
    expect(
      savedSearchSummaryText(
        view({
          queryText: 'machine learning',
          filters: { ...emptyFilters(), departments: ['CS'], currentAvailability: ['OPEN'] },
        }),
      ),
    ).toBe('"machine learning" · CS, Open now');
  });

  it('falls back to a friendly label when there are no criteria', () => {
    expect(savedSearchSummaryText(view())).toBe('All research homes');
  });
});

describe('savedSearchDisplayLabel', () => {
  it('prefers the explicit label, then the query, then a filter summary', () => {
    expect(savedSearchDisplayLabel(view({ label: 'My CS labs' }))).toBe('My CS labs');
    expect(savedSearchDisplayLabel(view({ queryText: 'genomics' }))).toBe('genomics');
    expect(
      savedSearchDisplayLabel(view({ filters: { ...emptyFilters(), departments: ['CS'] } })),
    ).toBe('CS');
    expect(savedSearchDisplayLabel(view())).toBe('Saved search');
  });
});

describe('savedSearchTargetPath', () => {
  it('builds a deep link to research, stripping leading question marks', () => {
    expect(savedSearchTargetPath(view({ urlParams: '?q=ml&undergrad=1' }))).toBe(
      '/research?q=ml&undergrad=1',
    );
    expect(savedSearchTargetPath(view({ urlParams: '' }))).toBe('/research');
  });
});
