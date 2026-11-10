import { describe, expect, it } from 'vitest';
import {
  entityHasUndergradListSignal,
  entityMentorsUndergraduates,
  OWNER_REVIEWED_UNDERGRAD_LIST_SOURCES,
  publicUndergradListEvidence,
} from '../undergradListEvidenceServing';

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
  {
    source: 'tobin-research-assistantships',
    kind: 'advised',
    count: 2,
    sourceUrl: 'https://economics.example.edu/tobin',
  },
];
const reviewed = new Set([
  'cs-senior-projects',
  'economics-senior-essay-advisers',
  'tobin-research-assistantships',
]);

describe('publicUndergradListEvidence', () => {
  it('serves nothing from a source the owner has not reviewed', () => {
    expect(OWNER_REVIEWED_UNDERGRAD_LIST_SOURCES.size).toBe(0);
    expect(publicUndergradListEvidence(stored)).toEqual([]);
    expect(entityMentorsUndergraduates({ undergradListEvidence: stored })).toBe(false);
  });

  it('serves each reviewed entry with the one signal its list feeds', () => {
    expect(
      publicUndergradListEvidence(stored, { reviewedSources: reviewed }).map((entry) => [
        entry.source,
        entry.signal,
      ]),
    ).toEqual([
      ['cs-senior-projects', 'mentors'],
      ['economics-senior-essay-advisers', 'mentors'],
      ['tobin-research-assistantships', 'hosted'],
    ]);
  });

  it('reads one signal at a time, so a hosted list never makes a row a mentor', () => {
    const hostedOnly = { undergradListEvidence: [stored[2]] };
    expect(entityMentorsUndergraduates(hostedOnly, reviewed)).toBe(false);
    expect(entityHasUndergradListSignal(hostedOnly, 'hosted', reviewed)).toBe(true);
  });

  it('withholds a current openness entry when the row withholds its way in', () => {
    expect(
      publicUndergradListEvidence(stored, {
        reviewedSources: reviewed,
        wayInWithheld: true,
        signal: 'mentors',
      }).map((entry) => entry.kind),
    ).toEqual(['advised']);
  });

  it('drops an unknown source, an unknown kind, a non-public URL and a bad count', () => {
    expect(
      publicUndergradListEvidence(
        [
          { source: 'not-a-source', kind: 'advised', sourceUrl: 'https://example.edu/' },
          { source: 'cs-senior-projects', kind: 'hosted', sourceUrl: 'https://example.edu/' },
          { source: 'cs-senior-projects', kind: 'advised', sourceUrl: 'javascript:alert(1)' },
          { source: 'cs-senior-projects', kind: 'advised', count: -2, sourceUrl: 'https://e.edu/' },
        ],
        { reviewedSources: reviewed },
      ),
    ).toEqual([
      {
        source: 'cs-senior-projects',
        signal: 'mentors',
        kind: 'advised',
        sourceUrl: 'https://e.edu/',
      },
    ]);
  });
});
