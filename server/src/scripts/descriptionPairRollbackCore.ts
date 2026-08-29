/**
 * Rolling back a written `fullDescription` requires reverting `shortDescription`
 * in the same operation.
 *
 * The two fields are coupled through a guard in the materializer. The
 * `winnerFullUseful` check in `server/src/scrapers/entityMaterializer.ts` only
 * accepts a resolved winner when
 *
 *   fullDescriptionQuality(winnerFull).isUseful &&
 *   !isFullDescriptionRestatementOfShortDescription(winnerFull, currentShort)
 *
 * so a winner that restates the stored short is REJECTED, and the ranked walk can
 * terminate having written nothing. The guard only ever clears `fullDescription`,
 * which is why the failure is invisible to the visibility gate: `shortDescription`
 * survives, the entity still looks complete, and the tier stays `student_ready`
 * while the detail page has no prose to serve.
 *
 * This is not hypothetical. Superseding 99 synthesized `fullDescription`
 * observations without touching the `shortDescription` values that had been
 * DERIVED from them left 19 entities with an empty description, 14 of them served
 * and 404ing to students, while a perfectly good alternative sat active and unused
 * (`faculty-research-area-james-e-hansen` had a 0.55 `lab-microsite-undergrad-llm`
 * row the whole time).
 *
 * So: revert the PAIR, never one field.
 *
 * ## Reverting to the prior pair is NOT automatically safe
 *
 * The obvious remedy - restore both fields to their pre-rollback values, on the
 * reasoning that the prior pair was self-consistent - fails when the prior pair
 * was itself manufactured identical. The `studentReadyDescription` emit block in
 * `server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts` pushes one
 * string as `fullDescription` at 0.55 and, when `isCardLengthDescription` holds,
 * pushes THE SAME STRING as `shortDescription` at 0.55. Both are
 * observation-backed, so restoring them recreates the exact condition the guard
 * blanks: 2,723 entities carry such a pair, and 216 have already been silently
 * emptied by this path.
 *
 * Therefore no data repair on an affected row can hold until the emitting source
 * stops producing the duplicate. `describeDescriptionPairRisk` exists to detect
 * that state before a repair is attempted: a `full-restates-short` result means
 * the pair is unstable and the fix belongs upstream, not in a backfill.
 */
import type { ObservedEntityType } from '../models/observation';
import { observationEntityIdentityFilter } from '../scrapers/observationStore';
import {
  fullDescriptionQuality,
  isFullDescriptionRestatementOfShortDescription,
} from '../utils/researchEntityDescriptionQuality';

export const DESCRIPTION_PAIR_FIELDS = ['fullDescription', 'shortDescription'] as const;

export type DescriptionPairField = (typeof DESCRIPTION_PAIR_FIELDS)[number];

/**
 * An entity is addressable by `entityKey`, by `entityId`, or by both, and rows for
 * the same entity are stored under whichever form the emitting run held. Callers
 * pass what they have and the filter matches either form (#2177).
 */
export interface DescriptionPairEntityIdentity {
  entityType: ObservedEntityType;
  entityKey?: string;
  entityId?: string;
}

export interface DescriptionObservationLike {
  entityKey?: string;
  entityId?: string;
  field?: string;
  sourceName?: string;
  value?: unknown;
  superseded?: boolean;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * Filter selecting every description observation a rollback must supersede for one
 * entity: both fields, from the source being rolled back, still active.
 *
 * Scoping to a single field is the mistake this exists to prevent. Throwing on a
 * missing identity is the second: a supersede that silently matches nothing reads
 * as a clean run, and a supersede without an identity clause would match every
 * entity the source ever wrote.
 */
export function descriptionPairObservationFilter(
  input: DescriptionPairEntityIdentity & { sourceName: string },
): Record<string, unknown> {
  const identity = observationEntityIdentityFilter({
    entityKey: input.entityKey,
    entityId: input.entityId,
  });
  if (!identity) {
    throw new Error('descriptionPairObservationFilter requires an entityKey or an entityId');
  }
  return {
    entityType: input.entityType,
    ...identity,
    sourceName: input.sourceName,
    field: { $in: [...DESCRIPTION_PAIR_FIELDS] },
    superseded: { $ne: true },
  };
}

export interface DescriptionPairRollbackPlan {
  entity: DescriptionPairEntityIdentity;
  /** Fields this source actually wrote and that are still active. */
  fieldsToSupersede: DescriptionPairField[];
  /**
   * True when some other source still has an active `shortDescription` that this
   * rollback leaves behind. That short may have been derived from the full text
   * being removed, and the materializer guard compares any replacement full
   * against it, so a re-materialize plus a `describeDescriptionPairRisk` check is
   * mandatory rather than optional. It is independent of whether this source also
   * wrote a short of its own: superseding this source's pair does not remove
   * another source's short.
   */
  shortWrittenElsewhere: boolean;
  /** Set when nothing needs doing, with the reason. */
  skipped?: 'no-active-observations';
}

export function planDescriptionPairRollback(input: {
  entity: DescriptionPairEntityIdentity;
  sourceName: string;
  observations: readonly DescriptionObservationLike[];
}): DescriptionPairRollbackPlan {
  const active = input.observations.filter(
    (observation) =>
      observation.superseded !== true &&
      typeof observation.field === 'string' &&
      (DESCRIPTION_PAIR_FIELDS as readonly string[]).includes(observation.field),
  );
  const fromSource = active.filter((observation) => observation.sourceName === input.sourceName);
  const fieldsToSupersede = (DESCRIPTION_PAIR_FIELDS as readonly DescriptionPairField[]).filter(
    (field) => fromSource.some((observation) => observation.field === field),
  );
  const shortWrittenElsewhere = active.some(
    (observation) =>
      observation.field === 'shortDescription' && observation.sourceName !== input.sourceName,
  );
  if (fieldsToSupersede.length === 0) {
    return {
      entity: input.entity,
      fieldsToSupersede: [],
      shortWrittenElsewhere,
      skipped: 'no-active-observations',
    };
  }
  return { entity: input.entity, fieldsToSupersede, shortWrittenElsewhere };
}

export type DescriptionPairRisk =
  'empty-full-description' | 'full-restates-short' | 'full-description-not-useful';

/**
 * The post-rollback assertion. A rollback is only complete when the entity serves
 * a non-empty description again, so this is what a caller checks after
 * re-materializing rather than trusting the supersede count.
 *
 * The three states are exactly the negations of the materializer's
 * `winnerFullUseful` guard, evaluated with the same two predicates the guard uses.
 * Re-specifying either predicate here would let a repair pass a bar the live
 * materializer does not honour.
 *
 * Restatement is reported ahead of unusefulness because it is the one state the
 * materializer actively blanks, and because it is the state that says the fix
 * belongs upstream in the emitting source rather than in a backfill.
 *
 * Returns the reason it is unsafe, or null when the pair is serviceable.
 */
export function describeDescriptionPairRisk(input: {
  fullDescription: unknown;
  shortDescription: unknown;
  researchAreas?: unknown;
  entityType?: unknown;
}): DescriptionPairRisk | null {
  const full = textValue(input.fullDescription);
  const short = textValue(input.shortDescription);
  if (!full) return 'empty-full-description';
  if (isFullDescriptionRestatementOfShortDescription(full, short)) return 'full-restates-short';
  if (!fullDescriptionQuality(full, input.researchAreas, input.entityType).isUseful) {
    return 'full-description-not-useful';
  }
  return null;
}
