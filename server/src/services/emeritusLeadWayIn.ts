import { servedCurrentFunding } from './servedCurrentFunding';

export const EMERITUS_WITHHELD_WAY_IN_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'APPLICATION_FORM_EXISTS',
]);

const EMERITUS_WORD = /\bemerit(?:us|a|i|ae)\b/i;
const EMERITUS_NAMING_AN_INSTITUTION =
  /\bemerit(?:us|a|i|ae)\s+(?:association|award|center|centre|club|college|council|fellowship|fund|lecture|lectureship|prize|program|programme|society)\b/gi;
const TRAILING_EMERITUS = /\bemerit(?:us|a|i|ae)\s*(?:\([^)]*\))?\s*[.,]?\s*$/i;
const FACULTY_APPOINTMENT_HEAD_SOURCE =
  '(?:profes+or\\w*|prof|lecturer|lector|instructor|faculty|scholar|scientist|researcher)';
const FACULTY_APPOINTMENT_HEAD = new RegExp(`\\b${FACULTY_APPOINTMENT_HEAD_SOURCE}\\b`, 'i');
const AFFILIATION = /\baffiliat\w*/i;
const APPOINTMENT_BOUNDARY = new RegExp(
  `\\s*(?:,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)(?=(?:[\\p{L}.'’()-]+\\s+){0,6}?${FACULTY_APPOINTMENT_HEAD_SOURCE}\\b)`,
  'iu',
);

const normalizeTitle = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .normalize('NFKC')
        .replace(/\u00AD/g, '')
        .replace(EMERITUS_NAMING_AN_INSTITUTION, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

const FACULTY_APPOINTMENT_HEAD_AT_END = new RegExp(`\\b${FACULTY_APPOINTMENT_HEAD_SOURCE}$`, 'i');

// A trailing "Emeritus" set off from the appointment ("Professor of Anthropology and Named
// Professor of Japanese Studies, Emeritus") qualifies every appointment the clause lists, so
// the clause is not split; directly after a head ("Research Professor and Professor
// Emeritus") it qualifies only that one.
const emeritusQualifiesWholeClause = (clause: string): boolean => {
  const trailing = TRAILING_EMERITUS.exec(clause);
  if (!trailing) return false;
  const before = clause.slice(0, trailing.index);
  return /,\s*$/.test(before) || !FACULTY_APPOINTMENT_HEAD_AT_END.test(before.trimEnd());
};

const appointmentsInClause = (clause: string): string[] =>
  emeritusQualifiesWholeClause(clause) ? [clause] : clause.split(APPOINTMENT_BOUNDARY);

const isFacultyEmeritusAppointment = (appointment: string): boolean =>
  EMERITUS_WORD.test(appointment) && FACULTY_APPOINTMENT_HEAD.test(appointment);

const isActiveFacultyAppointment = (appointment: string): boolean =>
  !EMERITUS_WORD.test(appointment) &&
  !AFFILIATION.test(appointment) &&
  FACULTY_APPOINTMENT_HEAD.test(appointment);

// A title that also names an active appointment ("Professor Emeritus and Senior Research
// Scientist") states current research employment in the person's own words, and an emeritus
// office beside an active chair ("President Emeritus and Sterling Professor") is not an
// emeritus appointment at all, so neither counts.
export function titleHoldsOnlyEmeritusAppointments(title: unknown): boolean {
  const text = normalizeTitle(title);
  if (!text || !EMERITUS_WORD.test(text)) return false;
  const appointments = text
    .split(/\s*;\s*/)
    .flatMap(appointmentsInClause)
    .map((appointment) => appointment.trim())
    .filter(Boolean);
  return (
    appointments.some(isFacultyEmeritusAppointment) &&
    !appointments.some(isActiveFacultyAppointment)
  );
}

// Every lead, not any: a co-led row with an active lead, or with a lead whose title is
// unknown, has someone who may be running the work now.
export function leadTitlesAreAllEmeritus(leadTitles: readonly unknown[]): boolean {
  return leadTitles.length > 0 && leadTitles.every(titleHoldsOnlyEmeritusAppointments);
}

const MS_PER_DAY = 86_400_000;

export type EmeritusCurrentActivityEvidence = 'running_funding' | 'current_team';

export interface EmeritusCurrentActivityInput {
  entity: Record<string, any>;
  currentTeamMemberCount: number;
  now?: Date;
}

const NIH_CONFERENCE_ACTIVITY_CODES: ReadonlySet<string> = new Set(['R13', 'U13']);

const nihActivityCode = (awardId: unknown): string | undefined =>
  typeof awardId === 'string' ? /^\d?([A-Z]\d{2})/.exec(awardId.trim())?.[1] : undefined;

const isRunningResearchAward = (award: unknown, now: number): boolean => {
  if (!award || typeof award !== 'object') return false;
  const { endDate, id } = award as { endDate?: unknown; id?: unknown };
  if (endDate === undefined || endDate === null || endDate === '') return false;
  const endTime = new Date(endDate as string | number | Date).getTime();
  if (!Number.isFinite(endTime) || endTime + MS_PER_DAY <= now) return false;
  const activityCode = nihActivityCode(id);
  return !activityCode || !NIH_CONFERENCE_ACTIVITY_CODES.has(activityCode);
};

// Two arms, both measured on 2026-10-02 (#4431). A CURRENT_UNDERGRADS signal and the stored
// current-undergraduate count were hand-read on every emeritus-led row that carried one and
// were wrong or stale on most of them (an alumni list, a committee roster, a retired lead's
// homepage), so neither is evidence here. Observation recency is not an arm either: the sweep
// re-reads every row, so it dates the crawler rather than the research.
export function emeritusCurrentActivityEvidence({
  entity,
  currentTeamMemberCount,
  now = new Date(),
}: EmeritusCurrentActivityInput): EmeritusCurrentActivityEvidence[] {
  const evidence: EmeritusCurrentActivityEvidence[] = [];
  const servedAwards = servedCurrentFunding(entity, now.getTime()).recentGrants;
  if (
    Array.isArray(servedAwards) &&
    servedAwards.some((award) => isRunningResearchAward(award, now.getTime()))
  ) {
    evidence.push('running_funding');
  }
  if (currentTeamMemberCount > 0) evidence.push('current_team');
  return evidence;
}

export interface EmeritusWayInDecision {
  emeritusLed: boolean;
  wayInWithheld: boolean;
  currentActivity: EmeritusCurrentActivityEvidence[];
}

export const NOT_EMERITUS_LED: Readonly<EmeritusWayInDecision> = Object.freeze({
  emeritusLed: false,
  wayInWithheld: false,
  currentActivity: [],
});

export function decideEmeritusWayIn(
  leadTitles: readonly unknown[],
  activity: () => EmeritusCurrentActivityEvidence[],
): Readonly<EmeritusWayInDecision> {
  if (!leadTitlesAreAllEmeritus(leadTitles)) return NOT_EMERITUS_LED;
  const currentActivity = activity();
  return { emeritusLed: true, wayInWithheld: currentActivity.length === 0, currentActivity };
}

export const signalIsWithheldWayIn = (
  signal: { type?: unknown },
  decision: Pick<EmeritusWayInDecision, 'wayInWithheld'>,
): boolean =>
  decision.wayInWithheld &&
  typeof signal.type === 'string' &&
  EMERITUS_WITHHELD_WAY_IN_SIGNAL_TYPES.has(signal.type);

export const servedEmeritusWayInFlags = (
  decision: Pick<EmeritusWayInDecision, 'emeritusLed' | 'wayInWithheld'> | undefined,
): { emeritusLed?: true; wayInWithheld?: true } => ({
  ...(decision?.emeritusLed ? { emeritusLed: true as const } : {}),
  ...(decision?.wayInWithheld ? { wayInWithheld: true as const } : {}),
});
