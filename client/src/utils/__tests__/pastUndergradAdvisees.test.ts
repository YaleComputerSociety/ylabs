import { describe, expect, it } from 'vitest';

import { formatPastAdvisees } from '../pastUndergradAdvisees';

const ROSTER_ALUMNI = 'Lab roster alumni';

describe('formatPastAdvisees', () => {
  it('names a fellowship program rather than counting its mentees as the lab undergrads', () => {
    expect(
      formatPastAdvisees({
        pastUndergradAdvisees: [
          { programName: 'Fixture Scholars II (Fixture Expansion)', year: 2025, count: 1 },
        ],
      }),
    ).toEqual(['Mentored 1 Fixture Scholars II recipient (2025)']);
  });

  it('names advised senior essays and theses by the work rather than as recipients', () => {
    expect(
      formatPastAdvisees({
        pastUndergradAdvisees: [
          { programName: 'Cognitive Science senior essay', year: 2024, count: 2 },
          { programName: 'Cognitive Science senior essay', year: 2011, count: 1 },
          { programName: 'Earth and Planetary Sciences senior thesis', year: 2025, count: 2 },
          { programName: 'Earth and Planetary Sciences senior thesis', year: 2026, count: 1 },
          { programName: 'Fixture Lab senior thesis', year: 2020, count: 1 },
        ],
      }),
    ).toEqual([
      'Advised 3 Cognitive Science senior essays (2011\u20132024)',
      'Advised 3 Earth and Planetary Sciences senior theses (2025\u20132026)',
      'Advised 1 Fixture Lab senior thesis (2020)',
    ]);
  });

  it('keeps one line per program with its own year range', () => {
    expect(
      formatPastAdvisees({
        pastUndergradAdvisees: [
          { programName: 'Fixture Scholars', year: 2022, count: 1 },
          { programName: 'Fixture Scholars', year: 2024, count: 2 },
          { programName: 'Fixture Travel Fellowship', year: 2023 },
        ],
      }),
    ).toEqual([
      'Mentored 3 Fixture Scholars recipients (2022–2024)',
      'Mentored 1 Fixture Travel Fellowship recipient (2023)',
    ]);
  });

  it('leaves the roster-alumni count to the roster section when the page renders one', () => {
    const group = {
      pastUndergradAdvisees: [
        { programName: ROSTER_ALUMNI, count: 4 },
        { programName: 'Fixture Scholars', year: 2025, count: 1 },
      ],
    };
    expect(formatPastAdvisees(group, true)).toEqual([
      'Mentored 1 Fixture Scholars recipient (2025)',
    ]);
    expect(formatPastAdvisees(group, false)).toEqual([
      'Has advised undergrads',
      'Mentored 1 Fixture Scholars recipient (2025)',
    ]);
  });

  it('says an entry naming no program was advised, beside roster alumni, without a count or a program', () => {
    const group = {
      pastUndergradAdvisees: [
        { count: 1 },
        { programName: '', year: 2021, count: 1 },
        { programName: ROSTER_ALUMNI, count: 2 },
      ],
    };
    expect(formatPastAdvisees(group, false)).toEqual(['Has advised undergrads (2021)']);
    expect(formatPastAdvisees(group, true)).toEqual(['Has advised undergrads (2021)']);
  });

  it('never states how many undergrads were advised', () => {
    expect(
      formatPastAdvisees({ pastUndergradAdvisees: [{ programName: ROSTER_ALUMNI, count: 2 }] }),
    ).toEqual(['Has advised undergrads']);
  });

  it('says nothing when there is nothing to count', () => {
    expect(formatPastAdvisees({ pastUndergradAdvisees: [] })).toEqual([]);
    expect(formatPastAdvisees({})).toEqual([]);
  });
});
