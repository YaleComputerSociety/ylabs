import { describe, expect, it } from 'vitest';
import type { SchoolCanonicalizer } from '../../scrapers/storedSchoolBacking';
import {
  NO_PROVENANCE_SOURCE,
  summarizeStoredSchoolBacking,
} from '../storedSchoolBackingReportCore';

const canonicalizer: SchoolCanonicalizer = {
  canonicalizeSchool: (raw: unknown) => ({ value: String(raw), matched: true }),
};

describe('summarizeStoredSchoolBacking (#6096)', () => {
  it('counts served rows by class and splits never-backed and superseded-only by source', () => {
    const lane = { school: { sourceName: 'fixture-lane' } };
    const rows = [
      { _id: 'live', school: 'Fixture School', served: true },
      { _id: 'superseded', school: 'Fixture School', served: true, fieldProvenance: lane },
      { _id: 'derived', school: 'Fixture School', served: true },
      { _id: 'merged-in', school: 'Fixture School', served: true },
      {
        _id: 'rival',
        school: 'Fixture School',
        served: true,
        fieldProvenance: lane,
        manuallyLockedFields: ['school'],
      },
      { _id: 'bare', school: 'Fixture School', served: true },
      { _id: 'held', school: 'Fixture School', served: false },
    ];
    const readings = new Map([
      ['live', { own: [{ value: 'Fixture School' }], mergedIn: [] }],
      ['superseded', { own: [{ value: 'Fixture School', superseded: true }], mergedIn: [] }],
      ['merged-in', { own: [], mergedIn: [{ value: 'Fixture School' }] }],
      ['rival', { own: [{ value: 'Other School' }], mergedIn: [] }],
    ]);
    const derived = new Map([['derived', 'Fixture School']]);

    const summary = summarizeStoredSchoolBacking(rows, readings, derived, canonicalizer);

    expect(summary.rows).toBe(7);
    expect(summary.servedRows).toBe(6);
    expect(summary.servedByClass).toEqual({
      'no-stored-school': 0,
      'school-observation': 2,
      'org-unit-derivation': 1,
      'merged-in-reading-only': 1,
      'never-backed': 2,
    });
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
