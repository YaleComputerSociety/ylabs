/**
 * Pure planning and outcome classification for the corpus-wide catch-up
 * materialize (issue #2403).
 *
 * `materializeFromRun` is the only entry point that enumerates observations and
 * it is scoped to a single `scrapeRunId`, invoked after `orchestrator.run`
 * returns. A scraper that throws (run left `failure`) or a process killed
 * mid-run (run left `running`) never reaches that call, and nothing else
 * re-enumerates observations by key: `research-entity:rematerialize` selects by
 * `research_entities.slug` and reports `found: false` for a key with no entity
 * row, and the synthesis lanes enumerate existing entities. So an interrupted
 * run's observations stay live and unsuperseded forever, having never been
 * offered to a materializer, and no later sweep revisits them.
 *
 * This module supplies the missing enumeration axis: by key, over the corpus,
 * independent of any run.
 *
 * The eligible set is DERIVED from `ORPHAN_CATEGORY_REMEDY` rather than restated
 * here. Restating it would make this a second owner of the same classification
 * and let the two drift silently, which is the shape catalogued in #2421.
 */
import {
  ORPHAN_CATEGORY_REMEDY,
  type OrphanObservationKeyCategory,
} from './orphanObservationKeyAuditCore';

/**
 * A key is only offered to the materializer when its category's remedy is
 * `drive_materialization`. The other remedies are deliberately excluded:
 * `leave_to_owning_lane` covers enrichment lanes that emit no `name`/`entityType`
 * and fail closed by design, `retire_observations` covers keys whose target is
 * provably gone, and `backfill_redirect`/`review_per_key` need a redirect or a
 * per-key decision rather than a mint.
 */
export function isCatchUpEligibleCategory(category: string): boolean {
  return (
    ORPHAN_CATEGORY_REMEDY[category as OrphanObservationKeyCategory] === 'drive_materialization'
  );
}

export const CATCH_UP_OUTCOMES = [
  'created',
  'updated_existing',
  'skipped_by_materializer_guard',
  'no_fields_written',
  'error',
] as const;

export type CatchUpOutcome = (typeof CATCH_UP_OUTCOMES)[number];

export interface CatchUpMaterializeResultLike {
  created?: boolean;
  skipped?: string;
  fieldsWritten?: number;
  entityId?: string;
}

/**
 * A guard skip and a zero-field write are reported separately on purpose. A skip
 * is the materializer deciding this key must not mint (retired type, merged into
 * a canonical, name-identity refusal) and is a correct outcome. Zero fields
 * written with no skip reason means the key was offered, accepted, and still
 * produced nothing - that is the case worth investigating, and collapsing the
 * two would hide it.
 */
export function classifyCatchUpOutcome(
  result: CatchUpMaterializeResultLike | null,
  error?: unknown,
): CatchUpOutcome {
  if (error || !result) return 'error';
  if (result.skipped) return 'skipped_by_materializer_guard';
  if (result.created) return 'created';
  if ((result.fieldsWritten ?? 0) > 0) return 'updated_existing';
  return 'no_fields_written';
}

export interface CatchUpKeyPlan {
  entityKey: string;
  category: string;
  liveObservationCount: number;
  materializationReach: string;
}

export interface CatchUpKeyReport extends CatchUpKeyPlan {
  outcome: CatchUpOutcome;
  skippedReason?: string;
  entityId?: string;
  fieldsWritten: number;
  plannedFieldCount?: number;
  /**
   * A dry run that only reports "would mint" is not reviewable: this command
   * creates research entities, and whether a given mint is wanted depends on what
   * it would be called and what type it would carry. A YSPH directory row for a
   * postdoc and one for a professor are both `created` here and only one is a
   * research home a student should ever reach.
   */
  plannedName?: string;
  plannedEntityType?: string;
  errorMessage?: string;
}

export function plannedFieldSummary(plannedSet: Record<string, unknown> | undefined): {
  plannedFieldCount: number;
  plannedName?: string;
  plannedEntityType?: string;
} {
  const planned = plannedSet ?? {};
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  return {
    plannedFieldCount: Object.keys(planned).length,
    plannedName: text(planned.name),
    plannedEntityType: text(planned.entityType),
  };
}

export interface CatchUpArgs {
  apply: boolean;
  confirmed: boolean;
  limit: number;
  output?: string;
  onlyKeys: string[];
  /**
   * Restricts the run to one eligible category. `PERSON_KNOWN_NO_RESEARCH_HOME`
   * is the cohort that needs its own reviewed batch: the person already exists as
   * a `Researcher` but leads nothing, so minting there creates a research home
   * the corpus has so far withheld.
   */
  categories: string[];
}

export function selectCatchUpCategories(requested: string[]): string[] {
  const unknown = requested.filter((category) => !isCatchUpEligibleCategory(category));
  if (unknown.length > 0) {
    throw new Error(
      `--category accepts only catch-up eligible categories; got ${unknown.join(', ')}`,
    );
  }
  return requested;
}

export const CATCH_UP_CONFIRM_FLAG = '--confirm-catch-up-materialize';
export const DEFAULT_CATCH_UP_LIMIT = 100;

/**
 * Apply requires the confirm flag as well as `--apply`, matching every other
 * guarded write script. The limit is bounded by default because this walks the
 * whole stranded population and each key is a separate materialize with its own
 * writes; an unbounded first run is not reviewable.
 */
export function assertCatchUpApplyArgs(args: Pick<CatchUpArgs, 'apply' | 'confirmed'>): void {
  if (args.apply && !args.confirmed) {
    throw new Error(`--apply requires ${CATCH_UP_CONFIRM_FLAG}`);
  }
}

export interface CatchUpSummary {
  eligibleKeys: number;
  attemptedKeys: number;
  liveObservationsOnAttemptedKeys: number;
  byOutcome: Record<string, number>;
  byCategory: Record<string, Record<string, number>>;
  skippedReasons: Record<string, number>;
}

export function summarizeCatchUpRun(
  reports: CatchUpKeyReport[],
  eligibleKeys: number,
): CatchUpSummary {
  const summary: CatchUpSummary = {
    eligibleKeys,
    attemptedKeys: reports.length,
    liveObservationsOnAttemptedKeys: 0,
    byOutcome: {},
    byCategory: {},
    skippedReasons: {},
  };

  for (const report of reports) {
    summary.liveObservationsOnAttemptedKeys += report.liveObservationCount;
    summary.byOutcome[report.outcome] = (summary.byOutcome[report.outcome] || 0) + 1;
    const perCategory = (summary.byCategory[report.category] ||= {});
    perCategory[report.outcome] = (perCategory[report.outcome] || 0) + 1;
    if (report.skippedReason) {
      summary.skippedReasons[report.skippedReason] =
        (summary.skippedReasons[report.skippedReason] || 0) + 1;
    }
  }

  return summary;
}
