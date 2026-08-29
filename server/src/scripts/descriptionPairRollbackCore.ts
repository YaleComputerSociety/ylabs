/**
 * Rolling back a written `fullDescription` requires reverting `shortDescription`
 * in the same operation.
 *
 * The two fields are coupled through a guard in the materializer. At
 * `entityMaterializer.ts:3182`, a resolved winner is only accepted when
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
 * was itself manufactured identical. `labMicrositeUndergradLLMExtractor.ts:822`
 * pushes one `studentReadyDescription` string as `fullDescription` at 0.55 and,
 * when `isCardLengthDescription` holds, pushes THE SAME STRING as
 * `shortDescription` at 0.55. Both are observation-backed, so restoring them
 * recreates the exact condition the guard blanks: 2,723 entities carry such a
 * pair, and 216 have already been silently emptied by this path.
 *
 * Therefore no data repair on an affected row can hold until the emitting source
 * stops producing the duplicate. `describeDescriptionPairRisk` exists to detect
 * that state before a repair is attempted: a `full-restates-short` result means
 * the pair is unstable and the fix belongs upstream, not in a backfill.
 */

export const DESCRIPTION_PAIR_FIELDS = ['fullDescription', 'shortDescription'] as const;

export type DescriptionPairField = (typeof DESCRIPTION_PAIR_FIELDS)[number];

export interface DescriptionObservationLike {
  entityKey?: string;
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
 * Scoping to a single field is the mistake this exists to prevent.
 */
export function descriptionPairObservationFilter(input: {
  entityKey: string;
  sourceName: string;
}): Record<string, unknown> {
  return {
    entityKey: input.entityKey,
    sourceName: input.sourceName,
    field: { $in: [...DESCRIPTION_PAIR_FIELDS] },
    superseded: { $ne: true },
  };
}

export interface DescriptionPairRollbackPlan {
  entityKey: string;
  /** Fields this source actually wrote and that are still active. */
  fieldsToSupersede: DescriptionPairField[];
  /**
   * True when the source wrote a full description but the short was written by
   * some other source. The short still needs re-deriving, because it may have been
   * derived from the full text being removed, so a re-materialize is mandatory
   * rather than optional.
   */
  shortWrittenElsewhere: boolean;
  /** Set when nothing needs doing, with the reason. */
  skipped?: 'no-active-observations';
}

export function planDescriptionPairRollback(input: {
  entityKey: string;
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
  if (fieldsToSupersede.length === 0) {
    return {
      entityKey: input.entityKey,
      fieldsToSupersede: [],
      shortWrittenElsewhere: false,
      skipped: 'no-active-observations',
    };
  }
  const shortWrittenElsewhere =
    fieldsToSupersede.includes('fullDescription') &&
    !fieldsToSupersede.includes('shortDescription') &&
    active.some(
      (observation) =>
        observation.field === 'shortDescription' && observation.sourceName !== input.sourceName,
    );
  return { entityKey: input.entityKey, fieldsToSupersede, shortWrittenElsewhere };
}

/**
 * The post-rollback assertion. A rollback is only complete when the entity serves
 * a non-empty description again, so this is what a caller checks after
 * re-materializing rather than trusting the supersede count.
 *
 * Returns the reason it is unsafe, or null when the pair is serviceable.
 */
export function describeDescriptionPairRisk(input: {
  fullDescription: unknown;
  shortDescription: unknown;
  isRestatement: (full: string, short: string) => boolean;
}): 'empty-full-description' | 'full-restates-short' | null {
  const full = textValue(input.fullDescription);
  const short = textValue(input.shortDescription);
  if (!full) return 'empty-full-description';
  if (short && input.isRestatement(full, short)) return 'full-restates-short';
  return null;
}
