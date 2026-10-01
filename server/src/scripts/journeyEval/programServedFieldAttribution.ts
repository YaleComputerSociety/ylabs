import { publicProgramDescription } from '../../controllers/programPayload';
import {
  servedProgramDeadline,
  toValidDate,
  type ServedProgramDeadline,
} from '../../services/fellowshipService';
import { isUnhelpfulProgramUrl } from '../../utils/researchHomeWebsiteUrl';
import { publicHttpUrl } from '../../utils/urlSafety';

export const PROGRAM_ATTRIBUTED_FIELDS = [
  'deadline',
  'isAcceptingApplications',
  'applicationLink',
  'eligibility',
] as const;

export type ProgramAttributedField = (typeof PROGRAM_ATTRIBUTED_FIELDS)[number];

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
  return closedByPastDeadline
    ? attributed('isAcceptingApplications', 'deadlineIsPast')
    : unexplained(
        'isAcceptingApplications',
        'serves an application status the deadline does not explain',
      );
}

function attributeApplicationLink(stored: Row, served: Row): ProgramFieldOutcome {
  const storedLink = publicHttpUrl(stored.applicationLink);
  const servedLink =
    typeof served.applicationLink === 'string' ? served.applicationLink : undefined;

  if (servedLink !== undefined) {
    return servedLink === storedLink
      ? unchanged('applicationLink')
      : unexplained('applicationLink', 'serves an apply link other than the stored one');
  }
  if (!hasText(stored.applicationLink)) return unchanged('applicationLink');
  if (!storedLink) return attributed('applicationLink', 'publicHttpUrl');
  if (isUnhelpfulProgramUrl(storedLink, publicHttpUrl(stored.sourceUrl)))
    return attributed('applicationLink', 'isUnhelpfulProgramUrl');
  return unexplained('applicationLink', 'withholds a public, specific stored apply link');
}

function attributeEligibility(stored: Row, served: Row): ProgramFieldOutcome {
  const storedHasText = hasText(stored.eligibility);
  const servedHasText = hasText(served.eligibility);
  if (!storedHasText) {
    return servedHasText
      ? unexplained('eligibility', 'serves eligibility text the row does not store')
      : unchanged('eligibility');
  }
  if (servedHasText) return unchanged('eligibility');
  return hasText(publicProgramDescription(stored.eligibility))
    ? unexplained(
        'eligibility',
        'withholds stored eligibility text the description sanitizer keeps',
      )
    : attributed('eligibility', 'publicProgramDescription');
}

export function attributeProgramServedFields(
  stored: Row,
  served: Row,
  servedAt: ServedAtWindow,
): ProgramFieldOutcome[] {
  return [
    attributeDeadline(stored, served, servedAt),
    attributeAcceptingApplications(stored, served, servedAt),
    attributeApplicationLink(stored, served),
    attributeEligibility(stored, served),
  ];
}
