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
  it('serves exactly the sources the owner confirmed on 2026-11-10, and never EPS or Tobin', () => {
    expect([...OWNER_REVIEWED_UNDERGRAD_LIST_SOURCES].sort()).toEqual(
      [
        'cs-senior-projects',
        'cs-directed-research',
        'economics-senior-essay-advisers',
        'psychology-research-opportunities',
        'wu-tsai-undergraduate-fellows',
        'physics-open-research-opportunities',
        'english-senior-essays',
        'english-creative-writing-projects',
        'political-science-senior-essay-prizes',
        'german-senior-essays',
        'yibs-summer-research-fellows',
        'cognitive-science-senior-essays',
      ].sort(),
    );
    expect(OWNER_REVIEWED_UNDERGRAD_LIST_SOURCES.has('eps-senior-theses')).toBe(false);
    expect(OWNER_REVIEWED_UNDERGRAD_LIST_SOURCES.has('tobin-research-assistantships')).toBe(false);
  });

  it('serves nothing from a source the owner has not reviewed', () => {
    const unreviewed = [
      {
        source: 'tobin-research-assistantships',
        kind: 'advised',
        count: 1,
        sourceUrl: 'https://economics.example.edu/tobin',
      },
    ];
    expect(publicUndergradListEvidence(unreviewed)).toEqual([]);
    expect(publicUndergradListEvidence(stored, { reviewedSources: new Set() })).toEqual([]);
    expect(entityMentorsUndergraduates({ undergradListEvidence: stored }, new Set())).toBe(false);
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
      }).map((entry) => entry.source),
    ).toEqual(['cs-senior-projects', 'tobin-research-assistantships']);
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
