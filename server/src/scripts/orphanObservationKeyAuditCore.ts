/**
 * Pure classification for observation `entityKey`s that resolve to no research
 * entity and no merge redirect (issue #2383).
 *
 * The population is deliberately defined by SHAPE - slug resolvability, redirect
 * presence, recorded `entityId`, observed `entityType`, person identity - and
 * never by the absence of a flag materialization would have set. A bucket keyed
 * on a missing materializer flag reads as empty whether or not the condition
 * exists, so it would report health by construction.
 *
 * Two axes are reported separately because they answer different questions and
 * conflating them produces the wrong remedy:
 *
 *   - `category` says WHAT the stranded lane is, and therefore what it is worth.
 *   - `materializationReach` says WHETHER materialization ever ran over the lane.
 *
 * `materializeFromRun` is the only corpus entry point and it is scoped to a
 * single `scrapeRunId`, invoked after `orchestrator.run` returns. A scraper that
 * throws (run left `failure`) or a process killed mid-run (run left `running`)
 * never reaches that call, and nothing else re-enumerates observations by key:
 * `research-entity:rematerialize` selects by `research_entities.slug`, so a key
 * with no entity row is invisible to it. Such observations therefore stay live
 * and unsuperseded forever without ever having been offered to a materializer.
 * A lane in that state is unprocessed input, not dead data, and pruning it
 * destroys acquired evidence.
 */

export const ORPHAN_OBSERVATION_KEY_CATEGORIES = [
  'ENTITY_ID_RESOLVES_LIVE',
  'ENTITY_ID_DEAD_NO_REDIRECT',
  'RETIRED_ENTITY_TYPE',
  'LEAD_RESOLVES_TO_LIVE_ENTITY',
  'NAME_MATCHES_LIVE_ENTITY',
  'NO_MINT_INTENT_ENRICHMENT_ONLY',
  'RETIRED_SOURCE_ONLY',
  'PERSON_KNOWN_NO_RESEARCH_HOME',
  'NO_TARGET_AT_ALL',
] as const;

export type OrphanObservationKeyCategory = (typeof ORPHAN_OBSERVATION_KEY_CATEGORIES)[number];

export type OrphanObservationKeyRemedy =
  | 'backfill_redirect'
  | 'retire_observations'
  | 'review_per_key'
  | 'drive_materialization'
  | 'leave_to_owning_lane';

export type MaterializationReach = 'materialize_ran' | 'never_materialized';

/**
 * Entity types that no materializer will mint. `PROGRAM` is the live case: an
 * existing `PROGRAM` row freezes and a fresh key whose winning observed type is
 * `PROGRAM` only mints when a usable `kind` heals it. The museum/collections
 * types were retired wholesale by #2202.
 */
export const RETIRED_OBSERVED_ENTITY_TYPES = new Set([
  'PROGRAM',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'COLLECTIONS_INITIATIVE',
  'DIGITAL_HUMANITIES_PROJECT',
]);

/**
 * Minting a research entity needs both a name and a type. A key carrying
 * neither is an enrichment lane whose producer never intended to mint - grant
 * corpora and the lab-website index attach to a home resolved elsewhere and
 * fail closed when none exists - so its absence of an entity is by design.
 */
export const MINT_INTENT_FIELDS = ['name', 'entityType'] as const;

/**
 * Namespace prefixes observed on research-entity keys and slugs. Used only to
 * recover the person-name tail of a key so the same person can be recognised
 * across schemes; an unenumerated scheme still matches exactly, because the raw
 * key is always kept as a candidate.
 */
const KEY_NAMESPACE_PREFIX =
  /^(?:dept-[a-z0-9]+(?:-[a-z0-9]+)*?-|ysm-faculty-|ysm-lab-|ysm-|ysph-faculty-|yse-faculty-|faculty-research-area-|nih-pi-|nsf-pi-|bbs-)/;

export function slugifyIdentityText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ENTITY_NAME_SUFFIX = /-(?:lab|laboratory|research-group|faculty-research|research)$/;

export function personSlugTail(value: string): string | null {
  const match = KEY_NAMESPACE_PREFIX.exec(value);
  const tail = match ? value.slice(match[0].length) : null;
  return tail || null;
}

/**
 * Collapses a person slug to first and last name token, dropping middle names
 * and single-letter initials. Without this, `dept-ysph-megan-l-ranney` and
 * `ysm-faculty-megan-ranney` read as two different people and a merge residue
 * is misreported as a lane with no target at all.
 */
export function firstLastIdentityKey(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split('-').filter((part) => part.length > 1);
  if (parts.length < 2) return null;
  return `${parts[0]}-${parts[parts.length - 1]}`;
}

export function identityCandidatesForSlug(slug: string): string[] {
  const candidates: string[] = [];
  const tail = personSlugTail(slug);
  if (tail) {
    candidates.push(`exact:${tail}`);
    const firstLast = firstLastIdentityKey(tail);
    if (firstLast) candidates.push(`firstlast:${firstLast}`);
  }
  return candidates;
}

export function identityCandidatesForOrphanKey(entityKey: string, observedName: unknown): string[] {
  const candidates = identityCandidatesForSlug(entityKey);
  const nameSlug = slugifyIdentityText(observedName).replace(ENTITY_NAME_SUFFIX, '');
  if (nameSlug) {
    candidates.push(`exact:${nameSlug}`);
    const firstLast = firstLastIdentityKey(nameSlug);
    if (firstLast) candidates.push(`firstlast:${firstLast}`);
  }
  return [...new Set(candidates)];
}

export function identityCandidatesForPersonName(displayName: unknown): string[] {
  const nameSlug = slugifyIdentityText(displayName);
  if (!nameSlug) return [];
  const candidates = [`exact:${nameSlug}`];
  const firstLast = firstLastIdentityKey(nameSlug);
  if (firstLast) candidates.push(`firstlast:${firstLast}`);
  return candidates;
}

export interface OrphanObservationKeyFacts {
  entityKey: string;
  liveObservationCount: number;
  sourceNames: string[];
  enabledSourceNames: Set<string>;
  emittingRunStatuses: string[];
  observedEntityIdCount: number;
  liveEntityIdSlugs: string[];
  observedName?: unknown;
  observedEntityType?: unknown;
  leadTargetSlugs: string[];
  nameMatchTargetSlugs: string[];
  personKnown: boolean;
}

export interface OrphanObservationKeyClassification {
  entityKey: string;
  category: OrphanObservationKeyCategory;
  remedy: OrphanObservationKeyRemedy;
  materializationReach: MaterializationReach;
  liveObservationCount: number;
  targetSlugs: string[];
  sourceNames: string[];
}

export const ORPHAN_CATEGORY_REMEDY: Record<
  OrphanObservationKeyCategory,
  OrphanObservationKeyRemedy
> = {
  ENTITY_ID_RESOLVES_LIVE: 'backfill_redirect',
  ENTITY_ID_DEAD_NO_REDIRECT: 'retire_observations',
  RETIRED_ENTITY_TYPE: 'leave_to_owning_lane',
  LEAD_RESOLVES_TO_LIVE_ENTITY: 'review_per_key',
  NAME_MATCHES_LIVE_ENTITY: 'review_per_key',
  NO_MINT_INTENT_ENRICHMENT_ONLY: 'leave_to_owning_lane',
  RETIRED_SOURCE_ONLY: 'retire_observations',
  PERSON_KNOWN_NO_RESEARCH_HOME: 'drive_materialization',
  NO_TARGET_AT_ALL: 'drive_materialization',
};

/**
 * A key is only credited as having been offered to a materializer when at least
 * one run that emitted its live observations reached `success`. `materializeFromRun`
 * is called after the orchestrator returns, so `failure` and `running` runs never
 * reach it.
 */
export function materializationReachForRunStatuses(statuses: string[]): MaterializationReach {
  return statuses.includes('success') ? 'materialize_ran' : 'never_materialized';
}

export function classifyOrphanObservationKey(
  facts: OrphanObservationKeyFacts,
): OrphanObservationKeyClassification {
  const base = {
    entityKey: facts.entityKey,
    materializationReach: materializationReachForRunStatuses(facts.emittingRunStatuses),
    liveObservationCount: facts.liveObservationCount,
    sourceNames: [...facts.sourceNames].sort(),
  };
  const decide = (
    category: OrphanObservationKeyCategory,
    targetSlugs: string[] = [],
  ): OrphanObservationKeyClassification => ({
    ...base,
    category,
    remedy: ORPHAN_CATEGORY_REMEDY[category],
    targetSlugs: [...new Set(targetSlugs)].sort(),
  });

  if (facts.liveEntityIdSlugs.length > 0) {
    return decide('ENTITY_ID_RESOLVES_LIVE', facts.liveEntityIdSlugs);
  }
  if (facts.observedEntityIdCount > 0) {
    return decide('ENTITY_ID_DEAD_NO_REDIRECT');
  }
  if (RETIRED_OBSERVED_ENTITY_TYPES.has(String(facts.observedEntityType))) {
    return decide('RETIRED_ENTITY_TYPE');
  }
  if (facts.leadTargetSlugs.length > 0) {
    return decide('LEAD_RESOLVES_TO_LIVE_ENTITY', facts.leadTargetSlugs);
  }
  if (facts.nameMatchTargetSlugs.length > 0) {
    return decide('NAME_MATCHES_LIVE_ENTITY', facts.nameMatchTargetSlugs);
  }
  if (!hasMintIntent(facts)) {
    return decide('NO_MINT_INTENT_ENRICHMENT_ONLY');
  }
  if (!facts.sourceNames.some((source) => facts.enabledSourceNames.has(source))) {
    return decide('RETIRED_SOURCE_ONLY');
  }
  if (facts.personKnown) {
    return decide('PERSON_KNOWN_NO_RESEARCH_HOME');
  }
  return decide('NO_TARGET_AT_ALL');
}

function hasMintIntent(facts: OrphanObservationKeyFacts): boolean {
  const name = typeof facts.observedName === 'string' ? facts.observedName.trim() : '';
  const entityType =
    typeof facts.observedEntityType === 'string' ? facts.observedEntityType.trim() : '';
  return Boolean(name) && Boolean(entityType);
}

export interface OrphanObservationKeySummaryBucket {
  keys: number;
  liveObservations: number;
  remedy: OrphanObservationKeyRemedy;
  neverMaterializedKeys: number;
  exampleKeys: string[];
}

export interface OrphanObservationKeySummary {
  keys: number;
  liveObservations: number;
  neverMaterializedKeys: number;
  neverMaterializedLiveObservations: number;
  byCategory: Record<string, OrphanObservationKeySummaryBucket>;
  bySource: Record<string, Record<string, number>>;
}

const EXAMPLES_PER_CATEGORY = 10;

export function summarizeOrphanObservationKeys(
  classifications: OrphanObservationKeyClassification[],
): OrphanObservationKeySummary {
  const summary: OrphanObservationKeySummary = {
    keys: 0,
    liveObservations: 0,
    neverMaterializedKeys: 0,
    neverMaterializedLiveObservations: 0,
    byCategory: {},
    bySource: {},
  };

  for (const row of classifications) {
    summary.keys += 1;
    summary.liveObservations += row.liveObservationCount;
    const neverMaterialized = row.materializationReach === 'never_materialized';
    if (neverMaterialized) {
      summary.neverMaterializedKeys += 1;
      summary.neverMaterializedLiveObservations += row.liveObservationCount;
    }

    const bucket = (summary.byCategory[row.category] ||= {
      keys: 0,
      liveObservations: 0,
      remedy: row.remedy,
      neverMaterializedKeys: 0,
      exampleKeys: [],
    });
    bucket.keys += 1;
    bucket.liveObservations += row.liveObservationCount;
    if (neverMaterialized) bucket.neverMaterializedKeys += 1;
    if (bucket.exampleKeys.length < EXAMPLES_PER_CATEGORY) bucket.exampleKeys.push(row.entityKey);

    for (const source of row.sourceNames) {
      const perSource = (summary.bySource[source] ||= {});
      perSource[row.category] = (perSource[row.category] || 0) + 1;
    }
  }

  return summary;
}
