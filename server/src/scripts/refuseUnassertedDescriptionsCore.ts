/**
 * Decides which stored descriptions their own lane has stopped asserting, from the
 * lane's positive-absence attestation rather than from its silence.
 *
 * The gap. `lab-microsite-description-llm` is the only lane that claims a description
 * is the cited page's own wording, and the claim is checked once, at extraction. After
 * that the content-hash gate stops the lane revisiting the page, and
 * `assertDeclarableRetractionField` refuses every quality-guarded prose field, so
 * field retraction cannot reach a description either. A body written from a page that
 * never carried research prose therefore stays asserted forever. Measured on
 * Development: of 426 served rows whose body came from this lane's person-page arm,
 * the lane still asserts a body for 374 on a forced re-read, so the orphaned class is
 * small - which is the point of measuring it rather than assuming it.
 *
 * Why silence cannot be the trigger. The first measurement of this class read the
 * lane's run log for rows that emitted no `fullDescription`, and 16 of the 52 it found
 * were a fetch failure or a guard keeping the stored value on purpose. A scraper emits
 * nothing both when the page stopped saying something and when a guard refused a value
 * the page still says, and the observation log cannot separate those, which is exactly
 * what #2647 measured going wrong. So only the lane's own `empty` attestation counts,
 * carried as `assertsNoValueFor` on the observation that witnesses the read.
 *
 * Why a refusal and not a retraction. `fieldValueRefusals` is keyed on the VALUE, so
 * it survives re-observation, leaves a better rival free to win at the same field, and
 * is withdrawable through `withdrawnAt`. A lock would remove the field from derivation
 * and freeze the row, which is the failure #2612 catalogued.
 *
 * The three guards, all failing closed and all borrowed from `fieldRetraction`:
 * an attested-empty read in at least `MIN_ATTESTED_EMPTY_READS` distinct runs, so one
 * anomalous parse cannot refuse; the attestation and the stored value must cite the
 * same page, because a lane reading a different URL says nothing about this one; and a
 * corpus-wide ceiling, because a lane whose extraction broke attests emptiness for
 * everything it reads and that persists across runs, so only the fraction separates it
 * from a handful of genuine orphans.
 */
import {
  fieldValueRefusalKey,
  liveFieldValueRefusals,
  type FieldValueRefusalRule,
} from '../utils/researchEntityFieldValueRefusals';

export const UNASSERTED_DESCRIPTION_FIELDS = ['fullDescription', 'shortDescription'] as const;

export const DESCRIPTION_ATTESTING_SOURCE_NAME = 'lab-microsite-description-llm';

/**
 * Two, matching `FIELD_RETRACTION_MIN_COMPLETE_READS` and the two-run rule in
 * `facultyRosterDepartureReconciler`. An LLM lane is not repeatable run to run, so one
 * attested-empty read is a sample rather than an instrument.
 */
export const MIN_ATTESTED_EMPTY_READS = 2;

/**
 * The inverse of the 0.5 fraction `fieldRetraction` uses.
 *
 * The denominator is the rows the LANE READ in those runs, never the rows this pass
 * examined. Over the examined set the guard is a tautology: a targeted `--slug` run
 * examines one row, that row is attested empty by construction, and the fraction is
 * 1.0, so the guard froze every single-row run - which is the shape of a guard that
 * cannot distinguish the thing it is checking for.
 */
export const MAX_ATTESTED_EMPTY_FRACTION = 0.5;

/**
 * Below this the drop guard abstains instead of firing, mirroring the gate's own
 * `minLeadRequiringEntities` floor. A fraction over a handful of reads carries no
 * information about whether an extractor broke, and abstaining is recorded in the
 * report rather than assumed.
 */
export const MIN_LANE_READ_ENTITIES_FOR_DROP_GUARD = 25;

export const UNASSERTED_DESCRIPTION_REFUSAL_RULE: FieldValueRefusalRule =
  'superseded_by_better_source';

export interface AttestedEmptyRead {
  entityKey: string;
  sourceUrl: string;
  runId: string;
}

export interface DescriptionRefusalRow {
  slug: string;
  fullDescription?: string;
  shortDescription?: string;
  fieldProvenance?: unknown;
  fieldValueRefusals?: unknown;
  manuallyLockedFields?: string[];
}

export interface DescriptionRefusalPlan {
  slug: string;
  field: string;
  value: string;
  evidenceUrl: string;
  attestedReadCount: number;
}

export interface DescriptionRefusalSkip {
  slug: string;
  field: string;
  reason:
    | 'no_stored_value'
    | 'not_this_lane'
    | 'attestation_cites_another_page'
    | 'too_few_attested_reads'
    | 'already_refused'
    | 'operator_locked';
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const provenanceEntry = (fieldProvenance: unknown, field: string): Record<string, unknown> => {
  if (fieldProvenance instanceof Map) {
    const entry = fieldProvenance.get(field);
    return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  }
  if (!fieldProvenance || typeof fieldProvenance !== 'object') return {};
  const entry = (fieldProvenance as Record<string, unknown>)[field];
  return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
};

/**
 * Compared on origin plus pathname, dropping a trailing slash and a query string,
 * because the lane records the URL it FETCHED while provenance records the one it was
 * handed, and a redirect or a stripped query between them is not a different page
 * (#3343).
 */
export function sameCitedPage(a: string, b: string): boolean {
  const key = (value: string): string => {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`.toLowerCase();
    } catch {
      return value.trim().toLowerCase();
    }
  };
  const left = key(a);
  return Boolean(left) && left === key(b);
}

export function attestedEmptyReadsByEntity(
  reads: readonly AttestedEmptyRead[],
): Map<string, AttestedEmptyRead[]> {
  const byEntity = new Map<string, AttestedEmptyRead[]>();
  for (const read of reads) {
    const seen = byEntity.get(read.entityKey) ?? [];
    if (seen.some((existing) => existing.runId === read.runId)) continue;
    seen.push(read);
    byEntity.set(read.entityKey, seen);
  }
  return byEntity;
}

export interface DescriptionRefusalPassPlan {
  plans: DescriptionRefusalPlan[];
  skips: DescriptionRefusalSkip[];
  examinedRowCount: number;
  attestedEmptyEntityCount: number;
  laneReadEntityCount: number;
  attestedEmptyFraction: number;
  dropGuard: 'passed' | 'frozen' | 'abstained';
  frozen: boolean;
  frozenReason?: string;
}

export function planUnassertedDescriptionRefusals({
  rows,
  reads,
  laneReadEntityCount,
  minAttestedEmptyReads = MIN_ATTESTED_EMPTY_READS,
  maxAttestedEmptyFraction = MAX_ATTESTED_EMPTY_FRACTION,
  minLaneReadEntitiesForDropGuard = MIN_LANE_READ_ENTITIES_FOR_DROP_GUARD,
}: {
  rows: readonly DescriptionRefusalRow[];
  reads: readonly AttestedEmptyRead[];
  laneReadEntityCount?: number;
  minAttestedEmptyReads?: number;
  maxAttestedEmptyFraction?: number;
  minLaneReadEntitiesForDropGuard?: number;
}): DescriptionRefusalPassPlan {
  const byEntity = attestedEmptyReadsByEntity(reads);
  const examinedRowCount = rows.length;
  const attestedEmptyEntityCount = Array.from(byEntity.values()).filter(
    (entityReads) => entityReads.length >= minAttestedEmptyReads,
  ).length;
  const readPopulation = laneReadEntityCount ?? 0;
  const attestedEmptyFraction =
    readPopulation === 0 ? 0 : attestedEmptyEntityCount / readPopulation;
  const dropGuard: 'passed' | 'frozen' | 'abstained' =
    readPopulation < minLaneReadEntitiesForDropGuard
      ? 'abstained'
      : attestedEmptyFraction > maxAttestedEmptyFraction
        ? 'frozen'
        : 'passed';
  if (dropGuard === 'frozen') {
    return {
      plans: [],
      skips: [],
      examinedRowCount,
      attestedEmptyEntityCount,
      laneReadEntityCount: readPopulation,
      attestedEmptyFraction,
      dropGuard,
      frozen: true,
      frozenReason: `${attestedEmptyEntityCount} of the ${readPopulation} entities the lane read are attested empty, above the ${maxAttestedEmptyFraction} ceiling: this reads as a broken extraction rather than a set of orphaned values, so the pass applies nothing.`,
    };
  }

  const plans: DescriptionRefusalPlan[] = [];
  const skips: DescriptionRefusalSkip[] = [];
  for (const row of rows) {
    const attested = byEntity.get(row.slug) ?? [];
    for (const field of UNASSERTED_DESCRIPTION_FIELDS) {
      const value = textValue((row as unknown as Record<string, unknown>)[field]);
      if (!value) {
        skips.push({ slug: row.slug, field, reason: 'no_stored_value' });
        continue;
      }
      if ((row.manuallyLockedFields ?? []).includes(field)) {
        skips.push({ slug: row.slug, field, reason: 'operator_locked' });
        continue;
      }
      const provenance = provenanceEntry(row.fieldProvenance, field);
      if (textValue(provenance.sourceName) !== DESCRIPTION_ATTESTING_SOURCE_NAME) {
        skips.push({ slug: row.slug, field, reason: 'not_this_lane' });
        continue;
      }
      const citedUrl = textValue(provenance.sourceUrl);
      const matching = attested.filter((read) => sameCitedPage(read.sourceUrl, citedUrl));
      if (matching.length === 0) {
        skips.push({ slug: row.slug, field, reason: 'attestation_cites_another_page' });
        continue;
      }
      if (matching.length < minAttestedEmptyReads) {
        skips.push({ slug: row.slug, field, reason: 'too_few_attested_reads' });
        continue;
      }
      const refusedKey = fieldValueRefusalKey(field, value);
      if (
        liveFieldValueRefusals(row.fieldValueRefusals, field).some(
          (refusal) => refusal.valueKey === refusedKey,
        )
      ) {
        skips.push({ slug: row.slug, field, reason: 'already_refused' });
        continue;
      }
      plans.push({
        slug: row.slug,
        field,
        value,
        evidenceUrl: citedUrl,
        attestedReadCount: matching.length,
      });
    }
  }

  return {
    plans,
    skips,
    examinedRowCount,
    attestedEmptyEntityCount,
    laneReadEntityCount: readPopulation,
    attestedEmptyFraction,
    dropGuard,
    frozen: false,
  };
}
