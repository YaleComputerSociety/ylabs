import type * as cheerio from 'cheerio';
import { humanizeProgramLinkLabel } from '../../utils/programLinkLabel';
import { isUnhelpfulProgramUrl } from '../../utils/researchHomeWebsiteUrl';
import {
  NAMED_PROGRAM_DATE_SOURCE,
  NUMERIC_PROGRAM_DATE_SOURCE,
  OPTIONAL_STATED_CLOCK_TIME,
  nextCycleDeadline,
  parseProgramDate,
} from './programDeadline';
import { sanitizedObservedFellowshipProse } from '../fellowshipProse';

const SITE_CHROME_SELECTOR =
  'header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .breadcrumbs, .menu';

const SIDEBAR_SELECTOR = 'aside, .sidebar, [role="complementary"]';

export const PROGRAM_PAGE_NON_PROSE_SELECTOR = `${SITE_CHROME_SELECTOR}, ${SIDEBAR_SELECTOR}`;

const APPLICATION_FORM_HOST =
  /(?:^|\.)(?:forms\.gle|qualtrics\.com|smarterselect\.com|slideroom\.com|formstack\.com|jotform\.com|surveymonkey\.com|airtable\.com|typeform\.com|submittable\.com|communityforce\.com|redcap\.med\.yale\.edu|redcap\.yale\.edu)$/i;

const APPLICATION_LABEL = /\bappl(?:y|ications?)\b/i;

const MIN_PROSE_PARAGRAPH_CHARS = 40;

const FAQ_OR_QUESTION_PARAGRAPH = /\?|\bfaqs?\b|\bfrequently asked questions\b/i;

const MIN_PROSE_DESCRIPTION_WORDS = 25;

const DEADLINE_LABEL =
  /\b(?:application\s+)?deadline\b|\bapplications?\s+(?:are\s+)?due\b|\bapply\s+by\b|\bdue\s+by\b/gi;

const DEADLINE_DATE = new RegExp(
  `(?:${NAMED_PROGRAM_DATE_SOURCE}|${NUMERIC_PROGRAM_DATE_SOURCE})${OPTIONAL_STATED_CLOCK_TIME}`,
  'i',
);

const PASSED_OR_CLOSED = /\b(?:(?:has|have)\s+(?:now\s+)?passed|(?:is|are)\s+(?:now\s+)?closed)\b/i;

const SENTENCE_END = /[.!?;](?:\s|$)/;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export interface ProgramPageLink {
  label: string;
  url: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(rawUrl: string | undefined, pageUrl: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:mailto|tel):/i.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed, pageUrl);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

const PROGRAM_TITLE_SIGNAL =
  /\b(?:research|program|programs|scholars?|fellows?|fellowships?|internships?|reu|summer|experience)\b/i;

function isSiteRootLink(heading: cheerio.Cheerio<any>, pageUrl: string): boolean {
  const anchor = heading.find('a[href]').first();
  if (anchor.length === 0) return false;
  if (normalizeWhitespace(anchor.text()) !== normalizeWhitespace(heading.text())) return false;
  try {
    return new URL(anchor.attr('href') || '', pageUrl).pathname.replace(/\/+$/, '') === '';
  } catch {
    return false;
  }
}

/**
 * Yale Drupal sites render the site name as the first `<h1>`, a link to the site root,
 * and the page's own title as a later `<h1>`. On a single-program site the site name
 * is the program, so it is kept unless a later heading names a program itself.
 */
export function programPageTitle($: cheerio.CheerioAPI, pageUrl: string): string {
  const headings = $('h1')
    .toArray()
    .map((node) => $(node));
  const first = headings[0];
  if (!first) return '';
  const firstText = normalizeWhitespace(first.text());
  if (!isSiteRootLink(first, pageUrl)) return firstText;
  const pageHeading = headings
    .slice(1)
    .filter((heading) => heading.closest(SITE_CHROME_SELECTOR).length === 0)
    .filter((heading) => !isSiteRootLink(heading, pageUrl))
    .map((heading) => normalizeWhitespace(heading.text()))
    .find((text) => text && PROGRAM_TITLE_SIGNAL.test(text));
  return pageHeading || firstText;
}

export function isApplyLink(url: string, label: string): boolean {
  return /\bapply|application|register\b/i.test(label) || /\bapply|application\b/i.test(url);
}

function isApplicationFormUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'docs.google.com') return /^\/forms\//i.test(url.pathname);
  return APPLICATION_FORM_HOST.test(host);
}

/**
 * Program sites often put their one "Apply" button in a sidebar callout, which sits
 * beside the site-wide sidebar links the chrome exclusion exists to drop. A sidebar
 * link is kept only when it says it is an application and lands on an
 * application-form host, so a department sidebar's admissions links stay out.
 */
function isSidebarApplicationFormLink(url: string, label: string): boolean {
  return APPLICATION_LABEL.test(label) && isApplicationFormUrl(url);
}

export function programApplicationLinks(
  $: cheerio.CheerioAPI,
  contentRoot: cheerio.Cheerio<any>,
  pageUrl: string,
  maxLinks: number,
): ProgramPageLink[] {
  const anchors = [...contentRoot.find('a').toArray(), ...$(SIDEBAR_SELECTOR).find('a').toArray()];
  const links: ProgramPageLink[] = [];
  const seenUrls = new Set<string>();
  for (const anchor of anchors) {
    const $link = $(anchor);
    if ($link.closest(SITE_CHROME_SELECTOR).length > 0) continue;
    const url = absoluteUrl($link.attr('href'), pageUrl);
    if (!url || seenUrls.has(url)) continue;
    const rawLabel = normalizeWhitespace($link.text());
    if (!isApplyLink(url, rawLabel)) continue;
    const inSidebar = $link.closest(SIDEBAR_SELECTOR).length > 0;
    if (inSidebar && !isSidebarApplicationFormLink(url, rawLabel)) continue;
    if (isUnhelpfulProgramUrl(url, pageUrl)) continue;
    seenUrls.add(url);
    links.push({
      label: humanizeProgramLinkLabel(rawLabel, url) || rawLabel || 'Application',
      url,
    });
    if (links.length >= maxLinks) break;
  }
  return links;
}

/**
 * Read the description from the page's prose paragraphs before falling back to its
 * whole body. A whole body carries the page's FAQ pointer, CTA and news blocks, and
 * the stored-description sanitizer rejects a body with those in it, which left real
 * programs with no description and so held below `student_ready`.
 */
export function programPageDescription(
  $: cheerio.CheerioAPI,
  chromeFreeRoot: cheerio.Cheerio<any>,
  bodyText: string,
): string | undefined {
  const prose = chromeFreeRoot
    .find('p')
    .toArray()
    .filter((node) => $(node).closest('figure, figcaption').length === 0)
    .map((node) => normalizeWhitespace($(node).text()))
    .filter(
      (text) => text.length >= MIN_PROSE_PARAGRAPH_CHARS && !FAQ_OR_QUESTION_PARAGRAPH.test(text),
    )
    .join(' ');
  const fromProse = sanitizedObservedFellowshipProse(prose) ?? '';
  if (wordCount(fromProse) >= MIN_PROSE_DESCRIPTION_WORDS) return fromProse;
  return sanitizedObservedFellowshipProse(bodyText) || fromProse || undefined;
}

/**
 * A deadline label whose own clause says it has passed or is closed is skipped,
 * because the date that follows it on these pages is the program's start date.
 */
export function nearestDeadlineText(text: string): string {
  const normalized = normalizeWhitespace(text);
  for (const label of normalized.matchAll(DEADLINE_LABEL)) {
    const start = (label.index ?? 0) + label[0].length;
    const after = normalized.slice(start, start + 120);
    const clauseEnd = after.search(SENTENCE_END);
    const clause = clauseEnd === -1 ? after : after.slice(0, clauseEnd);
    if (PASSED_OR_CLOSED.test(clause)) continue;
    const date = DEADLINE_DATE.exec(after)?.[0];
    if (date) return date;
  }
  return '';
}

const PROGRAM_DATE_SOURCE = `(?:${NAMED_PROGRAM_DATE_SOURCE}|${NUMERIC_PROGRAM_DATE_SOURCE})`;

const STATED_OPENING = new RegExp(
  `\\bapplications?\\b(?:\\s+period\\b)?[^.;]{0,100}?\\b(?:will\\s+)?(?:re)?open(?:s|ed)?\\s+(?:on\\s+)?(${PROGRAM_DATE_SOURCE})`,
  'gi',
);

const STATED_CLOSING = new RegExp(
  `\\bapplications?\\b[^.;]{0,100}?\\b(?:will\\s+)?clos(?:e|es|ed)\\s+(?:on\\s+)?(${PROGRAM_DATE_SOURCE})`,
  'gi',
);

const ACTIVE_APPLICATION_LANGUAGE =
  /\bapplications?\s+(?:are\s+)?(?:now\s+)?open\b(?!\s+(?:on\s+)?(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|\d))|\bcurrently accepting applications\b|\baccepting applications\b|\bapplications?\s+(?:are\s+)?accepted\b/i;

export interface StatedApplicationWindow {
  opensAt?: Date;
  closesAt?: Date;
}

const STATES_ITS_YEAR = /\b\d{4}\b|\d{1,2}\/\d{1,2}\/\d{2,4}/;

const WEEKDAY = /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i;

const WEEKDAY_ORDER = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const newYorkWeekday = (date: Date): string =>
  date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }).toLowerCase();

/**
 * Only a date that states its own year can move a window: a yearless date is rolled to the
 * next year by inference, which reads a stale page's last cycle as the coming one, and a stated
 * weekday that does not fit the date marks it as another year's (#6453, #6399).
 */
function windowDate(dateText: string, boundary: 'opens' | 'deadline', referenceDate: Date) {
  if (!STATES_ITS_YEAR.test(dateText)) return undefined;
  const date = parseProgramDate(dateText, boundary, referenceDate);
  if (!date) return undefined;
  const weekday = WEEKDAY.exec(dateText)?.[1].toLowerCase();
  const boundaryDay = boundary === 'deadline' ? new Date(date.getTime() - 1) : date;
  if (weekday && WEEKDAY_ORDER.includes(weekday) && newYorkWeekday(boundaryDay) !== weekday) {
    return undefined;
  }
  return date;
}

const statedDates = (
  pattern: RegExp,
  text: string,
  boundary: 'opens' | 'deadline',
  referenceDate: Date,
) =>
  [...text.matchAll(pattern)]
    .map((match) => windowDate(match[1], boundary, referenceDate))
    .filter((date): date is Date => date !== undefined);

/**
 * The application window a program page states in prose ("Applications open December 15, 2025
 * and close on March 13, 2026", "the application period will open November 15") (#6453): the
 * latest stated opening and the closing a student can still meet. A closing before the latest
 * opening belongs to an earlier cycle, so it is dropped.
 */
export function statedApplicationWindow(
  text: string,
  referenceDate: Date,
): StatedApplicationWindow {
  const normalized = normalizeWhitespace(text).replace(/([a-z])([A-Z])/g, '$1 $2');
  const openings = statedDates(STATED_OPENING, normalized, 'opens', referenceDate);
  const opensAt = openings.length
    ? openings.reduce((latest, date) => (date > latest ? date : latest))
    : undefined;
  const closing = nextCycleDeadline(
    statedDates(STATED_CLOSING, normalized, 'deadline', referenceDate),
    referenceDate,
  );
  const closesAt = closing && opensAt && closing < opensAt ? undefined : closing;
  return { ...(opensAt ? { opensAt } : {}), ...(closesAt ? { closesAt } : {}) };
}

/** Open-window language; a dated opening ("applications open December 1") is not one. */
export function hasActiveApplicationLanguage(text: string): boolean {
  return ACTIVE_APPLICATION_LANGUAGE.test(text);
}

/**
 * Whether a program page's own window is open at `referenceDate`: never before a stated
 * opening, then by the deadline or stated closing, then open once a stated opening of the
 * current cycle (the last six months) has passed, and only otherwise by open-window language
 * (#6453). An older opening with no closing says nothing about this cycle.
 */
const CURRENT_CYCLE_MS = 183 * 24 * 60 * 60 * 1000;

export function acceptingByStatedWindow(
  window: StatedApplicationWindow,
  deadline: Date | undefined,
  referenceDate: Date,
  bodyText: string,
): boolean {
  const now = referenceDate.getTime();
  if (window.opensAt && window.opensAt.getTime() > now) return false;
  const closesAt = deadline ?? window.closesAt;
  if (closesAt) return closesAt.getTime() > now;
  if (window.opensAt && now - window.opensAt.getTime() <= CURRENT_CYCLE_MS) return true;
  return hasActiveApplicationLanguage(bodyText);
}

const ROLLING_REVIEW =
  /\b(?:are|is)\s+(?:reviewed|accepted|considered|evaluated)\s+on\s+a\s+rolling\s+basis\b|\brolling\s+(?:review|admissions?)\b|\bapply\s+(?:at\s+)?any\s*time\b|\breviews?\s+applications\s+(?:regularly|continuously|on\s+an\s+ongoing\s+basis|as\s+they\s+(?:are\s+)?(?:received|come\s+in))\b/i;

const CLAUSE_NEGATION = /\b(?:no|not|never|no\s+longer|cannot|can't|nor)\b/i;

/**
 * Whether a page says applications are reviewed on a rolling basis now (#6458). Past tense is
 * not, and neither is a clause that carries a negation ("there is no rolling review", "rolling
 * admissions are no longer offered", "you cannot apply at any time"), which fails closed.
 */
export function statesRollingReview(text: string): boolean {
  return unnegatedClauses(text).some((clause) => ROLLING_REVIEW.test(clause));
}

const unnegatedClauses = (text: string): string[] =>
  normalizeWhitespace(text)
    .split(/[.;!?:]|,\s+(?:but|so|and|or)\b/)
    .filter((clause) => !CLAUSE_NEGATION.test(clause));

const ROLLING_APPLICATIONS = /\b(?:applications?|submissions?)\b.{0,40}?\b(?:are|is)\s+rolling\b/i;

const WHILE_FUNDS_REMAIN =
  /\b(?:as\s+long\s+as|while|until)\s+(?:the\s+)?(?:funds?|funding)\s+(?:remains?|lasts?|(?:is|are)\s+(?:still\s+)?(?:available|exhausted|depleted|expended)|runs?\s+out)\b/i;

const DATED_BOUND =
  /\b(?:until|through|before|by)\s+(?:the\s+)?(?:deadline|closing\s+date|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\d{1,2}\/\d{1,2})/i;

/**
 * Whether a page says applications stay open past any nominal deadline (#6480): rolling review
 * or applying while funds remain, in a clause with no negation and no dated bound ("reviewed on
 * a rolling basis until March 1" closes on March 1).
 */
export function statesOpenEndedApplications(text: string): boolean {
  return unnegatedClauses(text).some(
    (clause) =>
      (ROLLING_REVIEW.test(clause) ||
        ROLLING_APPLICATIONS.test(clause) ||
        WHILE_FUNDS_REMAIN.test(clause)) &&
      !DATED_BOUND.test(clause),
  );
}
