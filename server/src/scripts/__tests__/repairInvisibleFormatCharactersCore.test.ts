import { describe, expect, it } from 'vitest';
import {
  planInvisibleFormatCharacterRepair,
  summarizeInvisibleFormatCharacterRepair,
} from '../repairInvisibleFormatCharactersCore';

describe('planInvisibleFormatCharacterRepair', () => {
  it('plans a field a rematerialize cannot reach, such as prose nested in recentGrants', () => {
    const rows = planInvisibleFormatCharacterRepair('research_entities', [
      {
        _id: 'entity-1',
        slug: 'some-lab-fixture',
        name: 'Some Lab',
        recentGrants: [
          { id: 'R01-000000', abstract: 'The project studies cata\u00adlytic RNA folding.' },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields).toEqual(['recentGrants']);
    expect(rows[0].set).toEqual({
      recentGrants: [{ id: 'R01-000000', abstract: 'The project studies catalytic RNA folding.' }],
    });
  });

  it('plans a researcher profile title and reports the field it repairs', () => {
    const rows = planInvisibleFormatCharacterRepair('researchers', [
      {
        _id: 'researcher-1',
        displayName: 'Robin Reader',
        profile: { title: 'Assis\u00adtant Pro\u00adfessor of Economics' },
      },
    ]);
    expect(rows[0].set).toEqual({ profile: { title: 'Assistant Professor of Economics' } });
    expect(summarizeInvisibleFormatCharacterRepair(rows)).toEqual({
      rows: 1,
      byCollectionAndField: { 'researchers.profile': 1 },
    });
  });

  it('plans nothing for a clean document, so a second run is a real zero rather than a skipped flag', () => {
    const clean = {
      _id: 'entity-2',
      slug: 'clean-lab-fixture',
      name: 'Clean Lab',
      fullDescription: 'The lab studies neural circuits underlying memory formation.',
      researchAreas: ['Neuroscience'],
    };
    expect(planInvisibleFormatCharacterRepair('research_entities', [clean])).toEqual([]);
    const repaired = planInvisibleFormatCharacterRepair('research_entities', [
      {
        ...clean,
        fullDescription: 'The lab studies neu\u200bral circuits underlying memory formation.',
      },
    ]);
    expect(repaired).toHaveLength(1);
    expect(
      planInvisibleFormatCharacterRepair('research_entities', [{ ...clean, ...repaired[0].set }]),
    ).toEqual([]);
  });

  it('never plans the document id, and leaves a Date field alone', () => {
    const lastObservedAt = new Date('2026-02-01T00:00:00Z');
    const rows = planInvisibleFormatCharacterRepair('research_entities', [
      {
        _id: 'entity-3',
        lastObservedAt,
        shortDescription: 'Stud\u200bies memory',
      },
    ]);
    expect(rows[0].fields).toEqual(['shortDescription']);
    expect(rows[0].set).toEqual({ shortDescription: 'Studies memory' });
  });
});
