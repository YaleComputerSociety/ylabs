import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';

const MAX_FELLOWSHIP_EVIDENCE_TEXT_LENGTH = 5000;
const MAX_FELLOWSHIP_EVIDENCE_ARRAY_ITEMS = 50;
const MAX_FELLOWSHIP_EVIDENCE_URLS = 50;
const MAX_FELLOWSHIP_EVIDENCE_DATE_LENGTH = 64;

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
  if (typeof value !== 'string') return undefined;
  const text = value.slice(0, MAX_FELLOWSHIP_EVIDENCE_TEXT_LENGTH).trim();
  return text || undefined;
}

function cleanHttpUrl(value: unknown): string | undefined {
  const url = cleanString(value);
  return url && isPublicHttpUrl(url) ? url : undefined;
}

function dateStatus(
  value: unknown,
  now: Date,
  predicate: (dateTime: number, nowTime: number) => boolean,
): boolean | undefined {
  if (!value) return undefined;
  if (!(value instanceof Date) && typeof value !== 'string') return undefined;
  const raw = value instanceof Date ? value : value.slice(0, MAX_FELLOWSHIP_EVIDENCE_DATE_LENGTH);
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return predicate(date.getTime(), now.getTime());
}

function textPart(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.slice(0, MAX_FELLOWSHIP_EVIDENCE_TEXT_LENGTH).trim();
    return text ? [text] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FELLOWSHIP_EVIDENCE_ARRAY_ITEMS).flatMap(textPart);
}

function textForFellowship(fellowship: any): string {
  return [
    ...textPart(fellowship.title),
    ...textPart(fellowship.competitionType),
    ...textPart(fellowship.summary),
    ...textPart(fellowship.description),
    ...textPart(fellowship.applicationInformation),
    ...textPart(fellowship.eligibility),
    ...textPart(fellowship.restrictionsToUseOfAward),
    ...textPart(fellowship.additionalInformation),
    ...textPart(fellowship.purpose),
    ...textPart(fellowship.termOfAward),
    ...textPart(fellowship.yearOfStudy),
  ]
    .join(' ')
    .slice(0, MAX_FELLOWSHIP_EVIDENCE_TEXT_LENGTH);
}

function looksRecurring(fellowshipText: string): boolean {
  return /\b(fellowship|funding|grant|stipend|award|summer|annual|year|cycle|term|spring|fall|deadline|application)\b/i.test(
    fellowshipText,
  );
}

function hasApplicationRoute(fellowship: any, sourceUrls: string[]): boolean {
  if (cleanHttpUrl(fellowship.applicationLink)) return true;
  if (!Array.isArray(fellowship.links)) return false;

  return fellowship.links.slice(0, MAX_FELLOWSHIP_EVIDENCE_URLS).some((link: any) => {
    const url = cleanHttpUrl(link?.url);
    if (!url || !sourceUrls.includes(url)) return false;
    const label = cleanString(link?.label) || '';
    return /apply|application/i.test(`${label} ${url}`);
  });
}

export function buildFellowshipApplicationCycleEvidence(
  fellowship: any,
  now: Date = new Date(),
): FellowshipApplicationCycleEvidence {
  const applicationLink = cleanHttpUrl(fellowship.applicationLink);
  const linkUrls = Array.isArray(fellowship.links)
    ? fellowship.links
        .slice(0, MAX_FELLOWSHIP_EVIDENCE_URLS)
        .map((link: any) => cleanHttpUrl(link?.url))
        .filter(Boolean)
    : [];
  const sourceUrls = Array.from(new Set([applicationLink, ...linkUrls].filter(Boolean))) as string[];
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
  if (publicEvidence.contactOffice) {
    publicEvidence.contactOffice = redactDirectContactInfo(publicEvidence.contactOffice);
  }
  return publicEvidence;
}
