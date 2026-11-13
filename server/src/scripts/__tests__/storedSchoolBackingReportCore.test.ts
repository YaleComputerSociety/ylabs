import { describe, expect, it } from 'vitest';
import type { SchoolCanonicalizer } from '../../scrapers/storedSchoolBacking';
import {
  NO_PROVENANCE_SOURCE,
  summarizeStoredSchoolBacking,
} from '../storedSchoolBackingReportCore';

const canonicalizer: SchoolCanonicalizer = {
  canonicalizeSchool: (raw) => ({ value: String(raw), matched: true }),
  canonicalizeDepartments: () => ({
    values: [],
    affiliationLabels: [],
    unmatched: [],
    dropped: [],
  }),
  schoolForDepartment: () => null,
};

describe('summarizeStoredSchoolBacking (#6096)', () => {
  it('counts served rows by class and splits never-backed and superseded-only by source', () => {
    const rows = [
      { _id: 'live', school: 'Fixture School', served: true },
      {
        _id: 'superseded',
        school: 'Fixture School',
        served: true,
        fieldProvenance: { school: { sourceName: 'fixture-lane' } },
      },
      {
        _id: 'rival',
        school: 'Fixture School',
        served: true,
        fieldProvenance: { school: { sourceName: 'fixture-lane' } },
        manuallyLockedFields: ['school'],
      },
      { _id: 'bare', school: 'Fixture School', served: true },
      { _id: 'held', school: 'Fixture School', served: false },
    ];
    const observations = new Map([
      ['live', [{ value: 'Fixture School' }]],
      ['superseded', [{ value: 'Fixture School', superseded: true }]],
      ['rival', [{ value: 'Other School' }]],
    ]);

    const summary = summarizeStoredSchoolBacking(rows, observations, canonicalizer);

    expect(summary.rows).toBe(5);
    expect(summary.servedRows).toBe(4);
    expect(summary.servedByClass['school-observation']).toBe(2);
    expect(summary.servedByClass['never-backed']).toBe(2);
    expect(summary.byClass['never-backed']).toBe(3);
    expect(summary.servedBackedOnlyBySupersededReadings).toBe(1);
    expect(summary.servedBackedOnlyBySupersededReadingsByProvenanceSource).toEqual({
      'fixture-lane': 1,
    });
    expect(summary.servedNeverBackedByProvenanceSource).toEqual({
      'fixture-lane': 1,
      [NO_PROVENANCE_SOURCE]: 1,
    });
    expect(summary.servedNeverBackedSchoolLocked).toBe(1);
    expect(summary.servedNeverBackedWithRivalReadings).toBe(1);
    expect(summary.servedNeverBackedWithNoReadings).toBe(1);
  });
});
