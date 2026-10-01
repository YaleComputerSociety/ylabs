import {
  PROGRAM_READER_FIELD_DECISIONS,
  type ProgramReaderDecidedField,
  type ServedProgramReaderField,
} from '../../controllers/programPayload';
import {
  acceptingFromServedWindow,
  publicFellowshipForStudent,
  servedProgramDeadline,
  toValidDate,
  type ServedProgramDeadline,
} from '../../services/fellowshipService';

const PROGRAM_READER_DECIDED_FIELDS = Object.keys(
  PROGRAM_READER_FIELD_DECISIONS,
) as ProgramReaderDecidedField[];

export const PROGRAM_ATTRIBUTED_FIELDS = [
  'deadline',
  'isAcceptingApplications',
  ...PROGRAM_READER_DECIDED_FIELDS,
] as const;

export type ProgramAttributedField =
  | 'deadline'
  | 'isAcceptingApplications'
  | ProgramReaderDecidedField;

const STUDENT_PROJECTION_GUARD = 'publicFellowshipForStudent';

export type ProgramFieldOutcome =
  | { field: ProgramAttributedField; status: 'unchanged' }
  | { field: ProgramAttributedField; status: 'attributed'; guard: string }
  | { field: ProgramAttributedField; status: 'unexplained'; reason: string };

export interface ServedAtWindow {
  from: Date;
  to: Date;
}

type Row = Record<string, unknown>;

const unchanged = (field: ProgramAttributedField): ProgramFieldOutcome => ({
  field,
  status: 'unchanged',
});

const attributed = (field: ProgramAttributedField, guard: string): ProgramFieldOutcome => ({
  field,
  status: 'attributed',
  guard,
});

const unexplained = (field: ProgramAttributedField, reason: string): ProgramFieldOutcome => ({
  field,
  status: 'unexplained',
  reason,
});

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const sameInstant = (left: Date | undefined, right: Date | undefined): boolean =>
  left?.getTime() === right?.getTime();

const instantsIn = (servedAt: ServedAtWindow): Date[] => [servedAt.from, servedAt.to];

const servedDeadlinesIn = (stored: Row, servedAt: ServedAtWindow): ServedProgramDeadline[] =>
  instantsIn(servedAt).map((now) => servedProgramDeadline(stored, now));

const deadlineGuard = (stored: Date | undefined, served: ServedProgramDeadline): string | null => {
  if (served.projectedNextCycle) return 'projectNextCycleDeadline';
  return sameInstant(stored, served.deadline) ? null : 'programDeadlineClosesAt';
};

function attributeDeadline(
  stored: Row,
  served: Row,
  servedAt: ServedAtWindow,
): ProgramFieldOutcome {
  const storedDeadline = toValidDate(stored.deadline);
  const servedDeadline = toValidDate(served.deadline);
  const flaggedProjected = served.deadlineProjectedNextCycle === true;

  const producing = servedDeadlinesIn(stored, servedAt).find(
    (candidate) =>
      sameInstant(candidate.deadline, servedDeadline) &&
      candidate.projectedNextCycle === flaggedProjected,
  );
  if (producing) {
    const guard = deadlineGuard(storedDeadline, producing);
    return guard ? attributed('deadline', guard) : unchanged('deadline');
  }
  if (sameInstant(storedDeadline, servedDeadline) && flaggedProjected) {
    return unexplained('deadline', 'flagged as projected while serving the stored deadline');
  }
  return unexplained('deadline', 'serves a deadline the serve-time deadline path does not produce');
}

function attributeAcceptingApplications(
  stored: Row,
  served: Row,
  servedAt: ServedAtWindow,
): ProgramFieldOutcome {
  const storedFlag =
    typeof stored.isAcceptingApplications === 'boolean'
      ? stored.isAcceptingApplications
      : undefined;
  const servedFlag = served.isAcceptingApplications;
  if (storedFlag === servedFlag) return unchanged('isAcceptingApplications');
  const closedByPastDeadline =
    storedFlag === true &&
    servedFlag === false &&
    servedDeadlinesIn(stored, servedAt).some((candidate) => candidate.closed);
  if (closedByPastDeadline) return attributed('isAcceptingApplications', 'deadlineIsPast');
  const decidedByServedWindow = instantsIn(servedAt).some(
    (now) =>
      acceptingFromServedWindow(stored, servedProgramDeadline(stored, now), now) === servedFlag,
  );
  return decidedByServedWindow
    ? attributed('isAcceptingApplications', 'acceptingFromServedWindow')
    : unexplained(
        'isAcceptingApplications',
        'serves an application status the deadline does not explain',
      );
}

const sameServedValue = (left: unknown, right: unknown): boolean =>
  left === right || (!hasText(left) && !hasText(right));

function attributeReaderDecidedField(
  field: ProgramReaderDecidedField,
  stored: Row,
  served: Row,
  readerInput: Row,
): ProgramFieldOutcome {
  const decision: ServedProgramReaderField<unknown> =
    PROGRAM_READER_FIELD_DECISIONS[field](readerInput);
  const storedHasValue = hasText(stored[field]);

  if (!sameServedValue(served[field], decision.value)) {
    return hasText(served[field]) && !storedHasValue
      ? unexplained(field, `serves ${field} the row does not store`)
      : unexplained(field, `serves ${field} the serve-time ${field} decision does not produce`);
  }
  if (!storedHasValue) return unchanged(field);
  if (!hasText(readerInput[field])) return attributed(field, STUDENT_PROJECTION_GUARD);
  if (decision.withheldBy) return attributed(field, decision.withheldBy);
  return unchanged(field);
}

export function attributeProgramServedFields(
  stored: Row,
  served: Row,
  servedAt: ServedAtWindow,
): ProgramFieldOutcome[] {
  const readerInput = publicFellowshipForStudent(stored, servedAt.from) as Row;
  return [
    attributeDeadline(stored, served, servedAt),
    attributeAcceptingApplications(stored, served, servedAt),
    ...PROGRAM_READER_DECIDED_FIELDS.map((field) =>
      attributeReaderDecidedField(field, stored, served, readerInput),
    ),
  ];
}
