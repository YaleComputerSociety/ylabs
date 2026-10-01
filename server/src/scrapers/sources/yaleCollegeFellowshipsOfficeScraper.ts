/**
 * Public-page Yale fellowship catalog scraper.
 *
 * This source keeps Fellowship rows fresh from official Yale pages while
 * treating gated CommunityForce URLs as application links, not fetch targets.
 */
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { Fellowship } from '../../models/fellowship';
import { getCached, setCached } from '../snapshotCache';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import {
  NAMED_PROGRAM_DATE_SOURCE,
  NUMERIC_PROGRAM_DATE_SOURCE,
  OPTIONAL_STATED_CLOCK_TIME,
  parseProgramDate,
} from '../utils/programDeadline';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { assertPublicHttpUrl } from '../../utils/ssrfGuard';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { sanitizeStoredCatalogDescription } from '../../utils/descriptionHygiene';
import { humanizeProgramLinkLabel } from '../../utils/programLinkLabel';
import { normalizedProgramTitleKey, primaryConcatenatedAwardTitle } from '../../utils/programTitle';
import { isUnhelpfulProgramUrl } from '../../utils/researchHomeWebsiteUrl';
import { eligibilitySentences, eligibilityStatement } from '../utils/programEligibilityStatement';
import { resolveFundYearOfStudy } from '../utils/fundYearOfStudy';

export const YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE = 'yale-college-fellowships-office';

const MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL = 'https://macmillan.yale.edu/fellowships-and-grants';

const CBEY_FUNDING_OPPORTUNITIES_URL = 'https://cbey.yale.edu/funding-opportunities';

export const STUDENT_FACULTY_AWARDS_INDEX_URL =
  'https://college.yale.edu/life-at-yale/student-faculty-awards';

export const STEM_FELLOWSHIPS_FUNDING_HUB_URL =
  'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale';

// The aggregate MacMillan "undergraduate research grants" slug is not a live
// listing page (it 302-redirects to the site search). It is recorded as a
// crawl-seed-only / never-cite index root so that if it is ever encountered it
// can never be persisted as a source (#516/#549); coverage of the councils'
// undergraduate research / senior-essay grants comes from directly seeding each
// council's own canonical grant page below.
export const MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT =
  'https://macmillan.yale.edu/undergraduate-research-grants';

// Individual MacMillan area-studies councils publish their own undergraduate
// research / senior-essay grant pages beyond the central fellowships-and-grants
// catalog. Each is a citable per-program detail page (self-referential source);
// seeded directly because the aggregate listing root above is not a live page.
export const MACMILLAN_COUNCIL_GRANT_PAGE_URLS = [
  'https://macmillan.yale.edu/latam/student-grants-and-prizes',
  'https://macmillan.yale.edu/southasia/undergraduate-grants',
  'https://macmillan.yale.edu/europe/student-grants-and-fellowships',
  'https://macmillan.yale.edu/reees/grants-and-fellowships-undergraduate-students',
  'https://macmillan.yale.edu/southeast-asia/grants-students',
  'https://macmillan.yale.edu/eastasia/fellowships-grants',
];

export const DEFAULT_PAGE_URLS = [
  'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
  STEM_FELLOWSHIPS_FUNDING_HUB_URL,
  `${STEM_FELLOWSHIPS_FUNDING_HUB_URL}/yale-college-first-year-summer-research-fellowship`,
  `${STEM_FELLOWSHIPS_FUNDING_HUB_URL}/stars/stars-summer-research-program`,
  'https://wti.yale.edu/initiatives/undergraduate',
  'https://medicine.yale.edu/whr/training/',
  'https://ycmd.yale.edu/education/summer-undergraduate-internships',
  'https://economics.yale.edu/undergraduate/tobin-ra',
  'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
  STUDENT_FACULTY_AWARDS_INDEX_URL,
  'https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program',
  MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL,
  `${MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL}?page=1`,
  `${MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL}?page=2`,
  `${MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL}?page=3`,
  CBEY_FUNDING_OPPORTUNITIES_URL,
  ...MACMILLAN_COUNCIL_GRANT_PAGE_URLS,
];

export const FUNDING_YALE_SITEMAP_URLS = ['https://funding.yale.edu/sitemap.xml'];

const MAX_FUNDING_YALE_PROGRAM_PAGES = 250;

const FUNDING_YALE_FIND_FUNDING_HUB_SLUGS = new Set([
  'search-fellowships',
  'external-awards-non-yale',
  'yale-fellowships-offered-through',
  'getting-started',
  'other-funding',
  'alternative-funding-options',
  'define-your-project',
  'identify-goals',
  'make-contacts',
  'class-year',
  'uk-fellowships',
  'uk-fellowships-direct-application',
  'uk-fellowship-applications-through',
  'uk-irish-graduate-courses',
  'finding-uk-graduate-course',
  'graduate-study-uk-ireland-0',
  'apply-marshall-rhodes',
]);

const PUBLIC_YALE_HOSTS = new Set([
  'funding.yale.edu',
  'yalecollege.yale.edu',
  'college.yale.edu',
  'science.yalecollege.yale.edu',
  'wti.yale.edu',
  'medicine.yale.edu',
  'ycmd.yale.edu',
  'economics.yale.edu',
  'engineering.yale.edu',
  'macmillan.yale.edu',
  'cbey.yale.edu',
  'crisp.yale.edu',
  'sumry.yale.edu',
  'gsas.yale.edu',
]);

const MOVED_YALE_COLLEGE_FINANCIAL_AWARD_URLS: Record<string, string> = {
  '/finances/financial-awards-prizes/mellon-mays-undergraduate-fellowship-program':
    'https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program',
};

export interface FellowshipCatalogCandidate {
  sourceKey: string;
  sourceFingerprint: string;
  title: string;
  summary?: string;
  description?: string;
  applicationInformation?: string;
  applicationMaterials?: string[];
  researchFocused?: boolean;
  researchFocusExplicitNegative?: boolean;
  sourcePageKind?: 'catalog' | 'detail';
  sourceUrl: string;
  applicationLink?: string;
  links: Array<{ label: string; url: string }>;
  deadline?: Date;
  applicationOpenDate?: Date;
  contactOffice?: string;
  contactEmail?: string;
  eligibility?: string;
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  isAcceptingApplications: boolean;
  reviewRequired: boolean;
}

type FetchPage = (url: string, useCache: boolean) => Promise<string>;

export interface OwnedFellowshipRow {
  sourceKey?: string;
  title?: string;
  sourceUrl?: string;
}

interface YaleCollegeFellowshipsOfficeScraperDeps {
  pageUrls?: string[];
  sitemapUrls?: string[];
  fetchPage?: FetchPage;
  retryDelay?: (attempt: number) => Promise<void>;
  loadOwnedRows?: () => Promise<OwnedFellowshipRow[]>;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sourceKeyForTitle(title: string): string {
  return `${YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE}:${slugify(title)}`;
}

function normalizedCandidateTitle(value: string): string {
  const cleaned = normalizeWhitespace(value)
    .replace(/^ale College\b/, 'Yale College')
    .replace(/\s+Learn more about\b.*$/i, '')
    .replace(/\s+Read More\s*$/i, '')
    .trim();
  return primaryConcatenatedAwardTitle(cleaned);
}

const DOUBLED_SCHEME_RE = /^https?:\/\/(https?)(?::\/\/|\/\/)/i;

function absoluteUrl(rawUrl: string | undefined, pageUrl: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim().replace(DOUBLED_SCHEME_RE, '$1://');
  if (!trimmed || trimmed.startsWith('#') || /^mailto:/i.test(trimmed)) return undefined;
  try {
    return new URL(trimmed, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function normalizeLinkUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    if (hostIsOrIsUnder(parsed.hostname, 'communityforce.com')) parsed.protocol = 'https:';
    if (parsed.hostname === 'studentgrants.yale.edu') parsed.protocol = 'https:';
    // An application is submitted through these, so never hand a student the
    // plaintext spelling of one when the host serves https.
    if (applicationPortalKind(parsed.toString())) parsed.protocol = 'https:';
    if (parsed.hostname === 'yalecollege.yale.edu') {
      const movedUrl =
        MOVED_YALE_COLLEGE_FINANCIAL_AWARD_URLS[parsed.pathname.toLowerCase().replace(/\/$/, '')];
      if (movedUrl) return movedUrl;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function isPublicYaleUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return PUBLIC_YALE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function hostIsOrIsUnder(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isYaleOwnedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return hostIsOrIsUnder(new URL(url).hostname.toLowerCase(), 'yale.edu');
  } catch {
    return false;
  }
}

/**
 * Hosts that exist to receive an application, so a link to one is the way in
 * whatever its anchor text says.
 */
const APPLICATION_MANAGEMENT_HOSTS = [
  'interfolio.com',
  'slideroom.com',
  'submittable.com',
  'smapply.io',
  'smapply.org',
  'awardspring.com',
  'fluidreview.com',
];

/**
 * General-purpose form hosts. These also serve surveys and sign-up sheets, so a
 * link to one counts as an application route only when its anchor text says so.
 */
const GENERAL_FORM_HOSTS = [
  'forms.gle',
  'jotform.com',
  'wufoo.com',
  'formstack.com',
  'qualtrics.com',
  'typeform.com',
  'airtable.com',
];

function applicationPortalKind(
  url: string | undefined,
): 'application-management' | 'general-form' | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (APPLICATION_MANAGEMENT_HOSTS.some((host) => hostIsOrIsUnder(hostname, host))) {
    return 'application-management';
  }
  if (GENERAL_FORM_HOSTS.some((host) => hostIsOrIsUnder(hostname, host))) return 'general-form';
  // Google hosts a form under a path rather than a host of its own, so the path
  // is what separates a form from an unrelated document or spreadsheet.
  if (
    (hostIsOrIsUnder(hostname, 'google.com') || hostIsOrIsUnder(hostname, 'docs.google.com')) &&
    /^\/forms\//i.test(parsed.pathname)
  ) {
    return 'general-form';
  }
  return undefined;
}

function indexSeedKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.search = '';
    parsed.hash = '';
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.hostname}${pathname}`;
  } catch {
    return url;
  }
}

const STEM_FELLOWSHIPS_LANDING_URL = 'https://science.yalecollege.yale.edu/stem-fellowships';

const INDEX_SEED_ONLY_URL_KEYS = new Set(
  [
    STUDENT_FACULTY_AWARDS_INDEX_URL,
    STEM_FELLOWSHIPS_FUNDING_HUB_URL,
    STEM_FELLOWSHIPS_LANDING_URL,
    MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT,
  ].map(indexSeedKey),
);

function isIndexSeedOnlyUrl(url: string | undefined): boolean {
  if (!url) return false;
  return INDEX_SEED_ONLY_URL_KEYS.has(indexSeedKey(url));
}

function isFundingYaleIndexOrHubUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'funding.yale.edu') return false;
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    if (pathname === '/find-funding') return true;
    const childMatch = pathname.match(/^\/find-funding\/([^/]+)$/);
    return !!childMatch && FUNDING_YALE_FIND_FUNDING_HUB_SLUGS.has(childMatch[1]);
  } catch {
    return false;
  }
}

function isCommunityForceUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return hostIsOrIsUnder(new URL(url).hostname.toLowerCase(), 'communityforce.com');
  } catch {
    return false;
  }
}

function isRecordSpecificApplicationUrl(url: string | undefined): boolean {
  if (!url || !isCommunityForceUrl(url)) return false;
  try {
    const parsed = new URL(url);
    return /^\/Funds\/FundDetails\.aspx$/i.test(parsed.pathname) && parsed.searchParams.size > 0;
  } catch {
    return false;
  }
}

const LINK_SHORTENER_HOSTS = ['bit.ly', 'tinyurl.com', 'ow.ly', 'goo.gl'];

function isLinkShortenerUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return LINK_SHORTENER_HOSTS.some((host) => hostIsOrIsUnder(hostname, host));
  } catch {
    return false;
  }
}

function isStudentGrantsUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase() === 'studentgrants.yale.edu';
  } catch {
    return false;
  }
}

function isHtmlLikeUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return !/\.(?:pdf|docx?|xlsx?|csv|zip|jpg|jpeg|png|gif|webp)(?:$|[?#])/i.test(pathname);
  } catch {
    return false;
  }
}

function isGenericCatalogTitle(title: string): boolean {
  const normalized = normalizeWhitespace(title);
  return (
    /^(?:about|advising|administering|contact|connect|find|prepare|search)\b/i.test(normalized) ||
    /\b(?:alternative funding|funding options|funding sources|(?:student )?grants?(?: and| &)? fellowships? database|student grants database)\b/i.test(
      normalized,
    ) ||
    /\b(?:faculty|staff|advisers?|advisors?|resources|directory|subjects?)\b/i.test(normalized) ||
    /^(?:fellowships?(?: and funding)?|fellowships and funding directory)$/i.test(normalized) ||
    /offered through|opportunities at yale|fellowships and funding$/i.test(normalized)
  );
}

function isLikelyFellowshipTitle(title: string): boolean {
  const normalized = normalizeWhitespace(title);
  if (!normalized || normalized.length > 180) return false;
  if (/^\d+\s*\(/.test(normalized)) return false;
  if (isGenericCatalogTitle(normalized)) return false;
  return /\b(?:fellowships?|grants?|scholars?|scholarships?|awards?|prizes?|internships?|assistantships?|programs?)\b/i.test(
    normalized,
  );
}

function isGenericPublicYalePath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /(?:about-fellowships|alternative-funding|administering|advising|faculty-staff|contact|connect|prepare|resources|directory|taxonomy|subjects)/i.test(
      pathname,
    );
  } catch {
    return true;
  }
}

function isLikelyPublicFellowshipDetailUrl(url: string): boolean {
  if (!isPublicYaleUrl(url) || !isHtmlLikeUrl(url) || isGenericPublicYalePath(url)) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /(?:find-funding|fellowship|fellowships|grant|grants|scholar|scholars|award|awards|prize|prizes|stem-fellowships|yale-undergraduate-research|undergraduate|internships|tobin-ra|research-internship-program|training\/fellowship|biomedsurf|sumry|research-experiences?)/i.test(
      pathname,
    );
  } catch {
    return false;
  }
}

function isEligibleCandidateHref(url: string): boolean {
  return isCommunityForceUrl(url) || isLikelyPublicFellowshipDetailUrl(url);
}

/**
 * The funding.yale.edu find-funding database is a JS-rendered faceted search, so
 * its listing/index roots expose no crawlable static rows. The site's sitemap is
 * the canonical, complete enumeration of the individual program pages behind it
 * (external awards, Yale fellowships), so it is used as a crawl seed to discover
 * every citable per-program page. The sitemap and every find-funding index/hub
 * root are crawl seeds only and are never emitted as a source citation (#516/#549).
 */
export function parseFundingYaleSitemapProgramUrls(xml: string): string[] {
  const urls = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<>\s]+)\s*<\/loc>/gi)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    let normalized: string;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:') parsed.protocol = 'https:';
      normalized = normalizeLinkUrl(parsed.toString());
    } catch {
      continue;
    }
    if (isFundingYaleIndexOrHubUrl(normalized)) continue;
    if (!isLikelyPublicFellowshipDetailUrl(normalized)) continue;
    urls.add(normalized);
  }
  return Array.from(urls).sort();
}

function isInExcludedPageRegion($link: cheerio.Cheerio<any>): boolean {
  return (
    $link.closest(
      'header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .menu, .sidebar',
    ).length > 0
  );
}

function isInPrimaryContent($: cheerio.CheerioAPI, $link: cheerio.Cheerio<any>): boolean {
  const primaryScopes = $('main, [role="main"], article');
  if (primaryScopes.length === 0) return true;
  return $link.closest('main, [role="main"], article').length > 0;
}

/**
 * A crawl-seed index/hub page (e.g. the Yale College student-faculty awards
 * index) is fetched only to discover the individual award/program pages linked
 * from its primary content. The index root is never parsed into a candidate and
 * never cited as a source; each discovered child page is fetched separately and
 * cites its own URL (self-referential / index-page source guards #516, #549).
 */
export function extractIndexSeedChildDetailUrls(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const urls = new Set<string>();
  for (const link of $('a').toArray()) {
    const $link = $(link);
    if (isInExcludedPageRegion($link) || !isInPrimaryContent($, $link)) continue;
    const rawHref = absoluteUrl($link.attr('href'), pageUrl);
    const href = rawHref ? normalizeLinkUrl(rawHref) : undefined;
    if (!href || isIndexSeedOnlyUrl(href)) continue;
    if (!isLikelyPublicFellowshipDetailUrl(href)) continue;
    urls.add(href);
  }
  return Array.from(urls);
}

const MAX_DETAIL_PROGRAM_LINKS = 12;

const APPLY_LABEL_RE = /\b(?:apply|application|submit)\b/i;

const STUDENT_GRANTS_LABEL_RE = /\bstudent grants\b/i;

/**
 * A Yale program routinely takes its applications on a host Yale does not own, so
 * requiring a Yale host here dropped the only way in: the example in #4086 is a
 * department page whose "Apply Now" button is a Google Form, which left the row
 * with no route at all.
 */
function isProgramRelevantLink(url: string, label: string): boolean {
  if (isCommunityForceUrl(url) || isStudentGrantsUrl(url)) return true;
  const portal = applicationPortalKind(url);
  if (portal === 'application-management') return true;
  if (APPLY_LABEL_RE.test(label) && (isYaleOwnedUrl(url) || portal === 'general-form')) return true;
  if (
    isLinkShortenerUrl(url) &&
    (APPLY_LABEL_RE.test(label) || STUDENT_GRANTS_LABEL_RE.test(label))
  ) {
    return true;
  }
  return isLikelyPublicFellowshipDetailUrl(url);
}

function dedupeProgramLinks(
  links: Array<{ label: string; url: string }>,
): Array<{ label: string; url: string }> {
  const byUrl = new Map<string, { label: string; url: string }>();
  for (const link of links) {
    const url = normalizeLinkUrl(link.url);
    if (!byUrl.has(url)) byUrl.set(url, { label: link.label, url });
  }
  return Array.from(byUrl.values());
}

function inferTerm(text: string): string[] {
  const terms: string[] = [];
  if (/\bsummer\b/i.test(text)) terms.push('Summer');
  if (/\bfall\b/i.test(text)) terms.push('Fall');
  if (/\bspring\b/i.test(text)) terms.push('Spring');
  if (/\byear[-\s]?long\b/i.test(text)) terms.push('Academic Year');
  return Array.from(new Set(terms));
}

/**
 * A purpose has to be stated, not merely mentioned, which is why each of these
 * requires a phrase the way `isResearchFocused` does rather than a bare keyword.
 * Measured on the #4086 example page, the bare keywords read two purposes out of
 * prose that states neither: `course` matched the idiom "Yes of course!", and
 * `international` matched a visa-eligibility answer. A page's only mention of
 * travel is often a FAQ declining to cover it ("Does the program cover my travel
 * cost?"), so the award-instrument word is what separates a funded purpose from a
 * mention of the activity.
 */
const AWARD_INSTRUMENT =
  '(?:grants?|awards?|fellowships?|scholarships?|prizes?|funds?|funding|stipends?|allowances?)';

/**
 * A program names its instrument close to its purpose but rarely adjacent to it,
 * so the two are joined across a bounded gap: "Travel/Research Fellowship" and
 * "Travel Research Grant" both state a travel purpose and both lost it when this
 * required the instrument word to follow immediately.
 */
const nearAwardInstrument = (purpose: string): string =>
  `\\b${purpose}\\b[\\s/&,-]+(?:\\w+[\\s/&,-]+){0,2}${AWARD_INSTRUMENT}\\b`;

const forThePurposeOf = (purpose: string): string =>
  `\\b${AWARD_INSTRUMENT} (?:for|supporting|toward) (?:the |a |an )?${purpose}\\b`;

/**
 * Coursework and tuition state a purpose only when the award pays for them: a page that
 * asks for "a foundation through their coursework", or a research program that also
 * covers one course's tuition, funds research rather than study (#4233).
 */
const STUDY_PURPOSE_RE = new RegExp(
  [
    '\\bstudy abroad\\b',
    '\\bcourse of study\\b',
    '\\b(?:supports?|funds?|covers?|pays?)(?: for)?(?: the)? (?:\\w+ ){0,2}(?:course ?work|tuition)\\b',
    '(?<!can )\\b(?:supports?|funds?) (?:[\\w-]+ ){0,6}study\\b',
    nearAwardInstrument('study'),
    forThePurposeOf('(?:study|course ?work)'),
  ].join('|'),
  'i',
);

const TRAVEL_PURPOSE_RE = new RegExp(
  [
    '\\b(?:study|research|work|intern(?:ship)?s?) abroad\\b',
    '\\binternational travel\\b',
    '\\b(?:defray|offset)s? (?:\\w+ ){0,2}travel (?:costs?|expenses?)\\b',
    nearAwardInstrument('travel'),
    forThePurposeOf('travel'),
  ].join('|'),
  'i',
);

const SERVICE_PURPOSE_RE = new RegExp(
  [
    '\\b(?:public|community) service\\b',
    '\\bservice learning\\b',
    nearAwardInstrument('service'),
    forThePurposeOf('(?:public |community )?service'),
  ].join('|'),
  'i',
);

export function inferPurpose(text: string): string[] {
  const purposes: string[] = [];
  if (isResearchFocused(text)) purposes.push('Research');
  if (STUDY_PURPOSE_RE.test(text)) purposes.push('Study');
  if (TRAVEL_PURPOSE_RE.test(text)) purposes.push('Travel');
  if (SERVICE_PURPOSE_RE.test(text)) purposes.push('Service');
  return Array.from(new Set(purposes));
}

const APPLICATION_HEADING_RE =
  /(?:how to apply|application (?:process|information|requirements?|materials?)|applications? should include|submission)/i;

const MATERIAL_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(?:research|project) proposal\b|\bdescription of (?:the )?proposed research project\b/i,
    'Research proposal',
  ],
  [/\b(?:personal|interest) statement\b/i, 'Personal or interest statement'],
  [/\b(?:curriculum vitae|cv|résumé|resume)\b/i, 'CV or resume'],
  [/\b(?:unofficial |official )?transcript\b/i, 'Transcript'],
  [/\b(?:letter|letters) of recommendation\b|\brecommendation letter\b/i, 'Recommendation letter'],
  [
    /\bmentor (?:letter|recommendation|signature|support)\b|\brecommendation letter from (?:the )?(?:proposed )?(?:yale )?faculty mentor\b/i,
    'Faculty mentor support',
  ],
  [/\b(?:project |research )?budget\b/i, 'Budget'],
  [/\bwriting sample\b/i, 'Writing sample'],
  [/\blanguage evaluation\b/i, 'Language evaluation'],
  [/\bapplication form\b/i, 'Application form'],
];

function applicationSectionText($: cheerio.CheerioAPI): string | undefined {
  const sections: string[] = [];
  $('h2,h3,h4,h5,h6').each((_index, heading) => {
    const title = normalizeWhitespace($(heading).text());
    if (!APPLICATION_HEADING_RE.test(title)) return;

    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const content: string[] = [];
    let sibling = $(heading).next();
    while (sibling.length > 0) {
      const tagName = sibling[0]?.tagName?.toLowerCase() || '';
      if (/^h[2-6]$/.test(tagName)) {
        const siblingLevel = Number.parseInt(tagName.slice(1), 10);
        if (siblingLevel <= level) break;
      }
      const text = normalizeWhitespace(sibling.text());
      if (text) content.push(text);
      sibling = sibling.next();
    }

    const section = normalizeWhitespace([title, ...content].join(' '));
    if (section) sections.push(section);
  });

  $('strong').each((_index, marker) => {
    const title = normalizeWhitespace($(marker).text());
    if (!APPLICATION_HEADING_RE.test(title) || $(marker).closest('h2,h3,h4,h5,h6').length > 0) {
      return;
    }

    const content: string[] = [];
    let sibling = $(marker).closest('p,li,div').first();
    for (let offset = 0; sibling.length > 0 && offset < 12; offset += 1) {
      if (offset > 0 && sibling.is('h2,h3,h4,h5,h6')) break;
      const text = normalizeWhitespace(sibling.text());
      if (text) content.push(text);
      sibling = sibling.next();
    }
    const section = normalizeWhitespace(content.join(' '));
    if (section) sections.push(section);
  });

  const unique = Array.from(new Set(sections));
  return unique.length > 0 ? unique.join('\n').slice(0, 3000) : undefined;
}

function inferApplicationMaterials(text: string): string[] {
  const mentorPattern = MATERIAL_PATTERNS.find(([, label]) => label === 'Faculty mentor support');
  const mentorSupport = mentorPattern?.[0].test(text) ? ['Faculty mentor support'] : [];
  const withoutMentorRecommendation = text.replace(
    /\b(?:a |the )?(?:recommendation )?letter from (?:the )?(?:proposed )?(?:yale )?faculty mentor\b|\bmentor (?:letter|recommendation|signature|support)\b/gi,
    '',
  );

  return MATERIAL_PATTERNS.flatMap(([pattern, label]) => {
    if (label === 'Faculty mentor support') return mentorSupport;
    const searchableText = label === 'Recommendation letter' ? withoutMentorRecommendation : text;
    return pattern.test(searchableText) ? [label] : [];
  });
}

function hasExplicitNegativeResearchFocus(text: string): boolean {
  return /\bdoes not (?:primarily )?focus on\b[^.]{0,80}\bresearch\b|\bnot (?:primarily )?a research\b/i.test(
    text,
  );
}

/**
 * Research the award funds, named by what kind of research it is or by the award it
 * funds. Plurals count, because "Graduate Research Fellowships" states the same purpose
 * as "Research Fellowship", and the dissertation and field forms are how graduate awards
 * state it (#4233).
 */
const RESEARCH_FOCUS_RE = new RegExp(
  [
    String.raw`\b(?:original|independent|summer|faculty[- ]mentored|undergraduate|student|dissertation|pre-dissertation|doctoral|thesis|field|laboratory|primary source) research\b`,
    String.raw`\bresearch (?:projects?|proposals?|experiences?|fellowships?|programs?|grants?|awards?|trips?|internships?|assistantships?)\b`,
    String.raw`\bconduct(?:s|ing)? (?:\w+ ){0,2}research\b`,
  ].join('|'),
  'i',
);

function isResearchFocused(text: string): boolean {
  if (hasExplicitNegativeResearchFocus(text)) return false;
  return RESEARCH_FOCUS_RE.test(text);
}

const TEXT_BLOCK_SELECTOR = 'p, li, dd, dt, td, th, h1, h2, h3, h4, h5, h6, div, br';

function textBlocks(root: cheerio.Cheerio<any>): string[] {
  const copy = root.clone();
  copy.find(TEXT_BLOCK_SELECTOR).before('\n').after('\n');
  return copy.text().split('\n').map(normalizeWhitespace).filter(Boolean);
}

/**
 * The years a page admits, read with the same prose rules as a Student Grants Database
 * fund, where the page's eligibility sentences play the fund's eligibility section. These
 * pages carry no year filter, so prose that names no year emits nothing.
 */
function statedYearOfStudy(blocks: readonly string[], eligibility: readonly string[]): string[] {
  const resolution = resolveFundYearOfStudy(
    [
      { text: eligibility.join(' ¶ '), isEligibilitySection: true },
      { text: blocks.join(' ¶ '), isEligibilitySection: false },
    ],
    [],
  );
  return resolution.kind === 'prose' ? resolution.values : [];
}

function extractEmail(text: string): string | undefined {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function hasExplicitActiveApplicationLanguage(text: string): boolean {
  return /\bapplications?\s+(are\s+)?(now\s+)?open\b|\bcurrently accepting applications\b|\brolling\b|\breview(?:ed|ing)?\s+applications?\s+as\s+(?:we|they)\s+(?:are\s+)?receiv|\bapplications?\s+(?:are\s+)?accepted\s+(?:on\s+a\s+)?(?:rolling|continuous|year[-\s]?round)\b|\bno\s+(?:fixed|set)\s+deadline\b/i.test(
    text,
  );
}

function nearestDateTextForLabel(
  text: string,
  labelPattern: RegExp,
  preferredDirection: 'before' | 'after',
): string {
  const normalized = normalizeWhitespace(text);
  const label = labelPattern.exec(normalized);
  if (!label || label.index === undefined) return '';

  const datePattern = new RegExp(
    `(?:${NAMED_PROGRAM_DATE_SOURCE}|${NUMERIC_PROGRAM_DATE_SOURCE})${OPTIONAL_STATED_CLOCK_TIME}`,
    'gi',
  );
  const before = normalized.slice(Math.max(0, label.index - 100), label.index);
  const datesBefore = Array.from(before.matchAll(datePattern));
  const after = normalized.slice(
    label.index + label[0].length,
    label.index + label[0].length + 120,
  );
  datePattern.lastIndex = 0;
  const closestBeforeMatch = datesBefore.at(-1);
  const closestAfterMatch = datePattern.exec(after);
  const sentenceBoundaryPattern = /[.!?](?:\s|$)/;
  const beforeIsInSentence =
    closestBeforeMatch !== undefined &&
    !sentenceBoundaryPattern.test(
      before.slice((closestBeforeMatch.index || 0) + closestBeforeMatch[0].length),
    );
  const afterIsInSentence =
    closestAfterMatch !== null &&
    !sentenceBoundaryPattern.test(after.slice(0, closestAfterMatch.index));

  if (beforeIsInSentence !== afterIsInSentence) {
    return beforeIsInSentence ? closestBeforeMatch?.[0] || '' : closestAfterMatch?.[0] || '';
  }
  if (preferredDirection === 'after') {
    return closestAfterMatch?.[0] || closestBeforeMatch?.[0] || '';
  }
  return closestBeforeMatch?.[0] || closestAfterMatch?.[0] || '';
}

function bestDeadlineText(text: string): string {
  return nearestDateTextForLabel(
    text,
    /\bdeadline\s+for\s+submission\b|\b(?:application\s+)?deadline\b|\bapplications?\s+due\b|\b(?:apply|submit(?:\s+your\s+application)?|due)\s+by\b/i,
    'after',
  );
}

function bestApplicationOpenText(text: string): string {
  return nearestDateTextForLabel(
    text,
    /\bapplication\s+(?:opens?|open\s+date)\b|\bapplications?\s+open\b/i,
    'before',
  );
}

function fingerprintCandidate(
  candidate: Omit<FellowshipCatalogCandidate, 'sourceFingerprint'>,
): string {
  const stable = {
    title: candidate.title,
    summary: candidate.summary || '',
    description: candidate.description || '',
    applicationInformation: candidate.applicationInformation || '',
    applicationMaterials: candidate.applicationMaterials || [],
    researchFocused: candidate.researchFocused === true,
    researchFocusExplicitNegative: candidate.researchFocusExplicitNegative === true,
    sourceUrl: candidate.sourceUrl,
    applicationLink: candidate.applicationLink || '',
    deadline: candidate.deadline?.toISOString() || '',
    applicationOpenDate: candidate.applicationOpenDate?.toISOString() || '',
    contactOffice: candidate.contactOffice || '',
    contactEmail: candidate.contactEmail || '',
    eligibility: candidate.eligibility || '',
    yearOfStudy: candidate.yearOfStudy,
    termOfAward: candidate.termOfAward,
    purpose: candidate.purpose,
    globalRegions: candidate.globalRegions,
    citizenshipStatus: candidate.citizenshipStatus,
    isAcceptingApplications: candidate.isAcceptingApplications,
    reviewRequired: candidate.reviewRequired,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function finalizeCandidate(
  candidate: Omit<FellowshipCatalogCandidate, 'sourceFingerprint'>,
): FellowshipCatalogCandidate {
  const applicationLink =
    candidate.applicationLink &&
    !isUnhelpfulProgramUrl(candidate.applicationLink, candidate.sourceUrl)
      ? candidate.applicationLink
      : undefined;
  const links = candidate.links.filter(
    (link) => !isUnhelpfulProgramUrl(link.url, candidate.sourceUrl),
  );
  const sanitized = { ...candidate, applicationLink, links };
  return {
    ...sanitized,
    sourceFingerprint: fingerprintCandidate(sanitized),
  };
}

function compactTitleIdentity(title: string): string {
  return normalizedProgramTitleKey(title);
}

function existingKeyForCandidate(
  byKey: Map<string, FellowshipCatalogCandidate>,
  candidate: FellowshipCatalogCandidate,
): string {
  if (byKey.has(candidate.sourceKey)) return candidate.sourceKey;

  const applicationLink = candidate.applicationLink
    ? normalizeLinkUrl(candidate.applicationLink)
    : undefined;
  if (applicationLink && isRecordSpecificApplicationUrl(applicationLink)) {
    for (const [key, existing] of byKey) {
      const existingUrls = [existing.applicationLink, ...existing.links.map((link) => link.url)]
        .filter((url): url is string => !!url)
        .map(normalizeLinkUrl);
      if (existingUrls.includes(applicationLink)) return key;
    }
  }

  const sourceUrl = normalizeLinkUrl(candidate.sourceUrl);
  for (const [key, existing] of byKey) {
    const existingSourceUrl = normalizeLinkUrl(existing.sourceUrl);
    const existingLinkedUrls = existing.links.map((link) => normalizeLinkUrl(link.url));
    const candidateLinkedUrls = candidate.links.map((link) => normalizeLinkUrl(link.url));
    if (
      (candidate.sourcePageKind === 'detail' &&
        existing.sourcePageKind === 'catalog' &&
        existingLinkedUrls.includes(sourceUrl)) ||
      (existing.sourcePageKind === 'detail' &&
        candidate.sourcePageKind === 'catalog' &&
        candidateLinkedUrls.includes(existingSourceUrl))
    ) {
      return key;
    }
  }

  const titleIdentity = compactTitleIdentity(candidate.title);
  for (const [key, existing] of byKey) {
    if (compactTitleIdentity(existing.title) === titleIdentity) return key;
  }

  return candidate.sourceKey;
}

function preferredTitle(
  existing: FellowshipCatalogCandidate,
  incoming: FellowshipCatalogCandidate,
): string {
  const existingPunctuation = (existing.title.match(/['’.-]/g) || []).length;
  const incomingPunctuation = (incoming.title.match(/['’.-]/g) || []).length;
  if (compactTitleIdentity(existing.title) === compactTitleIdentity(incoming.title)) {
    if (incomingPunctuation > existingPunctuation) return incoming.title;
    if (
      incomingPunctuation === existingPunctuation &&
      incoming.title.length > existing.title.length
    ) {
      return incoming.title;
    }
  }
  return existing.title;
}

function upsertCandidate(
  byKey: Map<string, FellowshipCatalogCandidate>,
  candidate: FellowshipCatalogCandidate,
): void {
  const key = existingKeyForCandidate(byKey, candidate);
  const existing = byKey.get(key);
  byKey.set(key, existing ? mergeCandidates(existing, candidate) : candidate);
}

const SUMMARY_NON_DESCRIPTIVE_TOKENS = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'in',
  'to',
  'and',
  'at',
  'on',
  'or',
  'with',
  'yc',
  'ay',
  'academic',
  'year',
  'program',
  'term',
  'semester',
  'session',
  'cycle',
  'spring',
  'summer',
  'fall',
  'autumn',
  'winter',
]);

function singularizeToken(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

function descriptiveTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(singularizeToken),
  );
}

// A catalog row whose only content beyond the program name is its deadline (e.g.
// "<Program> Deadline: Thursday, February 12, 2026 at 11:00pm ET.") carries no
// descriptive value as a summary - the deadline is surfaced separately in KEY
// DATES - so it must not be served as the card/modal BRIEF DESCRIPTION (issue
// #1066). It qualifies as bare when, after removing the deadline clause, every
// remaining token is either part of the title or a generic program/temporal word.
function isBareDeadlineRowContext(text: string, title: string): boolean {
  const withoutDeadline = text
    .replace(/\b(?:application\s+)?deadlines?\b[^.]*\.?/gi, ' ')
    .replace(/\bapplications?\s+(?:are\s+)?due\b[^.]*\.?/gi, ' ');
  const titleTokens = descriptiveTokens(title);
  const residual = withoutDeadline
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word) => !/^\d/.test(word))
    .map(singularizeToken)
    .filter((word) => !titleTokens.has(word) && !SUMMARY_NON_DESCRIPTIVE_TOKENS.has(word));
  return residual.length === 0;
}

/**
 * The administering office is a claim about who runs a program, so it is read off
 * the site the page belongs to rather than assumed. This lane follows links out
 * across Yale, so the fellowships-office constant it used to stamp on every arm
 * described one office's programs and then said the same of a department's and a
 * school's (#4086). A host this map does not name yields no claim.
 */
const ADMINISTERING_OFFICE_BY_HOST: Array<[string, string]> = [
  ['funding.yale.edu', 'Yale Fellowships and Funding'],
  ['fellowships.yale.edu', 'Yale Fellowships and Funding'],
  ['macmillan.yale.edu', 'MacMillan Center'],
  ['cbey.yale.edu', 'Yale Center for Business and the Environment'],
];

function administeringOfficeForPage(pageUrl: string): string {
  let hostname: string;
  try {
    hostname = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
  return ADMINISTERING_OFFICE_BY_HOST.find(([host]) => hostIsOrIsUnder(hostname, host))?.[1] ?? '';
}

function summaryFromRowContext(rowContext: string, title: string): string | undefined {
  const safe = sanitizeStoredCatalogDescription(rowContext);
  if (!safe || safe === title) return undefined;
  if (isBareDeadlineRowContext(safe, title)) return undefined;
  return safe;
}

function candidateFromLink(
  $: cheerio.CheerioAPI,
  link: Parameters<cheerio.CheerioAPI>[0],
  pageUrl: string,
  referenceDate: Date,
): FellowshipCatalogCandidate | undefined {
  const $link = $(link);
  const title = normalizedCandidateTitle($link.text());
  if (!title || !isLikelyFellowshipTitle(title)) return undefined;

  const rawHref = absoluteUrl($link.attr('href'), pageUrl);
  const href = rawHref ? normalizeLinkUrl(rawHref) : undefined;
  if (!href) return undefined;
  if (!isEligibleCandidateHref(href)) return undefined;
  if (isInExcludedPageRegion($link) || !isInPrimaryContent($, $link)) return undefined;

  const contextContainer = $link.closest('li, p, tr, div, section, article');
  const headingContext = $link
    .closest('ul, ol, table, div, section, article')
    .prevAll('h1,h2,h3,h4,h5,h6')
    .slice(0, 4)
    .toArray()
    .map((node) => normalizeWhitespace($(node).text()))
    .join(' ');
  const rowContext = normalizeWhitespace(contextContainer.text());
  const pageContext = normalizeWhitespace($('body').text());
  const contextText = normalizeWhitespace(`${headingContext} ${rowContext}`);
  const deadline = parseProgramDate(bestDeadlineText(contextText), 'deadline', referenceDate);
  const applicationLink =
    isCommunityForceUrl(href) || applicationPortalKind(href) ? href : undefined;
  const sourceUrl = pageUrl;
  const links = [{ label: applicationLink ? 'Application' : title, url: href }];
  const isAcceptingApplications =
    (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
    hasExplicitActiveApplicationLanguage(contextText);

  return finalizeCandidate({
    sourceKey: sourceKeyForTitle(title),
    title,
    summary: summaryFromRowContext(rowContext, title),
    description: undefined,
    applicationInformation: undefined,
    applicationMaterials: APPLICATION_HEADING_RE.test(contextText)
      ? inferApplicationMaterials(contextText)
      : [],
    researchFocused: isResearchFocused(contextText),
    researchFocusExplicitNegative: hasExplicitNegativeResearchFocus(contextText),
    sourcePageKind: 'catalog',
    sourceUrl,
    applicationLink,
    links,
    deadline,
    applicationOpenDate: undefined,
    contactOffice: administeringOfficeForPage(pageUrl),
    contactEmail: extractEmail(contextText) || extractEmail(pageContext),
    yearOfStudy: [],
    termOfAward: inferTerm(contextText || pageContext),
    purpose: inferPurpose(contextText || pageContext),
    globalRegions: [],
    citizenshipStatus: [],
    isAcceptingApplications,
    reviewRequired: !deadline,
  });
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function candidateFromMacmillanOpportunityRow(
  $: cheerio.CheerioAPI,
  row: Parameters<cheerio.CheerioAPI>[0],
  pageUrl: string,
  referenceDate: Date,
): FellowshipCatalogCandidate | undefined {
  const $row = $(row);
  const $link = $row.find('.node-teaser__heading a').first();
  const title = normalizedCandidateTitle($link.text());
  if (!title || isGenericCatalogTitle(title)) return undefined;

  const rawHref = absoluteUrl($link.attr('href'), pageUrl);
  const href = rawHref ? normalizeLinkUrl(rawHref) : undefined;
  if (!href) return undefined;

  const contactOffice = normalizeWhitespace($row.find('.node-teaser__groups').first().text());
  const summaryText = normalizeWhitespace($row.find('.node-teaser__summary').first().text());
  const rowContext = normalizeWhitespace(`${title} ${summaryText}`);
  const deadline = parseProgramDate(bestDeadlineText(rowContext), 'deadline', referenceDate);
  // An opportunity row has no page of its own on this site: its heading links straight to
  // the fund record, and a short link there redirects to one (#4233).
  const applicationLink =
    isCommunityForceUrl(href) || applicationPortalKind(href) || isLinkShortenerUrl(href)
      ? href
      : undefined;
  const links = [{ label: applicationLink ? 'Application' : title, url: href }];
  const isAcceptingApplications =
    (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
    hasExplicitActiveApplicationLanguage(rowContext);
  const summaryBlocks = summaryText ? [summaryText] : [];
  const eligibility = eligibilitySentences(summaryBlocks);

  return finalizeCandidate({
    sourceKey: sourceKeyForTitle(title),
    title,
    summary: summaryFromRowContext(summaryText, title),
    description: undefined,
    applicationInformation: undefined,
    applicationMaterials: [],
    researchFocused: isResearchFocused(rowContext),
    researchFocusExplicitNegative: hasExplicitNegativeResearchFocus(rowContext),
    sourcePageKind: 'catalog',
    sourceUrl: pageUrl,
    applicationLink,
    links,
    deadline,
    applicationOpenDate: undefined,
    contactOffice: contactOffice || administeringOfficeForPage(pageUrl),
    contactEmail: extractEmail(summaryText),
    eligibility: eligibilityStatement(eligibility),
    yearOfStudy: statedYearOfStudy(summaryBlocks, eligibility),
    termOfAward: inferTerm(rowContext),
    purpose: inferPurpose(rowContext),
    globalRegions: [],
    citizenshipStatus: [],
    isAcceptingApplications,
    reviewRequired: !deadline,
  });
}

function candidatesFromMacmillanOpportunityPage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  referenceDate: Date,
): FellowshipCatalogCandidate[] {
  if (hostnameOf(pageUrl) !== 'macmillan.yale.edu') return [];
  return $('.node-teaser--opportunity')
    .toArray()
    .map((row) => candidateFromMacmillanOpportunityRow($, row, pageUrl, referenceDate))
    .filter((candidate): candidate is FellowshipCatalogCandidate => !!candidate);
}

function candidateFromCbeyProgramRow(
  $: cheerio.CheerioAPI,
  row: Parameters<cheerio.CheerioAPI>[0],
  pageUrl: string,
): FellowshipCatalogCandidate | undefined {
  const $row = $(row);
  const $link = $row.find('.node-teaser__title a').first();
  const title = normalizedCandidateTitle($link.text());
  if (!title || isGenericCatalogTitle(title)) return undefined;

  const rawHref = absoluteUrl($link.attr('href'), pageUrl);
  const href = rawHref ? normalizeLinkUrl(rawHref) : undefined;
  if (!href) return undefined;

  const applicationLink =
    isCommunityForceUrl(href) || applicationPortalKind(href) ? href : undefined;
  const links = [{ label: applicationLink ? 'Application' : title, url: href }];

  return finalizeCandidate({
    sourceKey: sourceKeyForTitle(title),
    title,
    summary: undefined,
    description: undefined,
    applicationInformation: undefined,
    applicationMaterials: [],
    researchFocused: isResearchFocused(title),
    researchFocusExplicitNegative: hasExplicitNegativeResearchFocus(title),
    sourcePageKind: 'catalog',
    sourceUrl: pageUrl,
    applicationLink,
    links,
    deadline: undefined,
    applicationOpenDate: undefined,
    contactOffice: administeringOfficeForPage(pageUrl),
    contactEmail: undefined,
    yearOfStudy: [],
    termOfAward: inferTerm(title),
    purpose: inferPurpose(title),
    globalRegions: [],
    citizenshipStatus: [],
    isAcceptingApplications: false,
    reviewRequired: true,
  });
}

function candidatesFromCbeyFundingPage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): FellowshipCatalogCandidate[] {
  if (hostnameOf(pageUrl) !== 'cbey.yale.edu') return [];
  return $('.node-teaser--program')
    .toArray()
    .map((row) => candidateFromCbeyProgramRow($, row, pageUrl))
    .filter((candidate): candidate is FellowshipCatalogCandidate => !!candidate);
}

const TEASER_NODE_CLASS_RE = /\bnode-{1,2}(?:view-mode-)?teaser\b/i;

function primaryContentNode($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
  return $('.node, article')
    .filter((_index, node) => {
      const $node = $(node);
      return (
        !isInExcludedPageRegion($node) && !TEASER_NODE_CLASS_RE.test($node.attr('class') || '')
      );
    })
    .first();
}

function detailContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
  const specificContent = primaryContentNode($);
  const primaryContent = $('main, [role="main"]').first();
  return specificContent.length > 0
    ? specificContent
    : primaryContent.length > 0
      ? primaryContent
      : $('body');
}

function chromeFreeContent(contentRoot: cheerio.Cheerio<any>): cheerio.Cheerio<any> {
  const chromeFreeRoot = contentRoot.clone();
  chromeFreeRoot
    .find(
      'script, style, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .breadcrumbs, .menu, .sidebar',
    )
    .remove();
  return chromeFreeRoot;
}

export type NonProgramPageShape =
  | 'cms-post'
  | 'news-roundup'
  | 'program-hub'
  | 'advising-page'
  | 'sign-in-wall';

const CMS_POST_CONTENT_TYPES = new Set([
  'narrative',
  'news',
  'news-item',
  'news-article',
  'article',
  'story',
  'blog',
  'blog-post',
  'event',
]);

function cmsContentTypes($: cheerio.CheerioAPI): string[] {
  const classes = [$('body').attr('class') || '', primaryContentNode($).attr('class') || ''].join(
    ' ',
  );
  const types = new Set<string>();
  for (const match of classes.matchAll(/\b(?:page-)?node-{1,2}type-([a-z0-9_-]+)/gi)) {
    types.add(match[1].toLowerCase().replace(/_/g, '-'));
  }
  return Array.from(types);
}

const DATED_ARTICLE_PATH_RE = /\/(?:19|20)\d{2}\/\d{1,2}\/\d{1,2}\//;

function isDatedArticleUrl(url: string): boolean {
  try {
    return DATED_ARTICLE_PATH_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isSignInWall($: cheerio.CheerioAPI): boolean {
  return $('form input[type="password"]').length > 0;
}

interface ContentLinkCensus {
  fundRecords: number;
  otherPrograms: number;
  datedArticles: number;
  awardHeadings: number;
}

function contentLinkCensus(
  $: cheerio.CheerioAPI,
  content: cheerio.Cheerio<any>,
  pageUrl: string,
  pageTitle: string,
): ContentLinkCensus {
  const fundRecords = new Set<string>();
  const otherPrograms = new Set<string>();
  const datedArticles = new Set<string>();
  const pageKey = indexSeedKey(normalizeLinkUrl(pageUrl));
  const pageTitleKey = compactTitleIdentity(pageTitle);
  for (const link of content.find('a').toArray()) {
    const rawUrl = absoluteUrl($(link).attr('href'), pageUrl);
    if (!rawUrl) continue;
    const url = normalizeLinkUrl(rawUrl);
    if (isRecordSpecificApplicationUrl(url)) {
      fundRecords.add(url);
      continue;
    }
    if (isDatedArticleUrl(url)) {
      datedArticles.add(indexSeedKey(url));
      continue;
    }
    const label = normalizedCandidateTitle($(link).text());
    if (
      indexSeedKey(url) !== pageKey &&
      isLikelyPublicFellowshipDetailUrl(url) &&
      isLikelyFellowshipTitle(label) &&
      compactTitleIdentity(label) !== pageTitleKey
    ) {
      otherPrograms.add(indexSeedKey(url));
    }
  }
  const awardHeadings = new Set<string>();
  for (const heading of content.find('h2, h3, h4').toArray()) {
    const label = normalizedCandidateTitle($(heading).text());
    const key = compactTitleIdentity(label);
    if (key && key !== pageTitleKey && namesAnAward(label)) awardHeadings.add(key);
  }
  return {
    fundRecords: fundRecords.size,
    otherPrograms: otherPrograms.size,
    datedArticles: datedArticles.size,
    awardHeadings: awardHeadings.size,
  };
}

const AWARD_NOUN_RE =
  /^(?:fellowships?|grants?|scholars?|scholarships?|awards?|prizes?|internships?|assistantships?|programs?)$/i;
const AWARD_NAME_CONNECTOR_RE =
  /^(?:and|&|or|the|a|an|of|for|in|on|to|with|by|about|this|that|these|our|your|its|each|per)$/i;

function titleWords(title: string): string[] {
  return normalizeWhitespace(title)
    .replace(/(?:\s*\([^)]*\)|\s+\d{4})+$/, '')
    .split(' ')
    .map((word) => word.replace(/^[^\p{L}&]+|[^\p{L}&]+$/gu, ''))
    .filter(Boolean);
}

function isQualifiedAwardNounAt(words: string[], index: number): boolean {
  const qualifier = words[index - 1];
  return (
    AWARD_NOUN_RE.test(words[index] || '') &&
    !!qualifier &&
    !AWARD_NAME_CONNECTOR_RE.test(qualifier)
  );
}

function namesSingleAward(title: string): boolean {
  const words = titleWords(title);
  return isLikelyFellowshipTitle(title) && isQualifiedAwardNounAt(words, words.length - 1);
}

function namesAnAward(label: string): boolean {
  const words = titleWords(label);
  return words.some((_word, index) => isQualifiedAwardNounAt(words, index));
}

function endsInAwardNoun(title: string): boolean {
  const words = titleWords(title);
  return AWARD_NOUN_RE.test(words[words.length - 1] || '');
}

const GENERIC_PAGE_CONTENT_TYPE = 'static-page';

const MIN_DATED_ARTICLES_FOR_ROUNDUP = 3;
const MIN_FUND_RECORDS_FOR_HUB = 2;
const MIN_LISTED_PROGRAMS_FOR_HUB = 3;
const MIN_AWARD_SECTIONS_FOR_HUB = 3;

export function nonProgramPageShape(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): NonProgramPageShape | undefined {
  if (isSignInWall($)) return 'sign-in-wall';
  if (cmsContentTypes($).some((type) => CMS_POST_CONTENT_TYPES.has(type))) return 'cms-post';
  const title = normalizedCandidateTitle($('h1').first().text());
  const census = contentLinkCensus($, chromeFreeContent(detailContentRoot($)), pageUrl, title);
  const singleAwardTitle = namesSingleAward(title);
  if (!singleAwardTitle && census.datedArticles >= MIN_DATED_ARTICLES_FOR_ROUNDUP) {
    return 'news-roundup';
  }
  if (census.awardHeadings >= MIN_AWARD_SECTIONS_FOR_HUB) return 'program-hub';
  if (singleAwardTitle) return undefined;
  if (
    census.fundRecords >= MIN_FUND_RECORDS_FOR_HUB ||
    census.fundRecords + census.otherPrograms >= MIN_LISTED_PROGRAMS_FOR_HUB
  ) {
    return 'program-hub';
  }
  if (cmsContentTypes($).includes(GENERIC_PAGE_CONTENT_TYPE) && !endsInAwardNoun(title)) {
    return 'advising-page';
  }
  return undefined;
}

function candidateFromDetailPage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  referenceDate: Date,
): FellowshipCatalogCandidate | undefined {
  if (isFundingYaleIndexOrHubUrl(pageUrl)) return undefined;
  const title = normalizedCandidateTitle($('h1').first().text());
  if (!title || isGenericCatalogTitle(title)) return undefined;
  if (isIndexSeedOnlyUrl(pageUrl)) return undefined;
  if (!isLikelyFellowshipTitle(title) && !isLikelyPublicFellowshipDetailUrl(pageUrl)) {
    return undefined;
  }

  const contentRoot = detailContentRoot($);
  const chromeFreeRoot = chromeFreeContent(contentRoot);
  const bodyText = normalizeWhitespace(chromeFreeRoot.text());
  const bodyBlocks = textBlocks(chromeFreeRoot);
  const titledBodyText = `${title} ${bodyText}`;
  const eligibility = eligibilitySentences(bodyBlocks);
  const safeDescription = sanitizeStoredCatalogDescription(bodyText, 2000);
  const applicationInformation = applicationSectionText($);
  const deadline = parseProgramDate(bestDeadlineText(bodyText), 'deadline', referenceDate);
  const applicationOpenDate = parseProgramDate(
    bestApplicationOpenText(bodyText),
    'opens',
    referenceDate,
  );
  const links = dedupeProgramLinks(
    contentRoot
      .find('a')
      .toArray()
      .filter((link) => !isInExcludedPageRegion($(link)))
      .map((link) => {
        const rawUrl = absoluteUrl($(link).attr('href'), pageUrl);
        const url = rawUrl ? normalizeLinkUrl(rawUrl) : undefined;
        const rawText = normalizeWhitespace($(link).text());
        const label = url ? humanizeProgramLinkLabel(rawText, url) || rawText || 'Link' : 'Link';
        return url ? { label, url } : undefined;
      })
      .filter((item): item is { label: string; url: string } => !!item)
      .filter((item) => isProgramRelevantLink(item.url, item.label)),
  ).slice(0, MAX_DETAIL_PROGRAM_LINKS);
  // Chosen among the links the candidate keeps, so a chrome link that only labels itself
  // "Application" cannot take the slot and then be dropped, leaving no route (#4233).
  const routeLinks = links.filter((link) => !isUnhelpfulProgramUrl(link.url, pageUrl));
  const applicationLink =
    routeLinks.find((link) => isCommunityForceUrl(link.url))?.url ||
    routeLinks.find((link) => isStudentGrantsUrl(link.url))?.url ||
    routeLinks.find((link) => applicationPortalKind(link.url))?.url ||
    routeLinks.find((link) => /apply|application|student grants/i.test(link.label))?.url;
  const isAcceptingApplications =
    (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
    hasExplicitActiveApplicationLanguage(bodyText);

  return finalizeCandidate({
    sourceKey: sourceKeyForTitle(title),
    title,
    summary: undefined,
    description: safeDescription || undefined,
    applicationInformation,
    applicationMaterials: applicationInformation
      ? inferApplicationMaterials(applicationInformation)
      : [],
    researchFocused: isResearchFocused(titledBodyText),
    researchFocusExplicitNegative: hasExplicitNegativeResearchFocus(bodyText),
    sourcePageKind: 'detail',
    sourceUrl: pageUrl,
    applicationLink,
    links,
    deadline,
    applicationOpenDate,
    contactOffice: administeringOfficeForPage(pageUrl),
    contactEmail: extractEmail(bodyText),
    eligibility: eligibilityStatement(eligibility),
    yearOfStudy: statedYearOfStudy(bodyBlocks, eligibility),
    termOfAward: inferTerm(bodyText),
    purpose: inferPurpose(titledBodyText),
    globalRegions: [],
    citizenshipStatus: [],
    isAcceptingApplications,
    reviewRequired: !deadline,
  });
}

function mergeCandidates(
  existing: FellowshipCatalogCandidate,
  incoming: FellowshipCatalogCandidate,
): FellowshipCatalogCandidate {
  const links = dedupeProgramLinks([...existing.links, ...incoming.links]).slice(
    0,
    MAX_DETAIL_PROGRAM_LINKS,
  );
  const applicationLink = incoming.applicationLink || existing.applicationLink;
  const sourceSpecificity = (url: string): number => {
    try {
      const pathSegments = new URL(url).pathname.split('/').filter(Boolean).length;
      return pathSegments - (isGenericPublicYalePath(url) ? 10 : 0);
    } catch {
      return -100;
    }
  };
  const existingSpecificity = sourceSpecificity(existing.sourceUrl);
  const incomingSpecificity = sourceSpecificity(incoming.sourceUrl);
  const existingIsDetail = existing.sourcePageKind === 'detail';
  const incomingIsDetail = incoming.sourcePageKind === 'detail';
  const evidenceOwner =
    incomingIsDetail !== existingIsDetail
      ? incomingIsDetail
        ? incoming
        : existing
      : incomingSpecificity > existingSpecificity ||
          (incomingSpecificity === existingSpecificity &&
            incoming.description &&
            !existing.description)
        ? incoming
        : existing;
  const evidenceSecond = evidenceOwner === incoming ? existing : incoming;
  const sourceUrl = evidenceOwner.sourceUrl;
  const researchEvidenceOwner = evidenceOwner;
  const researchFocusExplicitNegative =
    researchEvidenceOwner.researchFocusExplicitNegative === true;
  const researchFocused = researchFocusExplicitNegative
    ? false
    : researchEvidenceOwner.researchFocused === true;
  const purpose = Array.from(new Set([...existing.purpose, ...incoming.purpose])).filter(
    (value) => value !== 'Research',
  );
  if (researchFocused) purpose.unshift('Research');
  return finalizeCandidate({
    ...existing,
    title:
      evidenceOwner.sourcePageKind === 'detail'
        ? evidenceOwner.title
        : preferredTitle(existing, incoming),
    sourceKey:
      evidenceOwner.sourcePageKind === 'detail' ? evidenceOwner.sourceKey : existing.sourceKey,
    summary: incoming.summary || existing.summary,
    description: incoming.description || existing.description,
    applicationInformation: incoming.applicationInformation || existing.applicationInformation,
    applicationMaterials: Array.from(
      new Set([...(existing.applicationMaterials || []), ...(incoming.applicationMaterials || [])]),
    ),
    researchFocused,
    researchFocusExplicitNegative,
    sourcePageKind: evidenceOwner.sourcePageKind,
    sourceUrl,
    applicationLink: applicationLink ? normalizeLinkUrl(applicationLink) : undefined,
    links,
    deadline: incoming.deadline || existing.deadline,
    applicationOpenDate: incoming.applicationOpenDate || existing.applicationOpenDate,
    contactOffice: incoming.contactOffice || existing.contactOffice,
    contactEmail: incoming.contactEmail || existing.contactEmail,
    eligibility: evidenceOwner.eligibility || evidenceSecond.eligibility,
    yearOfStudy:
      evidenceOwner.yearOfStudy.length > 0 ? evidenceOwner.yearOfStudy : evidenceSecond.yearOfStudy,
    termOfAward: Array.from(new Set([...existing.termOfAward, ...incoming.termOfAward])),
    purpose,
    globalRegions: Array.from(new Set([...existing.globalRegions, ...incoming.globalRegions])),
    citizenshipStatus: Array.from(
      new Set([...existing.citizenshipStatus, ...incoming.citizenshipStatus]),
    ),
    isAcceptingApplications: existing.isAcceptingApplications || incoming.isAcceptingApplications,
    reviewRequired: existing.reviewRequired && incoming.reviewRequired,
  });
}

export interface FellowshipCatalogPageRead {
  candidates: FellowshipCatalogCandidate[];
  refusedPage?: { shape: NonProgramPageShape; sourceKey: string; title: string };
}

export function readFellowshipCatalogPage(
  html: string,
  pageUrl: string,
  referenceDate: Date = new Date(),
): FellowshipCatalogPageRead {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const byKey = new Map<string, FellowshipCatalogCandidate>();
  const sorted = () => Array.from(byKey.values()).sort((a, b) => a.title.localeCompare(b.title));

  const opportunityRowCandidates = candidatesFromMacmillanOpportunityPage(
    $,
    pageUrl,
    referenceDate,
  );
  if (opportunityRowCandidates.length > 0) {
    for (const candidate of opportunityRowCandidates) upsertCandidate(byKey, candidate);
    return { candidates: sorted() };
  }

  const cbeyProgramCandidates = candidatesFromCbeyFundingPage($, pageUrl);
  if (cbeyProgramCandidates.length > 0) {
    for (const candidate of cbeyProgramCandidates) upsertCandidate(byKey, candidate);
    return { candidates: sorted() };
  }

  const detail = candidateFromDetailPage($, pageUrl, referenceDate);
  if (detail) {
    const shape = nonProgramPageShape($, pageUrl);
    if (shape) {
      return {
        candidates: [],
        refusedPage: { shape, sourceKey: detail.sourceKey, title: detail.title },
      };
    }
    upsertCandidate(byKey, detail);
    return { candidates: sorted() };
  }

  for (const link of $('a').toArray()) {
    const candidate = candidateFromLink($, link, pageUrl, referenceDate);
    if (!candidate) continue;
    upsertCandidate(byKey, candidate);
  }
  return { candidates: sorted() };
}

export function parseFellowshipCatalogPage(
  html: string,
  pageUrl: string,
  referenceDate: Date = new Date(),
): FellowshipCatalogCandidate[] {
  return readFellowshipCatalogPage(html, pageUrl, referenceDate).candidates;
}

function observation(
  field: string,
  value: unknown,
  candidate: FellowshipCatalogCandidate,
): ObservationInput | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return {
    entityType: 'fellowship',
    entityKey: candidate.sourceKey,
    field,
    value,
    sourceUrl: candidate.sourceUrl,
    confidenceOverride: 0.95,
  };
}

function currentSourceObservation(
  field: string,
  value: unknown,
  candidate: FellowshipCatalogCandidate,
): ObservationInput {
  return {
    entityType: 'fellowship',
    entityKey: candidate.sourceKey,
    field,
    value,
    sourceUrl: candidate.sourceUrl,
    confidenceOverride: 0.95,
  };
}

export function candidateToObservations(candidate: FellowshipCatalogCandidate): ObservationInput[] {
  return [
    observation('sourceKey', candidate.sourceKey, candidate),
    observation('sourceName', YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE, candidate),
    observation('sourceUrl', candidate.sourceUrl, candidate),
    observation('sourceFingerprint', candidate.sourceFingerprint, candidate),
    observation('title', candidate.title, candidate),
    observation('summary', candidate.summary, candidate),
    observation('description', candidate.description, candidate),
    currentSourceObservation(
      'applicationInformation',
      candidate.applicationInformation || '',
      candidate,
    ),
    currentSourceObservation(
      'applicationMaterials',
      candidate.applicationMaterials || [],
      candidate,
    ),
    currentSourceObservation('researchFocused', candidate.researchFocused === true, candidate),
    currentSourceObservation('archived', false, candidate),
    observation('applicationLink', candidate.applicationLink, candidate),
    observation('links', candidate.links, candidate),
    observation('deadline', candidate.deadline, candidate),
    observation('applicationOpenDate', candidate.applicationOpenDate, candidate),
    // Asserted rather than emitted-when-present, because the lane is the only
    // writer of this field and it spent its history stamping one office on every
    // row. Silence would leave every one of those in place: there is no
    // clear-on-empty stage for a fellowship, so a field with no live observation
    // keeps whatever it already holds (#4086).
    currentSourceObservation('contactOffice', candidate.contactOffice || '', candidate),
    observation('contactEmail', candidate.contactEmail, candidate),
    observation('eligibility', candidate.eligibility, candidate),
    observation('yearOfStudy', candidate.yearOfStudy, candidate),
    observation('termOfAward', candidate.termOfAward, candidate),
    observation('purpose', candidate.purpose, candidate),
    observation('globalRegions', candidate.globalRegions, candidate),
    observation('citizenshipStatus', candidate.citizenshipStatus, candidate),
    observation('isAcceptingApplications', candidate.isAcceptingApplications, candidate),
    observation('reviewRequired', candidate.reviewRequired, candidate),
  ].filter((item): item is ObservationInput => !!item);
}

export async function loadRowsOwnedByLane(): Promise<OwnedFellowshipRow[]> {
  return (await Fellowship.find(
    { sourceName: YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE },
    { sourceKey: 1, title: 1, sourceUrl: 1 },
  ).lean()) as OwnedFellowshipRow[];
}

export interface RefusedCatalogPage {
  url: string;
  shape: NonProgramPageShape;
  sourceKey: string;
  title: string;
}

/**
 * Matched on the cited page and on the identity that page would have minted, because a listing
 * page is also the cited source of every program row it lists.
 */
export function rowsMintedByRefusedPages(
  rows: OwnedFellowshipRow[],
  refusedPages: RefusedCatalogPage[],
  keptSourceKeys: ReadonlySet<string>,
): Array<{ row: OwnedFellowshipRow & { sourceKey: string }; page: RefusedCatalogPage }> {
  const pagesByUrl = new Map<string, RefusedCatalogPage[]>();
  for (const page of refusedPages) {
    const key = indexSeedKey(normalizeLinkUrl(page.url));
    pagesByUrl.set(key, [...(pagesByUrl.get(key) || []), page]);
  }
  const matches: Array<{
    row: OwnedFellowshipRow & { sourceKey: string };
    page: RefusedCatalogPage;
  }> = [];
  for (const row of rows) {
    const { sourceKey } = row;
    if (!sourceKey || !row.sourceUrl || keptSourceKeys.has(sourceKey)) continue;
    const page = (pagesByUrl.get(indexSeedKey(normalizeLinkUrl(row.sourceUrl))) || []).find(
      (candidate) =>
        candidate.sourceKey === sourceKey ||
        compactTitleIdentity(candidate.title) === compactTitleIdentity(row.title || ''),
    );
    if (page) matches.push({ row: { ...row, sourceKey }, page });
  }
  return matches;
}

function retractionObservation(sourceKey: string, page: RefusedCatalogPage): ObservationInput {
  return {
    entityType: 'fellowship',
    entityKey: sourceKey,
    field: 'archived',
    value: true,
    sourceUrl: page.url,
    confidenceOverride: 0.95,
  };
}

async function fetchHtml(url: string, useCache: boolean): Promise<string> {
  const safeUrlText = (await assertPublicHttpUrl(url)).toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const { html } = await fetchPageWithPolicy(safeUrlText, {
    timeoutMs: 30000,
    headers: {
      'User-Agent': 'YLabsBot/1.0 (+https://ylabs.yale.edu)',
      Accept: 'text/html,application/xhtml+xml',
    },
    maxRedirects: 5,
    // The run loop already retries every page three times, so a second retry layer here
    // would multiply the requests a failing page costs.
    maxRetries: 0,
  });
  if (useCache) await setCached(YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE, cacheKey, html);
  return html;
}

export class YaleCollegeFellowshipsOfficeScraper implements IScraper {
  readonly name = YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE;
  readonly displayName = 'Yale College Fellowships Office';

  private readonly pageUrls: string[];
  private readonly sitemapUrls: string[];
  private readonly fetchPage: FetchPage;
  private readonly retryDelay: (attempt: number) => Promise<void>;
  private readonly loadOwnedRows: () => Promise<OwnedFellowshipRow[]>;

  constructor(deps: YaleCollegeFellowshipsOfficeScraperDeps = {}) {
    this.pageUrls = deps.pageUrls || DEFAULT_PAGE_URLS;
    this.sitemapUrls = deps.sitemapUrls || FUNDING_YALE_SITEMAP_URLS;
    this.fetchPage = deps.fetchPage || fetchHtml;
    this.retryDelay =
      deps.retryDelay ||
      ((attempt) => new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)));
    this.loadOwnedRows = deps.loadOwnedRows || loadRowsOwnedByLane;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 0)) {
      throw new Error('--limit must be a safe non-negative integer');
    }

    const referenceDate = ctx.options.referenceDate ?? new Date();
    const candidatesByKey = new Map<string, FellowshipCatalogCandidate>();
    const indexDiscoveredDetailUrls = new Set<string>();
    const fetched = new Set<string>();
    const failedUrls: string[] = [];
    const refusedPages: RefusedCatalogPage[] = [];

    const parseAndMerge = async (url: string) => {
      if (fetched.has(url)) return;
      fetched.add(url);
      const html = await this.fetchPage(url, ctx.options.useCache);
      if (isIndexSeedOnlyUrl(url)) {
        for (const childUrl of extractIndexSeedChildDetailUrls(html, url)) {
          indexDiscoveredDetailUrls.add(childUrl);
        }
        return;
      }
      const read = readFellowshipCatalogPage(html, url, referenceDate);
      if (read.refusedPage) refusedPages.push({ url, ...read.refusedPage });
      for (const candidate of read.candidates) {
        upsertCandidate(candidatesByKey, candidate);
      }
    };
    const tryParseAndMerge = async (url: string): Promise<boolean> => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          // A failed fetch must be retryable rather than treated as already fetched.
          fetched.delete(url);
          await parseAndMerge(url);
          return true;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await this.retryDelay(attempt);
        }
      }
      failedUrls.push(url);
      ctx.log('Skipping fellowship catalog page after fetch/parse failure', {
        url,
        error: sanitizeLogValue(lastError),
      });
      return false;
    };

    let seedPageSuccesses = 0;
    for (const url of this.pageUrls) {
      if (!isPublicYaleUrl(url)) continue;
      if (await tryParseAndMerge(url)) seedPageSuccesses += 1;
    }

    if (seedPageSuccesses === 0 && failedUrls.length > 0) {
      throw new Error(
        `No fellowship catalog pages could be fetched; failed URLs: ${failedUrls.join(', ')}`,
      );
    }

    const catalogLinkedUrls = Array.from(candidatesByKey.values()).flatMap((candidate) =>
      candidate.sourcePageKind === 'catalog' ? candidate.links.map((link) => link.url) : [],
    );

    const sitemapProgramUrls: string[] = [];
    for (const sitemapUrl of this.sitemapUrls) {
      if (!isPublicYaleUrl(sitemapUrl)) continue;
      try {
        const xml = await this.fetchPage(sitemapUrl, ctx.options.useCache);
        sitemapProgramUrls.push(...parseFundingYaleSitemapProgramUrls(xml));
      } catch (error) {
        ctx.log('Skipping fellowship sitemap after fetch/parse failure', {
          url: sitemapUrl,
          error: sanitizeLogValue(error),
        });
      }
    }

    const discoveredDetailUrls = Array.from(
      new Set([...catalogLinkedUrls, ...indexDiscoveredDetailUrls, ...sitemapProgramUrls]),
    )
      .filter(
        (url) =>
          isLikelyPublicFellowshipDetailUrl(url) &&
          !isFundingYaleIndexOrHubUrl(url) &&
          !this.pageUrls.includes(url) &&
          !fetched.has(url),
      )
      .sort();

    const detailCrawlCap = MAX_FUNDING_YALE_PROGRAM_PAGES;
    const detailUrls = discoveredDetailUrls.slice(0, detailCrawlCap);
    const detailUrlsCapped = discoveredDetailUrls.length - detailUrls.length;
    if (detailUrlsCapped > 0) {
      ctx.log('Capping fellowship program detail crawl at page limit', {
        cap: detailCrawlCap,
        skipped: detailUrlsCapped,
      });
    }

    for (const url of detailUrls) {
      await tryParseAndMerge(url);
    }

    const allCandidates = Array.from(candidatesByKey.values())
      .filter((candidate) => !isIndexSeedOnlyUrl(candidate.sourceUrl))
      .sort((a, b) => a.title.localeCompare(b.title));
    const selected =
      limitOption !== undefined ? allCandidates.slice(0, limitOption) : allCandidates;
    // There is no clear-on-empty for a fellowship, so going silent on a refused page would leave
    // the row it minted live forever; the lane re-reads the page and asserts the row is retired.
    const retractions =
      refusedPages.length > 0
        ? rowsMintedByRefusedPages(
            await this.loadOwnedRows(),
            refusedPages,
            new Set(allCandidates.map((candidate) => candidate.sourceKey)),
          )
        : [];
    const observations = [
      ...selected.flatMap(candidateToObservations),
      ...retractions.map(({ row, page }) => retractionObservation(row.sourceKey, page)),
    ];
    if (observations.length > 0) await ctx.emit(observations);
    const refusedByShape: Record<string, number> = {};
    for (const page of refusedPages)
      refusedByShape[page.shape] = (refusedByShape[page.shape] || 0) + 1;

    const deadlineParsed = selected.filter((candidate) => !!candidate.deadline).length;
    const reviewRequired = selected.filter((candidate) => candidate.reviewRequired).length;

    const noteParts: string[] = [];
    if (failedUrls.length > 0) {
      noteParts.push(`Skipped ${failedUrls.length} fellowship page(s) after fetch/parse failure.`);
    }
    if (detailUrlsCapped > 0) {
      noteParts.push(
        `Capped ${detailUrlsCapped} program detail page(s) at the ${detailCrawlCap}-page crawl limit.`,
      );
    }
    if (refusedPages.length > 0) {
      noteParts.push(
        `Refused ${refusedPages.length} page(s) that are not programs and retired ${retractions.length} row(s) they minted.`,
      );
    }

    return {
      observationCount: observations.length,
      entitiesObserved: selected.length + retractions.length,
      notes: noteParts.length > 0 ? noteParts.join(' ') : undefined,
      metrics: {
        fellowshipCatalog: {
          discovered: allCandidates.length,
          emitted: selected.length,
          created: 0,
          updated: 0,
          unchanged: 0,
          reviewRequired,
          missingPreviouslySeen: 0,
          deadlineParsed,
          deadlineMissing: selected.length - deadlineParsed,
          sitemapProgramsDiscovered: sitemapProgramUrls.length,
          detailPagesCrawled: detailUrls.length,
          detailPagesCapped: detailUrlsCapped,
          nonProgramPagesRefused: refusedByShape,
          nonProgramRowsRetired: retractions.length,
        },
      },
    };
  }
}
