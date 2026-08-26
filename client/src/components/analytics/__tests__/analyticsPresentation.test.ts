import { describe, expect, it } from 'vitest';

import { formatEventType } from '../analyticsPresentation';

describe('formatEventType', () => {
  it('labels the research search event distinctly from the legacy site search', () => {
    expect(formatEventType('research_search')).toBe('Research searches');
    expect(formatEventType('research_search')).not.toBe('Search');
  });

  it('title-cases an unmapped event type', () => {
    expect(formatEventType('research_profile_open')).toBe('Research Profile Open');
  });
});
