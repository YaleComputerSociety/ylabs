/**
 * Classifies every `manuallyLockedFields` entry by what the engine would do if the
 * lock were gone, so a lock can be judged against the rule that a wrong value is
 * fixed in the lane rather than on the row.
 *
 * `releaseRevisitableFieldLocksCore` answers a narrower question: may this lock be
 * released today. It refuses to ask the engine at all about a lock that pins a value
 * and records nothing, which is correct for a release and useless for a measurement,
 * because every lock in the corpus predates `fieldLockProvenance` and so records
 * nothing. Measured on Development 2026-09-24: 98 lock instances on 52 rows, all 98
 * reading `unknown`, 87 of them never put to the engine by the release rule. A lock
 * nobody can measure is a lock nobody can retire.
 *
 * So this asks anyway, one lock at a time, through the real `dryRun` projection with
 * `auditFieldLocksIgnoringRecord`. One lock at a time rather than all of a row's at
 * once because a kept lock still pins a value other fields' derivation reads, and the
 * question here is about this lock, not about emptying the row's list.
 *
 * It classifies and never writes. Releasing remains
 * `research-entity:release-field-locks`, which keeps its stricter rule: this audit
 * reports that a lock is inert, and a release still needs the record that says the
 * lock was a workaround. That gap is the finding, not a bug in either script.
 */
import {
  fieldLockGatesNonMaterializerWriteLane,
  fieldLockReleaseAgrees,
  lockedFieldAssertsNoValue,
  type FieldLockReason,
} from '../utils/researchEntityFieldLocks';
import {
  plannedFieldValue,
  projectionNamesField,
  type MaterializerProjectionAnswer,
} from './releaseRevisitableFieldLocksCore';

export type FieldLockOriginVerdict =
  /** The lock holds a reconciler shut, so no projection can answer for it. */
  | 'engine_unanswerable'
  /** The materializer made no plan for the row, so there is no answer to read. */
  | 'engine_made_no_plan'
  /** Nothing would be written and nothing asserts the field: the lock is the only thing keeping the value. */
  | 'unbacked_preserved_value'
  /** The plan omits the field although live observations assert it. */
  | 'silent_with_evidence'
  /** The plan names the field and agrees with what the row already holds. */
  | 'inert'
  /** The plan would remove or empty a value the row holds. */
  | 'engine_would_clear'
  /** The plan would write a different non-empty value. */
  | 'engine_would_replace';

export interface FieldLockOriginInput {
  slug: string;
  field: string;
  storedValue: unknown;
  reason: FieldLockReason;
  liveObservationCount: number;
  answer: MaterializerProjectionAnswer | undefined;
}

export interface FieldLockOriginFinding {
  slug: string;
  field: string;
  reason: FieldLockReason;
  verdict: FieldLockOriginVerdict;
  assertsNoValue: boolean;
  liveObservationCount: number;
  storedValue: unknown;
  engineValue: unknown;
  engineNamedField: boolean;
}

export function classifyFieldLockOrigin(input: FieldLockOriginInput): FieldLockOriginFinding {
  const { slug, field, storedValue, reason, liveObservationCount, answer } = input;
  const assertsNoValue = lockedFieldAssertsNoValue(storedValue);
  const base = {
    slug,
    field,
    reason,
    assertsNoValue,
    liveObservationCount,
    storedValue,
  };
  if (fieldLockGatesNonMaterializerWriteLane(field)) {
    return {
      ...base,
      verdict: 'engine_unanswerable',
      engineValue: undefined,
      engineNamedField: false,
    };
  }
  if (!answer) {
    return {
      ...base,
      verdict: 'engine_made_no_plan',
      engineValue: undefined,
      engineNamedField: false,
    };
  }
  const engineNamedField = projectionNamesField(answer, field);
  if (!engineNamedField) {
    // A plan that omits the field states nothing about it, so the stored value is
    // not agreement. What separates the two silences is whether any evidence for
    // the field exists at all.
    const verdict: FieldLockOriginVerdict =
      liveObservationCount === 0
        ? assertsNoValue
          ? 'inert'
          : 'unbacked_preserved_value'
        : 'silent_with_evidence';
    return { ...base, verdict, engineValue: undefined, engineNamedField };
  }
  const engineValue = plannedFieldValue(answer, field, storedValue);
  if (fieldLockReleaseAgrees(engineValue, storedValue)) {
    return { ...base, verdict: 'inert', engineValue, engineNamedField };
  }
  if (lockedFieldAssertsNoValue(engineValue)) {
    return { ...base, verdict: 'engine_would_clear', engineValue, engineNamedField };
  }
  return { ...base, verdict: 'engine_would_replace', engineValue, engineNamedField };
}

export interface FieldLockOriginSummary {
  rowsWithLocks: number;
  lockedInstances: number;
  byVerdict: Record<string, number>;
  byReason: Record<string, number>;
  byField: Record<string, number>;
  verdictByField: Record<string, Record<string, number>>;
}

export function summarizeFieldLockOrigins(
  findings: readonly FieldLockOriginFinding[],
): FieldLockOriginSummary {
  const summary: FieldLockOriginSummary = {
    rowsWithLocks: new Set(findings.map((finding) => finding.slug)).size,
    lockedInstances: findings.length,
    byVerdict: {},
    byReason: {},
    byField: {},
    verdictByField: {},
  };
  for (const finding of findings) {
    summary.byVerdict[finding.verdict] = (summary.byVerdict[finding.verdict] ?? 0) + 1;
    summary.byReason[finding.reason] = (summary.byReason[finding.reason] ?? 0) + 1;
    summary.byField[finding.field] = (summary.byField[finding.field] ?? 0) + 1;
    const perField = summary.verdictByField[finding.field] ?? {};
    perField[finding.verdict] = (perField[finding.verdict] ?? 0) + 1;
    summary.verdictByField[finding.field] = perField;
  }
  return summary;
}
