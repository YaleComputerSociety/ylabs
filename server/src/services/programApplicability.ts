import { deadlineIsStale, programDeadlineClosesAt } from '../utils/programDeadlineInstant';
import { servedUpcomingDuplicateWindow } from './programUpcomingDuplicateWindow';

export const EXTERNAL_AWARD_CYCLE_STALE_REASON = 'external_award_cycle_stale';
export const AWARD_SUSPENDED_REASON = 'award_suspended';
export const PRIZE_FOR_COMPLETED_WORK_REASON = 'prize_for_completed_work';
export const PROGRAM_LISTING_PAGE_REASON = 'program_listing_page';

export interface ProgramApplicabilityInput {
  title?: unknown;
  summary?: unknown;
  description?: unknown;
  applicationInformation?: unknown;
  eligibility?: unknown;
  additionalInformation?: unknown;
  restrictionsToUseOfAward?: unknown;
  sourceUrl?: unknown;
  applicationLink?: unknown;
  links?: unknown;
  deadline?: unknown;
  upcomingDuplicateWindow?: unknown;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const programProse = (program: ProgramApplicabilityInput): string =>
  [
    program.summary,
    program.description,
    program.applicationInformation,
    program.eligibility,
    program.additionalInformation,
    program.restrictionsToUseOfAward,
  ]
    .map(text)
    .filter(Boolean)
    .join(' ');

const validDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export function isExternalAwardRecordUrl(value: unknown): boolean {
  let url: URL;
  try {
    url = new URL(text(value));
  } catch {
    return false;
  }
  return (
    url.hostname.toLowerCase().replace(/^www\./, '') === 'funding.yale.edu' &&
    url.pathname.toLowerCase().startsWith('/external-award/')
  );
}

// An outside program is listed only because the office lists it, so once that listing's one
// cycle has been skipped nothing current says Yale still points students to it (#4587). A
// Yale-administered fund's skipped cycle is a stale page, not a lapsed fund, so it is not held.
export function hasStaleExternalAwardCycle(
  program: ProgramApplicabilityInput,
  now: Date,
  upcomingDuplicateWindow: unknown = program.upcomingDuplicateWindow,
): boolean {
  if (!isExternalAwardRecordUrl(program.sourceUrl)) return false;
  const deadline = validDate(program.deadline);
  if (!deadline) return false;
  if (servedUpcomingDuplicateWindow({ deadline, upcomingDuplicateWindow }, now)) return false;
  return deadlineIsStale(programDeadlineClosesAt(deadline), now);
}

const SENTENCE_BREAK = /(?<=[.!?])\s+|\s*\n+\s*/;
const SUSPENSION_STATEMENT =
  /\b(?:suspend(?:s|ed|ing)?|discontinu(?:e|es|ed|ing))\b|\bno longer (?:be )?(?:offered|available|awarded|accepting applications)\b/i;
const AWARD_NOUN =
  /\b(?:awards?|awarding|scholarships?|fellowships?|grants?|prizes?|programs?|programmes?|competitions?|applications?)\b/i;
const CONDITIONAL_OR_RESUMED =
  /\b(?:if|unless|may|might|could|should|would|in the event|resum\w*|reinstat\w*|reopen\w*)\b/i;

// A suspension clause in an award's terms ("payments will be suspended if") is conditional,
// and a statement that the award resumes is not a suspension, so neither counts.
export function statesAwardSuspension(program: ProgramApplicabilityInput): boolean {
  return programProse(program)
    .split(SENTENCE_BREAK)
    .some(
      (sentence) =>
        SUSPENSION_STATEMENT.test(sentence) &&
        AWARD_NOUN.test(sentence) &&
        !CONDITIONAL_OR_RESUMED.test(sentence),
    );
}

const PRIZE_TITLE = /\bprizes?\b/i;
const FORWARD_FUNDING =
  /\b(?:support(?:s|ed|ing)?|fund(?:s|ed|ing)?|travel\w*|stipends?|expenses|costs|cover(?:s|ed|ing)?|to (?:conduct|pursue|undertake|carry out))\b/i;
const MIN_PRIZE_PROSE_WORDS = 6;

// A prize for an essay or a book funds nothing still to be done, while a travel or project
// prize names what it pays for. A record with no prose is not read either way.
export function isPrizeForCompletedWork(program: ProgramApplicabilityInput): boolean {
  const title = text(program.title);
  if (!PRIZE_TITLE.test(title) || FORWARD_FUNDING.test(title)) return false;
  const prose = programProse(program);
  if (prose.split(' ').filter(Boolean).length < MIN_PRIZE_PROSE_WORDS) return false;
  return !FORWARD_FUNDING.test(prose);
}

const GENERIC_LISTING_TITLE_WORDS: ReadonlySet<string> = new Set([
  'a',
  'additional',
  'all',
  'and',
  'available',
  'award',
  'awards',
  'for',
  'fellowship',
  'fellowships',
  'fund',
  'funding',
  'funds',
  'grant',
  'grants',
  'graduate',
  'in',
  'of',
  'opportunities',
  'opportunity',
  'other',
  'prize',
  'prizes',
  'program',
  'programs',
  'research',
  'scholarship',
  'scholarships',
  'student',
  'students',
  'summer',
  'the',
  'to',
  'travel',
  'undergraduate',
  'undergraduates',
  'yale',
]);

const MIN_LISTED_PROGRAM_PAGES = 2;

const comparablePage = (value: unknown): string =>
  text(value)
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();

const pageHost = (page: string): string => page.split(/[/?]/)[0];

const sameSiteRoutePages = (program: ProgramApplicabilityInput): Set<string> => {
  const links = Array.isArray(program.links) ? program.links : [];
  const source = comparablePage(program.sourceUrl);
  if (!source) return new Set();
  return new Set(
    [program.applicationLink, ...links.map((link: any) => link?.url)]
      .filter((url) => /^https?:\/\//i.test(text(url)))
      .map(comparablePage)
      .filter((page) => page && page !== source && pageHost(page) === pageHost(source)),
  );
};

// A generic title alone also names real programs, and a fund page plus an application form
// is two routes, so only a generic title routing to several pages on its own site is a listing.
export function isProgramListingPage(program: ProgramApplicabilityInput): boolean {
  const words = text(program.title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0 || !words.every((word) => GENERIC_LISTING_TITLE_WORDS.has(word))) {
    return false;
  }
  return sameSiteRoutePages(program).size >= MIN_LISTED_PROGRAM_PAGES;
}
