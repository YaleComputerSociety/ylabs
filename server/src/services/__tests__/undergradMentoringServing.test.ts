import { describe, expect, it } from 'vitest';
import {
  entityMentorsUndergraduates,
  OWNER_REVIEWED_UNDERGRAD_MENTORING_SOURCES,
  publicUndergradMentoring,
} from '../undergradMentoringServing';

const stored = [
  {
    source: 'cs-senior-projects',
    kind: 'advised',
    count: 4,
    latestYear: 2026,
    sourceUrl: 'https://zoo.example.edu/classes/cpsc4900/',
  },
  {
    source: 'economics-senior-essay-advisers',
    kind: 'open',
    sourceUrl: 'https://economics.example.edu/advisers',
  },
];
const reviewed = new Set(['cs-senior-projects', 'economics-senior-essay-advisers']);

describe('publicUndergradMentoring', () => {
  it('serves nothing from a source the owner has not reviewed', () => {
    expect(OWNER_REVIEWED_UNDERGRAD_MENTORING_SOURCES.size).toBe(0);
    expect(publicUndergradMentoring(stored)).toEqual([]);
    expect(entityMentorsUndergraduates({ undergradMentoring: stored })).toBe(false);
  });

  it('serves the entries of reviewed sources', () => {
    expect(publicUndergradMentoring(stored, { reviewedSources: reviewed })).toEqual(stored);
    expect(entityMentorsUndergraduates({ undergradMentoring: stored }, reviewed)).toBe(true);
  });

  it('withholds a current openness entry when the row withholds its way in', () => {
    expect(
      publicUndergradMentoring(stored, { reviewedSources: reviewed, wayInWithheld: true }).map(
        (entry) => entry.kind,
      ),
    ).toEqual(['advised']);
  });

  it('drops an unknown source, an unknown kind, a non-public URL and a bad count', () => {
    expect(
      publicUndergradMentoring(
        [
          { source: 'not-a-source', kind: 'advised', sourceUrl: 'https://example.edu/' },
          { source: 'cs-senior-projects', kind: 'hosted', sourceUrl: 'https://example.edu/' },
          { source: 'cs-senior-projects', kind: 'advised', sourceUrl: 'javascript:alert(1)' },
          { source: 'cs-senior-projects', kind: 'advised', count: -2, sourceUrl: 'https://e.edu/' },
        ],
        { reviewedSources: reviewed },
      ),
    ).toEqual([{ source: 'cs-senior-projects', kind: 'advised', sourceUrl: 'https://e.edu/' }]);
  });
});
