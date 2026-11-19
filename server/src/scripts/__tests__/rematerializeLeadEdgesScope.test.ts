import { describe, expect, it } from 'vitest';
import {
  isLeadEdgesScope,
  parseRematerializeResearchEntitiesArgs,
  selectRematerializeRegateEntityIds,
  summarizeLeadEdgeChanges,
} from '../rematerializeResearchEntitiesCore';

describe('the leadEdges rematerialize scope (#5992, #6001)', () => {
  it('accepts --only-fields=leadEdges on its own', () => {
    const args = parseRematerializeResearchEntitiesArgs([
      '--slugs=synthetic-row',
      '--only-fields=leadEdges',
    ]);
    expect(isLeadEdgesScope(args.onlyFields)).toBe(true);
  });

  it('refuses leadEdges beside a field or another mode', () => {
    expect(() =>
      parseRematerializeResearchEntitiesArgs([
        '--slugs=synthetic-row',
        '--only-fields=leadEdges,name',
      ]),
    ).toThrow(/runs on its own/);
    expect(() =>
      parseRematerializeResearchEntitiesArgs([
        '--slugs=synthetic-row',
        '--only-fields=leadEdges',
        '--unbacked-provenance',
      ]),
    ).toThrow(/runs on its own/);
  });

  it('counts edge ends by reason and re-gates only rows whose lead edges change', () => {
    const changed = {
      entityId: 'row-a',
      found: true,
      changes: [],
      leadEdgeResolution: {
        asserted: [{ personId: 'p1', sourceName: 's', sourceUrl: 'u', isNewEdge: false }],
        ended: [{ edgeId: 'e1', personId: 'p2', reason: 'retired-evidence' as const }],
      },
    };
    const unchanged = {
      entityId: 'row-b',
      found: true,
      changes: [],
      leadEdgeResolution: {
        asserted: [{ personId: 'p3', sourceName: 's', sourceUrl: 'u', isNewEdge: false }],
        ended: [],
      },
    };
    expect(summarizeLeadEdgeChanges([changed, unchanged])).toEqual({
      entitiesChanged: 1,
      edgesCreated: 0,
      endedByReason: { 'retired-evidence': 1 },
    });
    expect(selectRematerializeRegateEntityIds([changed, unchanged])).toEqual(['row-a']);
  });
});
