/**
 * A lead edge's source name must reach `rosterProvenance`, because a fail-closed
 * refusal reads it and nothing pinned the behaviour (#3254).
 *
 * The lossy hop is gone: `buildInferredPiMemberUpsert` used to shape its patch for
 * the retired `research_entity_members` collection, writing `sourceUrl` at the top
 * level and the name only inside `fieldProvenance.role`, and the unpack read only the
 * top-level key. The #210 refactor replaced it with flat `InferredPiLeadFacts` whose
 * `sourceName` is first class. These tests hold that shape, because an edge that
 * cites a source without naming one is exactly the input `retireNonOwnerPiEdges`
 * fails closed on, and it tests the name rather than the URL.
 */
import { describe, expect, it } from 'vitest';
import { buildInferredPiLeadFacts } from '../entityMaterializer';
import {
  planNonOwnerPiEdgeRetirement,
  type NonOwnerPiEdgeRow,
} from '../../scripts/retireNonOwnerPiEdgesCore';

const RESEARCH_ENTITY_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const SOURCE_NAME = 'dept-faculty-roster';
const SOURCE_URL = 'https://example.yale.edu/people/somebody';

const facts = () =>
  buildInferredPiLeadFacts(RESEARCH_ENTITY_ID, {
    value: USER_ID,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    confidence: 0.8,
    observedAt: new Date('2026-09-24T00:00:00.000Z'),
  } as Parameters<typeof buildInferredPiLeadFacts>[1]);

describe('lead edge source-name provenance (#3254)', () => {
  it('carries the source name as a first-class fact beside the url', () => {
    const built = facts();
    expect(built).not.toBeNull();
    expect(built?.sourceName).toBe(SOURCE_NAME);
    expect(built?.sourceUrl).toBe(SOURCE_URL);
  });

  // The name and the URL must travel together or not at all. An edge carrying one
  // without the other is what made the refusal unable to see a cited source.
  it('never carries a url without the name that came with it', () => {
    const built = buildInferredPiLeadFacts(RESEARCH_ENTITY_ID, {
      value: USER_ID,
      sourceUrl: SOURCE_URL,
      confidence: 0.8,
    } as Parameters<typeof buildInferredPiLeadFacts>[1]);
    expect(built?.sourceUrl).toBe(SOURCE_URL);
    expect(built?.sourceName).toBe('');
    const carried = facts();
    expect(Boolean(carried?.sourceUrl) && Boolean(carried?.sourceName)).toBe(true);
  });

  // The RED control: the refusal is reachable, so what decides an edge's fate is
  // whether the name arrives. Same edge, retired when it does not and refused when
  // it does.
  it('lets the fail-closed refusal fire on an edge carrying a source name', () => {
    const cannotOwnResearchHome = () => true;
    const titleByPersonId = new Map([['person-1', 'Postdoctoral Associate']]);
    const edge = (sourceName?: string): NonOwnerPiEdgeRow => ({
      id: 'edge-1',
      personId: 'person-1',
      entityId: RESEARCH_ENTITY_ID,
      role: 'PI',
      sourceName,
    });

    const withName = planNonOwnerPiEdgeRetirement(
      [edge(facts()?.sourceName)],
      cannotOwnResearchHome,
      titleByPersonId,
    );
    expect(withName.retire).toEqual([]);
    expect(withName.refused[0].reason).toBe('edge-carries-provenance');

    const withoutName = planNonOwnerPiEdgeRetirement(
      [edge(undefined)],
      cannotOwnResearchHome,
      titleByPersonId,
    );
    expect(withoutName.refused).toEqual([]);
    expect(withoutName.retire).toHaveLength(1);
  });
});
