import { describe, expect, it } from 'vitest';

import {
  formatEventType,
  formatSearchQueryLabel,
  formatSearchSurface,
} from '../analyticsPresentation';

describe('formatEventType', () => {
  it('labels the research search event distinctly from the legacy site search', () => {
    expect(formatEventType('research_search')).toBe('Research searches');
    expect(formatEventType('research_search')).not.toBe('Search');
  });

  it('title-cases an unmapped event type', () => {
    expect(formatEventType('research_profile_open')).toBe('Research Profile Open');
  });
});

describe('formatSearchQueryLabel', () => {
  it('shows the query a student typed', () => {
    expect(formatSearchQueryLabel({ query: 'econ', filterSummary: '' })).toBe('econ');
  });

  it('names the filters behind a search with no query text', () => {
    expect(formatSearchQueryLabel({ query: '', filterSummary: 'yearOfStudy: Senior' })).toBe(
      'Filters only - Year: Senior',
    );
    expect(
      formatSearchQueryLabel({ query: '', filterSummary: 'globalRegions: Africa / Asia' }),
    ).toBe('Filters only - Region: Africa / Asia');
  });

  it('falls back only when there is nothing to report', () => {
    expect(formatSearchQueryLabel({ query: '', filterSummary: '' })).toBe('(empty search)');
    expect(formatSearchQueryLabel({})).toBe('(empty search)');
  });
});

describe('formatSearchSurface', () => {
  it('names each discovery surface', () => {
    expect(formatSearchSurface('program')).toBe('Programs');
    expect(formatSearchSurface('research_entity')).toBe('Research homes');
    expect(formatSearchSurface(undefined)).toBe('Unknown');
  });
});
