import { describe, expect, it } from 'vitest';
import {
  planGluedSentenceBoundaryRepair,
  summarizeGluedSentenceBoundaryRepair,
} from '../repairGluedSentenceBoundariesCore';

describe('planGluedSentenceBoundaryRepair', () => {
  it('plans a body no live observation asserts, which is what a rematerialize cannot reach', () => {
    const rows = planGluedSentenceBoundaryRepair('research_entities', [
      {
        _id: 'entity-1',
        slug: 'some-lab-fixture',
        name: 'Some Lab',
        fullDescription: 'The group maps tolerance.To prevent autoantibodies, it uses mice.',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields).toEqual(['fullDescription']);
    expect(rows[0].set).toEqual({
      fullDescription: 'The group maps tolerance. To prevent autoantibodies, it uses mice.',
    });
    expect(summarizeGluedSentenceBoundaryRepair(rows)).toEqual({
      rows: 1,
      byCollectionAndField: { 'research_entities.fullDescription': 1 },
    });
  });

  it('plans a grant abstract nested in recentGrants without touching the grant title', () => {
    const rows = planGluedSentenceBoundaryRepair('research_entities', [
      {
        _id: 'entity-2',
        recentGrants: [
          {
            id: 'R01-000000',
            title: 'Iodide.Transport',
            abstract: 'Maps transport.The award funds mice.',
          },
        ],
      },
    ]);
    expect(rows[0].set).toEqual({
      recentGrants: [
        {
          id: 'R01-000000',
          title: 'Iodide.Transport',
          abstract: 'Maps transport. The award funds mice.',
        },
      ],
    });
  });

  it('plans nothing for a URL or an email that merely shares the shape', () => {
    expect(
      planGluedSentenceBoundaryRepair('researchers', [
        {
          _id: 'researcher-1',
          displayName: 'Robin Reader',
          profile: { imageUrl: 'https://assets.Yale.edu/robin.jpg' },
        },
      ]),
    ).toEqual([]);
    expect(
      planGluedSentenceBoundaryRepair('fellowships', [
        { _id: 'fellowship-1', contactEmail: 'Program.Office@example.edu' },
      ]),
    ).toEqual([]);
  });

  it('plans nothing on a second pass, so a repeat run is a real zero rather than a skipped flag', () => {
    const glued = {
      _id: 'entity-3',
      fullDescription: 'Maps tolerance.To prevent autoantibodies, it uses mice.',
    };
    const first = planGluedSentenceBoundaryRepair('research_entities', [glued]);
    expect(first).toHaveLength(1);
    expect(
      planGluedSentenceBoundaryRepair('research_entities', [{ ...glued, ...first[0].set }]),
    ).toEqual([]);
  });

  it('never plans the document id, and leaves a Date field alone', () => {
    const rows = planGluedSentenceBoundaryRepair('research_entities', [
      {
        _id: 'entity-4',
        lastObservedAt: new Date('2026-02-01T00:00:00Z'),
        shortDescription: 'Maps tolerance.Uses mouse models.',
      },
    ]);
    expect(rows[0].fields).toEqual(['shortDescription']);
    expect(rows[0].set).toEqual({ shortDescription: 'Maps tolerance. Uses mouse models.' });
  });
});
