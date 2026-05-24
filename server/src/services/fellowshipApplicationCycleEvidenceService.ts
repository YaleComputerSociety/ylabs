import { isHttpUrl } from '../utils/urlNormalization';

export interface FellowshipApplicationCycleEvidence {
  sourceUrls: string[];
  applicationLink?: string;
  applicationOpenDate?: Date | string | null;
  deadline?: Date | string | null;
  isAcceptingApplications?: boolean;
  contactOffice?: string;
  contactEmail?: string;
  sourceBacked: boolean;
  activeCycle: boolean;
  supportsFellowshipFundedProject: boolean;
  supportsFellowshipCompatible: boolean;
  supportsOfficialApplicationRoute: boolean;
  nextCycleSignal: boolean;
  applicationHasOpened?: boolean;
  deadlineHasNotPassed?: boolean;
}

export type PublicFellowshipApplicationCycleEvidence = Omit<
  FellowshipApplicationCycleEvidence,
  'contactEmail'
>;

function cleanString(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

function cleanHttpUrl(value: unknown): string | undefined {
  const url = cleanString(value);
  return isHttpUrl(url) ? url : undefined;
}

function dateStatus(
  value: unknown,
  now: Date,
  predicate: (dateTime: number, nowTime: number) => boolean,
): boolean | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return predicate(date.getTime(), now.getTime());
}

function textForFellowship(fellowship: any): string {
  return [
    fellowship.title,
    fellowship.competitionType,
    fellowship.summary,
    fellowship.description,
    fellowship.applicationInformation,
    fellowship.eligibility,
    fellowship.restrictionsToUseOfAward,
    fellowship.additionalInformation,
    ...(fellowship.purpose || []),
    ...(fellowship.termOfAward || []),
    ...(fellowship.yearOfStudy || []),
  ]
    .filter(Boolean)
    .join(' ');
}

function looksRecurring(fellowshipText: string): boolean {
  return /\b(fellowship|funding|grant|stipend|award|summer|annual|year|cycle|term|spring|fall|deadline|application)\b/i.test(
    fellowshipText,
  );
}

function hasApplicationRoute(fellowship: any, sourceUrls: string[]): boolean {
  if (cleanHttpUrl(fellowship.applicationLink)) return true;
  if (!Array.isArray(fellowship.links)) return false;

  return fellowship.links.some((link: any) => {
    const url = cleanHttpUrl(link?.url);
    if (!url || !sourceUrls.includes(url)) return false;
    return /apply|application/i.test(`${link?.label || ''} ${url}`);
  });
}

export function buildFellowshipApplicationCycleEvidence(
  fellowship: any,
  now: Date = new Date(),
): FellowshipApplicationCycleEvidence {
  const applicationLink = cleanHttpUrl(fellowship.applicationLink);
  const linkUrls = Array.isArray(fellowship.links)
    ? fellowship.links.map((link: any) => cleanHttpUrl(link?.url)).filter(Boolean)
    : [];
  const sourceUrls = Array.from(
    new Set([applicationLink, ...linkUrls].filter(Boolean)),
  ) as string[];
  const sourceBacked = sourceUrls.length > 0;
  const applicationHasOpened = dateStatus(
    fellowship.applicationOpenDate,
    now,
    (dateTime, nowTime) => dateTime <= nowTime,
  );
  const deadlineHasNotPassed = dateStatus(
    fellowship.deadline,
    now,
    (dateTime, nowTime) => dateTime >= nowTime,
  );
  const activeCycle =
    sourceBacked &&
    fellowship.isAcceptingApplications === true &&
    applicationHasOpened !== false &&
    deadlineHasNotPassed !== false;
  const fellowshipText = textForFellowship(fellowship);
  const projectLike = /research|project|proposal|summer|thesis/i.test(fellowshipText);
  const fellowshipLike = /fellowship|funding|grant|stipend|award/i.test(fellowshipText);
  const supportsFellowshipFundedProject = sourceBacked && projectLike;
  const supportsFellowshipCompatible = sourceBacked && (projectLike || fellowshipLike);
  const nextCycleSignal =
    sourceBacked &&
    !activeCycle &&
    supportsFellowshipCompatible &&
    looksRecurring(fellowshipText) &&
    (deadlineHasNotPassed === false || fellowship.isAcceptingApplications !== true);

  return {
    sourceUrls,
    applicationLink,
    applicationOpenDate: fellowship.applicationOpenDate,
    deadline: fellowship.deadline,
    isAcceptingApplications: fellowship.isAcceptingApplications,
    contactOffice: cleanString(fellowship.contactOffice),
    contactEmail: cleanString(fellowship.contactEmail),
    sourceBacked,
    activeCycle,
    supportsFellowshipFundedProject,
    supportsFellowshipCompatible,
    supportsOfficialApplicationRoute: sourceBacked && hasApplicationRoute(fellowship, sourceUrls),
    nextCycleSignal,
    applicationHasOpened,
    deadlineHasNotPassed,
  };
}

export function publicFellowshipApplicationCycleEvidence(
  evidence: FellowshipApplicationCycleEvidence,
): PublicFellowshipApplicationCycleEvidence {
  const publicEvidence = { ...evidence };
  delete publicEvidence.contactEmail;
  return publicEvidence;
}
