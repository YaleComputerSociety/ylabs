import * as cheerio from 'cheerio';
import {
  sourceChromeTextPattern,
  stripInlineUrls,
  stripLeadingSectionHeadingChrome,
} from '../../utils/descriptionHygiene';
import { redactDirectContactInfo } from '../../utils/contactRedaction';

/**
 * Pure judging core for a department's for-credit undergraduate research route.
 *
 * A department course page establishes a fact about the department and about
 * nothing smaller, so this module never names a research entity. It answers one
 * question about one page: does this page say, in its own words, that the
 * department offers undergraduate research for course credit, and which sentence
 * says so. The caller attaches the answer to the department's `OrgUnit` (#2214).
 */

export const COURSE_CREDIT_ROUTE_MAX_EVIDENCE_LENGTH = 400;

/**
 * A named for-credit route. `independent research` is deliberately absent, because
 * it names an activity rather than a course: calibration against the 13 recovered
 * department pages showed it accepting a page that is entirely about summer
 * fellowship funding and names no course at all. The credit-or-code clause below
 * now refuses that particular page on its own, so the exclusion is no longer the
 * only guard against it; what the exclusion still decides is a sentence that
 * pairs the phrase with a catalog code and never mentions credit.
 */
const ROUTE_PHRASE_PATTERN =
  /\b(?:directed research|independent study|senior (?:essays?|thes[ei]s|projects?)|research (?:courses?|tutorials?)|senior research (?:courses?|requirements?))\b/i;

/** Words that make a sentence about earning credit rather than about an activity. */
const CREDIT_WORD_PATTERN =
  /\b(?:for credit|course credit|academic credit|credits?|receives? credit|full credit|half credit)\b/i;

/** A Yale catalog code, e.g. `PSYC 4925`, `HIST 4995`, `MB&B 4900`, `S&DS 4910`, `ASTR 490a`. */
const COURSE_CODE_PATTERN = /\b[A-Z]{2,6}(?:&[A-Z]{1,4})? ?\d{3,4}[ab]?\b/;

const UNDERGRADUATE_AUDIENCE_PATTERN =
  /\b(?:undergraduates?|undergraduate students?|majors?|seniors?|juniors?|sophomores?|first[- ]years?|yale college|students?)\b/i;

/**
 * A catalog or course-search index root describes every department at once, so
 * citing one would attribute a whole-university page to a single department.
 */
const CATALOG_OR_COURSE_SEARCH_INDEX_ROOT =
  /^(?:catalog\.yale\.edu\/ycps|courses\.yale\.edu|catalog\.yale\.edu\/courses)\/?$/i;

export function isCatalogOrCourseSearchIndexRootUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostPath = `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/g, '')}`;
    return CATALOG_OR_COURSE_SEARCH_INDEX_ROOT.test(hostPath);
  } catch {
    return false;
  }
}

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const sentenceList = (text: string): string[] =>
  normalizeText(text)
    .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
    ?.map(normalizeText)
    .filter(Boolean) || [];

export interface CourseCreditRoutePage {
  headings: string;
  body: string;
}

export function readCourseCreditRoutePage(html: string): CourseCreditRoutePage {
  const $ = cheerio.load(html);
  const root = $('main').length ? $('main').first().clone() : $('body').clone();
  root.find('script, style, nav, header, footer, .breadcrumb, .breadcrumbs').remove();
  const headings = normalizeText($('h1, h2, h3').text());
  const chunks = root
    .find('p, li')
    .toArray()
    .map((node) => normalizeText($(node).text()))
    .filter(Boolean);
  return {
    headings,
    body: normalizeText((chunks.length > 0 ? chunks.join(' ') : root.text()) || ''),
  };
}

/**
 * A qualifying sentence names the route or names credit, and separately names
 * credit or a catalog code. Requiring the route phrase and the credit word in
 * the same sentence lost six of the ten departments that do document a route,
 * because a department states the route in its page title and the credit in
 * prose: the History page says "Seniors receive course credit ... by enrolling
 * in HIST 4995/4996" and never repeats "senior essay". Licensing the sentence
 * from the page headings instead was worse, because it let any sentence carrying
 * a catalog code qualify, and picked an Economics econometrics requirement over
 * that page's senior-essay prose.
 */
export function courseCreditRouteEvidenceSentences(page: CourseCreditRoutePage): string[] {
  const seen = new Set<string>();
  return sentenceList(stripInlineUrls(page.body))
    .map(stripLeadingSectionHeadingChrome)
    .map((sentence) => normalizeText(redactDirectContactInfo(sentence)))
    .filter((sentence) => sentence.length >= 40)
    .filter((sentence) => sentence.length <= COURSE_CREDIT_ROUTE_MAX_EVIDENCE_LENGTH)
    .filter((sentence) => /^[A-Z“"(]/.test(sentence))
    .filter((sentence) => !sourceChromeTextPattern.test(sentence))
    .filter((sentence) => ROUTE_PHRASE_PATTERN.test(sentence) || CREDIT_WORD_PATTERN.test(sentence))
    .filter((sentence) => CREDIT_WORD_PATTERN.test(sentence) || COURSE_CODE_PATTERN.test(sentence))
    .filter((sentence) => {
      const key = sentence.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * A sentence that names the route itself is the better citation, so it wins over
 * one that only names credit. Without this the Molecular Biophysics page cites a
 * distinction-with-honours credit threshold instead of its senior-project course.
 */
export function bestCourseCreditRouteQuote(sentences: string[]): string {
  return sentences.find((sentence) => ROUTE_PHRASE_PATTERN.test(sentence)) ?? sentences[0];
}

export interface CourseCreditRouteReading {
  evidenceQuote: string;
  supportingQuoteCount: number;
}

export function readCourseCreditRouteFromHtml(
  html: string,
  sourceUrl: string,
): CourseCreditRouteReading | null {
  if (isCatalogOrCourseSearchIndexRootUrl(sourceUrl)) return null;
  const page = readCourseCreditRoutePage(html);
  if (!UNDERGRADUATE_AUDIENCE_PATTERN.test(`${page.headings} ${page.body}`)) return null;
  if (!ROUTE_PHRASE_PATTERN.test(`${page.headings} ${page.body}`)) return null;
  const sentences = courseCreditRouteEvidenceSentences(page);
  if (sentences.length === 0) return null;
  return {
    evidenceQuote: bestCourseCreditRouteQuote(sentences),
    supportingQuoteCount: sentences.length,
  };
}

/**
 * Confines discovery to the seed's own subtree rather than its host, because a
 * department host also serves pages belonging to other programs on it, and a
 * host-wide crawl is how an unrelated page becomes a department's cited
 * evidence.
 */
export function isWithinCrawlSubtree(seedUrl: string, candidateUrl: string): boolean {
  let seed: URL;
  let candidate: URL;
  try {
    seed = new URL(seedUrl);
    candidate = new URL(candidateUrl);
  } catch {
    return false;
  }
  if (seed.protocol !== candidate.protocol) return false;
  if (seed.hostname.toLowerCase() !== candidate.hostname.toLowerCase()) return false;
  const seedSegments = seed.pathname.split('/').filter(Boolean).slice(0, -1);
  const candidateSegments = candidate.pathname.split('/').filter(Boolean);
  if (candidateSegments.length < seedSegments.length) return false;
  return seedSegments.every(
    (segment, index) => candidateSegments[index]?.toLowerCase() === segment.toLowerCase(),
  );
}
