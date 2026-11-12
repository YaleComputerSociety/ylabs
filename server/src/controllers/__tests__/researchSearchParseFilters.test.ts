import { describe, expect, it } from 'vitest';
import { parseFilters } from '../researchGroupController';

describe('research search request filters (#5963)', () => {
  it('accepts the mentors-undergraduates toggle only as a literal true', () => {
    expect(parseFilters({ mentorsUndergrads: true })).toEqual({ mentorsUndergrads: true });
    expect(parseFilters({ mentorsUndergrads: 'true' })).toEqual({});
    expect(parseFilters({ mentorsUndergrads: false })).toEqual({});
  });

  it('keeps each Undergrads toggle its own filter so the server ANDs them', () => {
    expect(
      parseFilters({ welcomesUndergrads: true, hostsUndergrads: true, mentorsUndergrads: true }),
    ).toEqual({ welcomesUndergrads: true, hostsUndergrads: true, mentorsUndergrads: true });
  });

  it('still accepts the works-with umbrella an old link carries', () => {
    expect(parseFilters({ worksWithUndergrads: true })).toEqual({ worksWithUndergrads: true });
  });
});
