import { containsAsciiControl } from '../utils/asciiControl';
import {
  PERMANENTLY_CLOSED_SUPPRESSION_REASON,
  hasRecordedClosureEvidence,
} from '../utils/researchEntityYaleStatus';

export const SUPPRESSION_REASON_FIELD = 'studentVisibilitySuppressionReason';
export const MAX_DEPARTURE_NOTE_LENGTH = 320;

export interface DepartureRecordCandidate {
  studentVisibilitySuppressionReason?: unknown;
  manuallyLockedFields?: unknown;
}

export type DepartureRecordSkipReason = 'already_recorded' | 'suppression_reason_locked';

export interface DepartureRecordSet {
  studentVisibilitySuppressionReason: string;
  yaleStatusCache: 'departed';
  activeAtYaleCache: false;
  yaleStatusReasonCache: 'departed';
}

export type DepartureRecordDecision =
  | { action: 'record'; set: DepartureRecordSet }
  | { action: 'skip'; reason: DepartureRecordSkipReason };

/**
 * `studentVisibilitySuppressionReason` is a comma-joined list that several writers
 * append to, so a note containing a comma would split into entries that are not
 * reasons and a later append would carry the fragments forward. Rejecting the
 * comma keeps the field parseable instead of silently corrupting it.
 */
export function normalizeDepartureNote(value: unknown): string {
  const note = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!note) throw new Error('--note requires the evidence behind the departure');
  if (note.includes(',')) {
    throw new Error(
      `--note must not contain a comma: ${SUPPRESSION_REASON_FIELD} is a comma-joined reason list`,
    );
  }
  if (containsAsciiControl(note)) throw new Error('--note contains invalid characters');
  if (note.length > MAX_DEPARTURE_NOTE_LENGTH) {
    throw new Error(`--note must be at most ${MAX_DEPARTURE_NOTE_LENGTH} characters`);
  }
  return note;
}

export function existingSuppressionReasons(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((reason) => reason.trim())
        .filter(Boolean)
    : [];
}

export function withRecordedDepartureReason(existing: unknown, note: string): string {
  return [
    ...existingSuppressionReasons(existing),
    `${PERMANENTLY_CLOSED_SUPPRESSION_REASON}: ${note}`,
  ].join(', ');
}

export function suppressionReasonIsWritable(entity: DepartureRecordCandidate): boolean {
  const lockedFields = Array.isArray(entity.manuallyLockedFields)
    ? entity.manuallyLockedFields
    : [];
  return !lockedFields.includes(SUPPRESSION_REASON_FIELD);
}

/**
 * The marker is what makes a relocation durable: `deriveResearchEntityYaleStatus`
 * re-derives `activeAtYaleCache: false` from it on every materialize pass, while a
 * bare cache write is reset by `hasEvidencelessInactiveYaleStatus`. The cache
 * fields are written alongside it so the row is correct before the next pass
 * rather than only after one, and because a row the corpus holds no observations
 * for is never offered to the materializer at all (#2684).
 */
export function planResearchEntityDepartureRecord(
  entity: DepartureRecordCandidate,
  note: string,
): DepartureRecordDecision {
  if (!suppressionReasonIsWritable(entity)) {
    return { action: 'skip', reason: 'suppression_reason_locked' };
  }
  if (hasRecordedClosureEvidence(entity)) {
    return { action: 'skip', reason: 'already_recorded' };
  }
  return {
    action: 'record',
    set: {
      studentVisibilitySuppressionReason: withRecordedDepartureReason(
        entity.studentVisibilitySuppressionReason,
        note,
      ),
      yaleStatusCache: 'departed',
      activeAtYaleCache: false,
      yaleStatusReasonCache: 'departed',
    },
  };
}
