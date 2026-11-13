import { describe, expect, it } from 'vitest';
import { isWriterEvidenceObservation } from '../coverageSynthesis';

const roster = (value: string) => ({
  field: 'fullDescription',
  value,
  sourceName: 'dept-faculty-roster',
  sourceUrl: 'https://geology.yale.edu/people/faculty',
});

describe("a department roster's templated topic sentence is not writer evidence (#5978)", () => {
  it('refuses the sentence the roster assembles from topic tags', () => {
    expect(
      isWriterEvidenceObservation(
        roster('Studies sediment transport, including estuaries, storm surges, and tidal marshes.'),
      ),
    ).toBe(false);
    expect(isWriterEvidenceObservation(roster('Studies coastal geomorphology.'))).toBe(false);
  });

  it('keeps a roster description the profile page states', () => {
    expect(
      isWriterEvidenceObservation(
        roster(
          'Her research examines how estuarine sediment moves during storm surges, using field cores from tidal marshes.',
        ),
      ),
    ).toBe(true);
  });

  it('keeps the same opening from a source that states it on a page', () => {
    expect(
      isWriterEvidenceObservation({
        ...roster('Studies sediment transport, including estuaries.'),
        sourceName: 'ysm-faculty-directory',
      }),
    ).toBe(true);
  });
});
