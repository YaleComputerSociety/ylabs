import { describe, expect, it } from 'vitest';
import {
  ORPHAN_CATEGORY_REMEDY,
  ORPHAN_OBSERVATION_KEY_CATEGORIES,
  classifyOrphanObservationKey,
  firstLastIdentityKey,
  identityCandidatesForOrphanKey,
  identityCandidatesForPersonName,
  identityCandidatesForSlug,
  materializationReachForRunStatuses,
  personSlugTail,
  summarizeOrphanObservationKeys,
  type OrphanObservationKeyFacts,
} from '../orphanObservationKeyAuditCore';

const baseFacts = (
  overrides: Partial<OrphanObservationKeyFacts> = {},
): OrphanObservationKeyFacts => ({
  entityKey: 'dept-ysph-jane-roe',
  liveObservationCount: 11,
  sourceNames: ['dept-faculty-roster'],
  enabledSourceNames: new Set(['dept-faculty-roster']),
  emittingRunStatuses: ['success'],
  observedEntityIdCount: 0,
  liveEntityIdSlugs: [],
  observedName: 'Jane Roe Faculty Research',
  observedEntityType: 'FACULTY_RESEARCH_AREA',
  leadTargetSlugs: [],
  nameMatchTargetSlugs: [],
  personKnown: false,
  ...overrides,
});

describe('identity candidate derivation', () => {
  it('strips a department namespace prefix to the person slug', () => {
    expect(personSlugTail('dept-ysph-chronic-disease-epidemiology-jane-roe')).toBeTruthy();
    expect(personSlugTail('ysm-faculty-jane-roe')).toBe('jane-roe');
    expect(personSlugTail('nih-pi-jane-roe')).toBe('jane-roe');
  });

  it('returns null for a key with no recognised namespace prefix', () => {
    expect(personSlugTail('roe-lab-jr12')).toBeNull();
  });

  it('collapses middle names and initials to first and last', () => {
    expect(firstLastIdentityKey('megan-l-ranney')).toBe('megan-ranney');
    expect(firstLastIdentityKey('peter-j-krause')).toBe('peter-krause');
    expect(firstLastIdentityKey('jane')).toBeNull();
  });

  it('matches the same person across slug schemes via the first-last key', () => {
    const orphan = identityCandidatesForOrphanKey('dept-ysph-megan-l-ranney', 'Megan L Ranney');
    const live = identityCandidatesForSlug('ysm-faculty-megan-ranney');
    expect(orphan).toContain('firstlast:megan-ranney');
    expect(live).toContain('firstlast:megan-ranney');
    expect(orphan.some((candidate) => live.includes(candidate))).toBe(true);
  });

  it('drops an entity-name suffix so a lab name resolves to its person', () => {
    expect(identityCandidatesForOrphanKey('roe-lab-jr12', 'Jane Roe Lab')).toContain(
      'exact:jane-roe',
    );
  });

  it('derives candidates from a researcher display name', () => {
    expect(identityCandidatesForPersonName('Megan L. Ranney')).toEqual([
      'exact:megan-l-ranney',
      'firstlast:megan-ranney',
    ]);
  });

  it('yields no candidates for an unusable display name', () => {
    expect(identityCandidatesForPersonName('')).toEqual([]);
    expect(identityCandidatesForPersonName(undefined)).toEqual([]);
  });
});

describe('materializationReachForRunStatuses', () => {
  it('credits a key only when an emitting run reached success', () => {
    expect(materializationReachForRunStatuses(['success'])).toBe('materialize_ran');
    expect(materializationReachForRunStatuses(['failure', 'running', 'success'])).toBe(
      'materialize_ran',
    );
  });

  it('treats failed, interrupted, and missing runs as never materialized', () => {
    expect(materializationReachForRunStatuses(['failure'])).toBe('never_materialized');
    expect(materializationReachForRunStatuses(['running'])).toBe('never_materialized');
    expect(materializationReachForRunStatuses(['missing_run_record'])).toBe('never_materialized');
    expect(materializationReachForRunStatuses([])).toBe('never_materialized');
  });
});

describe('classifyOrphanObservationKey', () => {
  it('prefers a live recorded entityId over every name-based signal', () => {
    const result = classifyOrphanObservationKey(
      baseFacts({
        observedEntityIdCount: 2,
        liveEntityIdSlugs: ['ysm-faculty-jane-roe'],
        leadTargetSlugs: ['some-other-entity'],
      }),
    );
    expect(result.category).toBe('ENTITY_ID_RESOLVES_LIVE');
    expect(result.targetSlugs).toEqual(['ysm-faculty-jane-roe']);
    expect(result.remedy).toBe('backfill_redirect');
  });

  it('reports a recorded entityId with no surviving row as hard-deleted', () => {
    const result = classifyOrphanObservationKey(
      baseFacts({ observedEntityIdCount: 1, liveEntityIdSlugs: [] }),
    );
    expect(result.category).toBe('ENTITY_ID_DEAD_NO_REDIRECT');
    expect(result.remedy).toBe('retire_observations');
  });

  it('separates a retired observed entity type from a genuine orphan', () => {
    const result = classifyOrphanObservationKey(
      baseFacts({ entityKey: 'program-some-fellowship', observedEntityType: 'PROGRAM' }),
    );
    expect(result.category).toBe('RETIRED_ENTITY_TYPE');
    expect(result.remedy).toBe('leave_to_owning_lane');
  });

  it('routes a lane whose lead leads a live entity to per-key review, not a blind redirect', () => {
    const result = classifyOrphanObservationKey(
      baseFacts({ leadTargetSlugs: ['faculty-research-area-jane-roe'] }),
    );
    expect(result.category).toBe('LEAD_RESOLVES_TO_LIVE_ENTITY');
    expect(result.remedy).toBe('review_per_key');
  });

  it('falls back to a cross-scheme name match when no lead resolves', () => {
    const result = classifyOrphanObservationKey(
      baseFacts({ nameMatchTargetSlugs: ['ysm-faculty-jane-roe'] }),
    );
    expect(result.category).toBe('NAME_MATCHES_LIVE_ENTITY');
  });

  it('classifies a key with no name or type as an enrichment-only lane', () => {
    expect(classifyOrphanObservationKey(baseFacts({ observedName: undefined })).category).toBe(
      'NO_MINT_INTENT_ENRICHMENT_ONLY',
    );
    expect(classifyOrphanObservationKey(baseFacts({ observedEntityType: '   ' })).category).toBe(
      'NO_MINT_INTENT_ENRICHMENT_ONLY',
    );
  });

  it('flags a lane whose every contributing source is disabled', () => {
    const result = classifyOrphanObservationKey(
      baseFacts({ sourceNames: ['retired-source'], enabledSourceNames: new Set(['other-source']) }),
    );
    expect(result.category).toBe('RETIRED_SOURCE_ONLY');
  });

  it('distinguishes a known person with no research home from no target at all', () => {
    expect(classifyOrphanObservationKey(baseFacts({ personKnown: true })).category).toBe(
      'PERSON_KNOWN_NO_RESEARCH_HOME',
    );
    expect(classifyOrphanObservationKey(baseFacts()).category).toBe('NO_TARGET_AT_ALL');
  });

  it('recommends driving materialization rather than pruning unprocessed input', () => {
    for (const category of ['PERSON_KNOWN_NO_RESEARCH_HOME', 'NO_TARGET_AT_ALL'] as const) {
      expect(ORPHAN_CATEGORY_REMEDY[category]).toBe('drive_materialization');
    }
  });

  it('assigns a remedy to every declared category', () => {
    for (const category of ORPHAN_OBSERVATION_KEY_CATEGORIES) {
      expect(ORPHAN_CATEGORY_REMEDY[category]).toBeTruthy();
    }
  });

  it('carries the materialization axis independently of the category', () => {
    const facts = baseFacts({ emittingRunStatuses: ['failure'] });
    const result = classifyOrphanObservationKey(facts);
    expect(result.category).toBe('NO_TARGET_AT_ALL');
    expect(result.materializationReach).toBe('never_materialized');
  });
});

describe('summarizeOrphanObservationKeys', () => {
  it('totals keys, observations, and the never-materialized subset per category', () => {
    const summary = summarizeOrphanObservationKeys([
      classifyOrphanObservationKey(
        baseFacts({ entityKey: 'a', liveObservationCount: 5, emittingRunStatuses: ['failure'] }),
      ),
      classifyOrphanObservationKey(
        baseFacts({ entityKey: 'b', liveObservationCount: 3, emittingRunStatuses: ['success'] }),
      ),
      classifyOrphanObservationKey(
        baseFacts({
          entityKey: 'c',
          liveObservationCount: 2,
          observedEntityIdCount: 1,
          emittingRunStatuses: ['running'],
        }),
      ),
    ]);

    expect(summary.keys).toBe(3);
    expect(summary.liveObservations).toBe(10);
    expect(summary.neverMaterializedKeys).toBe(2);
    expect(summary.neverMaterializedLiveObservations).toBe(7);
    expect(summary.byCategory.NO_TARGET_AT_ALL.keys).toBe(2);
    expect(summary.byCategory.NO_TARGET_AT_ALL.neverMaterializedKeys).toBe(1);
    expect(summary.byCategory.ENTITY_ID_DEAD_NO_REDIRECT.keys).toBe(1);
    expect(summary.bySource['dept-faculty-roster'].NO_TARGET_AT_ALL).toBe(2);
  });

  it('returns an empty summary for an empty population without inventing buckets', () => {
    const summary = summarizeOrphanObservationKeys([]);
    expect(summary.keys).toBe(0);
    expect(Object.keys(summary.byCategory)).toEqual([]);
  });
});
