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
 * So: revert the PAIR, never one field - and revert it in both stores. Marking the
 * observations superseded is not sufficient on its own, because `shortDescription`
 * is not in `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`: the projected card
 * outlives the observation that produced it, the guard keeps comparing every
 * replacement full against evidence that is already gone, and the record never
 * converges however many times it is re-materialized.
 * `planDescriptionPairRollback` names those entity-document paths in
 * `entityFieldsToUnset`.
 *
 * ## Reverting to the prior pair is NOT automatically safe
 *
 * Restoring both fields to their pre-rollback values fails when the prior pair was
 * manufactured as a duplicate: what makes such a pair unstable is not the
 * duplication itself but how its two members are attributed. So a restored pair is
 * only safe when the pair AS IT WILL BE ATTRIBUTED passes
 * `describeDescriptionPairRisk`. A `full-restates-short` result means the pair is
 * unstable and the fix belongs upstream in the emitting source, not in a backfill.
 *
 * `docs/scraper-deployment-runbook.md` (`Rollback` -> `Rolling back a written
 * description`) owns the operator procedure, the incident this contract came from,
 * and the emitter shape that manufactures an unsafe pair.
 */
import type { ObservedEntityType } from '../models/observation';
import { observationEntityIdentityFilter } from '../scrapers/observationStore';
import {
  entityDocShortDescriptionForRestatementGuard,
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
  entityKey?: string | null;
  entityId?: unknown;
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
  /**
   * Entity-document paths the same operation must `$unset` before re-materializing.
   *
   * Superseding the observations is only half the rollback. `shortDescription` is
   * not in `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`, so the projected card
   * outlives the observation that produced it: the guard keeps comparing every
   * replacement full against a short whose evidence is already gone, and the
   * record never converges. Clearing the projection lets the materializer
   * re-derive it from whichever full survives.
   */
  entityFieldsToUnset: readonly string[];
  /** Set when nothing needs doing, with the reason. */
  skipped?: 'no-active-observations';
}

const PROJECTED_SHORT_DESCRIPTION_PATHS = [
  'shortDescription',
  'fieldProvenance.shortDescription',
] as const;

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
      entityFieldsToUnset: [],
      skipped: 'no-active-observations',
    };
  }
  return {
    entity: input.entity,
    fieldsToSupersede,
    shortWrittenElsewhere,
    entityFieldsToUnset: [...PROJECTED_SHORT_DESCRIPTION_PATHS],
  };
}

export type DescriptionPairRisk =
  | 'empty-full-description'
  | 'full-restates-short'
  | 'full-description-not-useful';

/**
 * The post-rollback assertion. A rollback is only complete when the entity serves
 * a non-empty description again, so this is what a caller checks after
 * re-materializing rather than trusting the supersede count.
 *
 * The three states are exactly the negations of the materializer's
 * `winnerFullUseful` guard, evaluated with the same two predicates the guard uses
 * and against the same short the guard uses: pass the served entity document,
 * including `fieldProvenance`, because a short the materializer itself derived
 * from the full is excluded from the comparison and reading the raw stored short
 * instead reports every self-derived card as a restatement. Re-specifying either
 * predicate, or the short selection, would let a repair pass a bar the live
 * materializer does not honour - or fail one it does not apply.
 *
 * Restatement is reported ahead of unusefulness because it is the one state the
 * materializer actively blanks, and because it is the state that says the fix
 * belongs upstream in the emitting source rather than in a backfill.
 *
 * Returns the reason it is unsafe, or null when the pair is serviceable.
 */
export function describeDescriptionPairRisk(input: {
  fullDescription?: unknown;
  shortDescription?: unknown;
  fieldProvenance?: unknown;
  researchAreas?: unknown;
  entityType?: unknown;
}): DescriptionPairRisk | null {
  const full = textValue(input.fullDescription);
  const short = textValue(entityDocShortDescriptionForRestatementGuard(input));
  if (!full) return 'empty-full-description';
  if (isFullDescriptionRestatementOfShortDescription(full, short)) return 'full-restates-short';
  if (!fullDescriptionQuality(full, input.researchAreas, input.entityType).isUseful) {
    return 'full-description-not-useful';
  }
  return null;
}
