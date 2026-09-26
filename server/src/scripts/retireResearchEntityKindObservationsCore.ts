/**
 * Retirement of the research-entity `kind` observation field.
 *
 * `derivedResearchGroupKind` resolves `kind` from the observed-or-stored `entityType`
 * and never reads an observed `kind`, so sixteen lanes wrote a field every run that no
 * consumer read. #3362 measured 9,139 live rows over 8,249 keys; 1,175 of those keys
 * held their only type claim in the retired field, and a re-scrape of every lane that
 * still produces them recovered 59, because the rest are keys the lanes no longer mint.
 *
 * Retirement is safe on that measurement rather than on the orphan count reaching zero:
 * the claim never set a field, no scrape can re-establish it, and every existing row
 * already holds a stored `entityType`.
 */
export const RETIRED_KIND_FIELD = 'kind';

export const RETIRE_KIND_ROLLBACK_REASON =
  'research-entity kind is derived from entityType and no consumer reads an observed kind (#3362, #3378)';

export const RETIRE_KIND_SCRIPT_NAME = 'observations:retire-research-entity-kind';

export interface RetiredKindAssertion {
  entityKey: string;
  value: string;
  sourceName: string;
  observedAt: string;
  hadEntityTypeAssertion: boolean;
  entityRowExists: boolean;
}

export interface RetireKindCounts {
  liveBefore: number;
  liveAfter: number;
  superseded: number;
  keysRecorded: number;
  keysWithNoEntityRow: number;
  keysWhoseOnlyTypeClaimThisWas: number;
}

/**
 * The record kept before anything is superseded. For a key with no `research_entities`
 * row this is the only remaining trace of what the lane asserted, so it is built from
 * the observations themselves rather than from the entity.
 */
export function buildRetiredKindRecord(input: {
  observations: ReadonlyArray<{
    entityKey?: unknown;
    value?: unknown;
    sourceName?: unknown;
    observedAt?: unknown;
  }>;
  keysWithEntityTypeAssertion: ReadonlySet<string>;
  keysWithEntityRow: ReadonlySet<string>;
}): RetiredKindAssertion[] {
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  return input.observations
    .map((observation) => {
      const entityKey = text(observation.entityKey);
      return {
        entityKey,
        value: text(observation.value),
        sourceName: text(observation.sourceName),
        observedAt:
          observation.observedAt instanceof Date
            ? observation.observedAt.toISOString()
            : text(observation.observedAt),
        hadEntityTypeAssertion: input.keysWithEntityTypeAssertion.has(entityKey),
        entityRowExists: input.keysWithEntityRow.has(entityKey),
      };
    })
    .filter((entry) => entry.entityKey)
    .sort((left, right) => left.entityKey.localeCompare(right.entityKey));
}

/**
 * A retirement that left live rows behind has not retired the field, and one that
 * removed a type from a row has done harm rather than housekeeping.
 */
export function assertKindFullyRetired(counts: {
  liveAfter: number;
  servedRowsMissingAStoredType: number;
}): void {
  if (counts.liveAfter !== 0) {
    throw new Error(
      `${RETIRE_KIND_SCRIPT_NAME} left ${counts.liveAfter} live kind observation(s); the field is not retired.`,
    );
  }
  if (counts.servedRowsMissingAStoredType !== 0) {
    throw new Error(
      `${RETIRE_KIND_SCRIPT_NAME} would leave ${counts.servedRowsMissingAStoredType} served row(s) with no stored entityType; refusing.`,
    );
  }
}
