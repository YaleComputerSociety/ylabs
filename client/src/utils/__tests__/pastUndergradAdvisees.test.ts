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
      'Advised 4 undergrads',
      'Mentored 1 Fixture Scholars recipient (2025)',
    ]);
  });

  it('counts an entry naming no program as advised, beside roster alumni, without claiming a program', () => {
    const group = {
      pastUndergradAdvisees: [
        { count: 1 },
        { programName: '', year: 2021, count: 1 },
        { programName: ROSTER_ALUMNI, count: 2 },
      ],
    };
    expect(formatPastAdvisees(group, false)).toEqual(['Advised 4 undergrads (2021)']);
    expect(formatPastAdvisees(group, true)).toEqual(['Advised 2 undergrads (2021)']);
  });

  it('says nothing when there is nothing to count', () => {
    expect(formatPastAdvisees({ pastUndergradAdvisees: [] })).toEqual([]);
    expect(formatPastAdvisees({})).toEqual([]);
  });
});
