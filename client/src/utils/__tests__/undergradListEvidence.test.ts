import { describe, expect, it } from 'vitest';

import { formatUndergradListEvidence } from '../undergradListEvidence';

describe('formatUndergradListEvidence (#5362)', () => {
  it('names the program and links the list for hosted evidence', () => {
    expect(
      formatUndergradListEvidence([
        {
          source: 'wu-tsai-undergraduate-fellows',
          signal: 'hosted',
          kind: 'advised',
          count: 2,
          latestYear: 2025,
          sourceUrl: 'https://institute.example.edu/fellows',
        },
      ]),
    ).toEqual([
      {
        text: 'Hosted 2 Wu Tsai Institute undergraduate fellows (latest 2025)',
        href: 'https://institute.example.edu/fellows',
      },
    ]);
  });

  it('uses the singular for one hosted participant and omits a missing year', () => {
    expect(
      formatUndergradListEvidence([
        {
          source: 'yibs-summer-research-fellows',
          signal: 'hosted',
          kind: 'advised',
          count: 1,
          sourceUrl: 'https://yibs.example.edu/sures',
        },
      ]).map((line) => line.text),
    ).toEqual(['Hosted 1 YIBS summer research fellow']);
  });

  it('says which list names the professor as taking undergraduates now', () => {
    expect(
      formatUndergradListEvidence([
        {
          source: 'psychology-research-opportunities',
          signal: 'welcomes',
          kind: 'open',
          sourceUrl: 'https://psychology.example.edu/opportunities',
        },
      ]).map((line) => line.text),
    ).toEqual(["Listed on Psychology's research opportunities list as taking undergraduates"]);
  });

  it('leaves mentors entries, unknown sources and unsafe links out', () => {
    expect(
      formatUndergradListEvidence([
        {
          source: 'cs-senior-projects',
          signal: 'mentors',
          kind: 'advised',
          sourceUrl: 'https://cs.example.edu/projects',
        },
        {
          source: 'unknown-list',
          signal: 'hosted',
          kind: 'advised',
          sourceUrl: 'https://example.edu/list',
        },
        {
          source: 'wu-tsai-undergraduate-fellows',
          signal: 'hosted',
          kind: 'advised',
          sourceUrl: 'javascript:alert(1)',
        },
      ]),
    ).toEqual([]);
  });
});
