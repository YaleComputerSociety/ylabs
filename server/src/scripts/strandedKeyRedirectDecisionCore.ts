/**
 * Whether a stranded observation key should be re-keyed onto the live entity it
 * resolves to, have its observations retired, or be left alone (#2405).
 *
 * A redirect is not an inert pointer. `materializeEntity` resolves
 * `research_entity_redirects` before projecting and then writes the stranded
 * observations INTO the canonical, so a redirect turns a dormant key into an
 * active writer. Backfilling one for a key whose values disagree with the
 * canonical therefore CREATES a graft instead of closing one - the #2378
 * mechanism, and the opposite of what #2379 fixed.
 *
 * So every branch that is not provably safe declines to act. A wrongly retired
 * key loses acquired evidence; a wrongly redirected one rewrites a live,
 * student-visible record. Both failures are silent, which is why the decision is
 * per key and reviewed before any write.
 */

import {
  isSynthesizedResearchHomeName,
  personNamesDenoteSamePerson,
} from '../utils/foreignLabWebsiteRetarget';
import {
  isPersonScopedResearchEntity,
  isPlaceholderEntityName,
} from '../utils/researchHomeNameIdentityAuthority';

export const STRANDED_KEY_DECISIONS = [
  'BACKFILL_REDIRECT',
  'RETIRE_OBSERVATIONS',
  'LEAVE_ALONE',
] as const;

export type StrandedKeyDecision = (typeof STRANDED_KEY_DECISIONS)[number];

export type StrandedKeyReason =
  | 'TARGET_IS_ARCHIVED'
  | 'MULTIPLE_LIVE_TARGETS'
  | 'TARGET_LEAD_UNRESOLVED'
  | 'TARGET_LEAD_IS_A_DIFFERENT_PERSON'
  | 'TARGET_IS_AN_ORGANIZATION_NOT_A_PERSON_HOME'
  | 'TARGET_LEAD_MATCH_NEEDS_CONFIRMATION'
  | 'A_SEPARATE_RECORD_OF_THE_SAME_PERSON'
  | 'WOULD_REPLACE_A_STATED_NAME_WITH_A_TEMPLATE'
  | 'PLACEHOLDER_MINT_INTENT'
  | 'ADDS_EVIDENCE_THE_TARGET_LACKS'
  | 'AGREES_WITH_TARGET'
  | 'WOULD_OVERWRITE_SERVED_COPY';

/** Field-level comparison of a stranded value against the canonical's stored one. */
export type StrandedFieldVerdict = 'AGREES' | 'FILLS_GAP' | 'DIFFERS';

export interface StrandedFieldComparison {
  field: string;
  verdict: StrandedFieldVerdict;
  strandedValue: unknown;
  targetValue: unknown;
}

export interface StrandedKeyTarget {
  slug: string;
  name?: unknown;
  entityType?: unknown;
  kind?: unknown;
  leadName?: unknown;
  studentVisibilityTier?: unknown;
}

export interface StrandedKeyDecisionInput {
  entityKey: string;
  keyPersonName?: unknown;
  strandedName?: unknown;
  strandedEntityType?: unknown;
  targets: StrandedKeyTarget[];
  fieldComparisons: StrandedFieldComparison[];
}

export interface StrandedKeyDecisionResult {
  decision: StrandedKeyDecision;
  reason: StrandedKeyReason;
  targetSlug?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

// A person's own research home is the weaker shape; a LAB is the stronger one. A
// FACULTY_RESEARCH_AREA key redirected into a live LAB would rewrite that LAB's
// entityType and kind downward, which is a visible regression on a served record.
// Fields a student actually reads. A redirect that changes one of these is a
// visible rewrite of a live record, however much it contributes elsewhere.
const SERVED_COPY_FIELDS = new Set([
  'name',
  'entityType',
  'kind',
  'fullDescription',
  'shortDescription',
  'websiteUrl',
  // `school` and `departments` are the browse facet values, so overwriting them moves
  // the target between facets even though no card copy changes.
  'school',
  'departments',
]);

export type PersonIdentityVerdict = 'SAME' | 'DIFFERENT' | 'UNCERTAIN';

// A hyphenated or compressed given name ("Shi-Yi" vs "shiyi"), a middle initial
// dropped by one spelling, and a familiar form ("Ted" for "Theodore", "Candie" for
// "Candice") all denote the same person while failing a full-token match. Measured
// on this population, 7 of 10 hand-read rejections were one of those three rather
// than a real mismatch, so the shape is reported as UNCERTAIN for a human to
// confirm instead of being silently classified either way.
function identityShapes(value: unknown): string[] {
  const raw = textValue(value).toLowerCase();
  return [raw, raw.replace(/-/g, ' '), raw.replace(/-/g, '')];
}

export function comparePersonIdentity(left: unknown, right: unknown): PersonIdentityVerdict {
  for (const leftShape of identityShapes(left)) {
    for (const rightShape of identityShapes(right)) {
      if (personNamesDenoteSamePerson(leftShape, rightShape)) return 'SAME';
    }
  }
  const leftSurname = surnameOf(left);
  const rightSurname = surnameOf(right);
  if (!leftSurname || !rightSurname) return 'UNCERTAIN';
  return leftSurname === rightSurname ? 'UNCERTAIN' : 'DIFFERENT';
}

function surnameOf(value: unknown): string {
  const tokens = textValue(value)
    .toLowerCase()
    .replace(/-/g, '')
    .match(/[a-z]+/g);
  return tokens && tokens.length > 0 ? tokens[tokens.length - 1] : '';
}

const ENTITY_TYPE_STRENGTH: Record<string, number> = {
  LAB: 3,
  FACULTY_PROJECT: 2,
  FACULTY_RESEARCH_AREA: 1,
  INDIVIDUAL_RESEARCH: 1,
};

function entityTypeStrength(value: unknown): number {
  return ENTITY_TYPE_STRENGTH[textValue(value).toUpperCase()] ?? 0;
}

/**
 * Whether re-keying would push a weaker `entityType` onto the target.
 *
 * `dept-ysph-christian-tschudi` asserts `FACULTY_RESEARCH_AREA`/`individual` while
 * `nih-pi-christian-tschudi` is a `student_ready` `LAB`; the same person, but the
 * stranded row is the thinner record and must not overwrite the richer one.
 */
export function wouldDowngradeEntityType(
  strandedEntityType: unknown,
  target: StrandedKeyTarget,
): boolean {
  const stranded = entityTypeStrength(strandedEntityType);
  const canonical = entityTypeStrength(target.entityType);
  return stranded > 0 && canonical > 0 && stranded < canonical;
}

/**
 * Whether re-keying would replace a name the target actually states with a
 * scraper template.
 *
 * `ysm-statmethods` states "Statistical Methods in Psychiatry and Related
 * Fields..."; `dept-ysph-ralitza-gueorguieva` asserts "Ralitza Gueorguieva Faculty
 * Research". Both are that person's, but only one is a name.
 */
export function wouldReplaceStatedNameWithTemplate(
  strandedName: unknown,
  target: StrandedKeyTarget,
): boolean {
  const stranded = textValue(strandedName);
  if (!stranded) return false;
  if (!isSynthesizedResearchHomeName(stranded, target.leadName)) return false;
  return !isSynthesizedResearchHomeName(target.name, target.leadName);
}

/**
 * The decision for one stranded key.
 *
 * Identity is verified against the target's RESOLVED LEAD, never against the slug
 * match that selected it: #2401 pairs keys on a first-and-last identity that drops
 * middle names, which is what makes `dept-ysph-megan-l-ranney` and
 * `ysm-faculty-megan-ranney` the same person and would equally pair two distinct
 * people who share both names. A target with no resolved lead cannot be verified at
 * all and is therefore left alone rather than trusted (#2384).
 */
export function decideStrandedKey(input: StrandedKeyDecisionInput): StrandedKeyDecisionResult {
  if (input.targets.length === 0) {
    return { decision: 'LEAVE_ALONE', reason: 'TARGET_IS_ARCHIVED' };
  }
  if (input.targets.length > 1) {
    return { decision: 'LEAVE_ALONE', reason: 'MULTIPLE_LIVE_TARGETS' };
  }
  const target = input.targets[0];
  // A person who DIRECTS a center is not that center. `dept-ysph-peter-peduzzi`
  // resolves to "Yale Center for Analytical Sciences" because Peduzzi leads it, but
  // his person row is not the centre's row: re-keying would graft a person onto an
  // organization, and retiring would destroy the only record of the person. Judged on
  // the target's own scope rather than on an entityType denylist, so a scope this
  // does not enumerate still lands on the safe side.
  if (!isPersonScopedResearchEntity({ entityType: target.entityType, kind: target.kind })) {
    return {
      decision: 'LEAVE_ALONE',
      reason: 'TARGET_IS_AN_ORGANIZATION_NOT_A_PERSON_HOME',
      targetSlug: target.slug,
    };
  }
  const leadName = textValue(target.leadName);
  if (!leadName) {
    return { decision: 'LEAVE_ALONE', reason: 'TARGET_LEAD_UNRESOLVED', targetSlug: target.slug };
  }
  const identity = comparePersonIdentity(leadName, input.keyPersonName);
  if (identity === 'DIFFERENT') {
    return {
      decision: 'LEAVE_ALONE',
      reason: 'TARGET_LEAD_IS_A_DIFFERENT_PERSON',
      targetSlug: target.slug,
    };
  }
  if (identity === 'UNCERTAIN') {
    return {
      decision: 'LEAVE_ALONE',
      reason: 'TARGET_LEAD_MATCH_NEEDS_CONFIRMATION',
      targetSlug: target.slug,
    };
  }

  if (isPlaceholderEntityName(input.strandedName)) {
    return {
      decision: 'RETIRE_OBSERVATIONS',
      reason: 'PLACEHOLDER_MINT_INTENT',
      targetSlug: target.slug,
    };
  }
  // Deliberately LEAVE_ALONE rather than RETIRE. A thinner `entityType` on the
  // stranded row does not make its evidence worse: `dept-ysph-josephine-hoh` carries
  // a real YSPH description, school, departments and website for the same person
  // that `ysm-hoh` does not have. Redirecting would overwrite a served LAB with a
  // person row; retiring would destroy acquired evidence the issue warns about
  // losing. These are candidates for their OWN entity (the #2404 materialization
  // lane), which is a third outcome neither remedy in this issue expresses.
  if (wouldDowngradeEntityType(input.strandedEntityType, target)) {
    return {
      decision: 'LEAVE_ALONE',
      reason: 'A_SEPARATE_RECORD_OF_THE_SAME_PERSON',
      targetSlug: target.slug,
    };
  }
  if (wouldReplaceStatedNameWithTemplate(input.strandedName, target)) {
    return {
      decision: 'RETIRE_OBSERVATIONS',
      reason: 'WOULD_REPLACE_A_STATED_NAME_WITH_A_TEMPLATE',
      targetSlug: target.slug,
    };
  }

  // DIFFERS on a served field outranks FILLS_GAP anywhere else, because a redirect
  // writes every field at once. `ysm-faculty-c-shan-xu` would contribute the
  // researchAreas its target lacks AND overwrite that target's description with
  // "Google Scholar: Profile Conventional FIB-SEM..." - a net loss bought with a gain.
  const overwritesServedCopy = input.fieldComparisons.some(
    (comparison) => comparison.verdict === 'DIFFERS' && SERVED_COPY_FIELDS.has(comparison.field),
  );
  if (overwritesServedCopy) {
    return {
      decision: 'LEAVE_ALONE',
      reason: 'WOULD_OVERWRITE_SERVED_COPY',
      targetSlug: target.slug,
    };
  }
  if (input.fieldComparisons.some((comparison) => comparison.verdict === 'FILLS_GAP')) {
    return {
      decision: 'BACKFILL_REDIRECT',
      reason: 'ADDS_EVIDENCE_THE_TARGET_LACKS',
      targetSlug: target.slug,
    };
  }
  return { decision: 'BACKFILL_REDIRECT', reason: 'AGREES_WITH_TARGET', targetSlug: target.slug };
}

export interface StrandedKeyDecisionBucket {
  keys: number;
  liveObservations: number;
}

export function summarizeStrandedKeyDecisions(
  rows: Array<{
    decision: StrandedKeyDecision;
    reason: StrandedKeyReason;
    liveObservationCount: number;
  }>,
): Record<string, StrandedKeyDecisionBucket> {
  const buckets: Record<string, StrandedKeyDecisionBucket> = {};
  for (const row of rows) {
    const label = `${row.decision}:${row.reason}`;
    const bucket = (buckets[label] ||= { keys: 0, liveObservations: 0 });
    bucket.keys += 1;
    bucket.liveObservations += row.liveObservationCount;
  }
  return buckets;
}
