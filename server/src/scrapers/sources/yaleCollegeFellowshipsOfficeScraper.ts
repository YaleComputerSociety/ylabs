/**
 * Public-page Yale fellowship catalog scraper.
 *
 * This source keeps Fellowship rows fresh from official Yale pages while
 * treating gated CommunityForce URLs as application links, not fetch targets.
 */
import axios from 'axios';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { classifyProgram } from '../../services/programClassifier';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { sanitizeStoredCatalogDescription } from '../../utils/descriptionHygiene';
import { normalizedProgramTitleKey } from '../../utils/programTitle';
import { isUnhelpfulProgramUrl } from '../../utils/researchHomeWebsiteUrl';

export const YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE = 'yale-college-fellowships-office';

const MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL = 'https://macmillan.yale.edu/fellowships-and-grants';

const DEFAULT_PAGE_URLS = [
  'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
  'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale',
  'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/yale-college-first-year-summer-research-fellowship',
  'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/stars/stars-summer-research-program',
  'https://wti.yale.edu/initiatives/undergraduate',
  'https://medicine.yale.edu/whr/training/',
  'https://ycmd.yale.edu/education/summer-undergraduate-internships',
  'https://economics.yale.edu/undergraduate/tobin-ra',
  'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
  'https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program',
  MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL,
  `${MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL}?page=1`,
  `${MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL}?page=2`,
  `${MACMILLAN_FELLOWSHIPS_AND_GRANTS_URL}?page=3`,
];

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
]);

const MOVED_YALE_COLLEGE_FINANCIAL_AWARD_URLS: Record<string, string> = {
  '/finances/financial-awards-prizes/mellon-mays-undergraduate-fellowship-program':
    'https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program',
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
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
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  isAcceptingApplications: boolean;
  reviewRequired: boolean;
}

type FetchPage = (url: string, useCache: boolean) => Promise<string>;

interface YaleCollegeFellowshipsOfficeScraperDeps {
  pageUrls?: string[];
  fetchPage?: FetchPage;
  retryDelay?: (attempt: number) => Promise<void>;
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

function sourceKeyForTitle(title: string): string {
  return `${YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE}:${slugify(title)}`;
}

function normalizedCandidateTitle(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^ale College\b/, 'Yale College')
    .replace(/\s+Learn more about\b.*$/i, '')
    .replace(/\s+Read More\s*$/i, '')
    .trim();
}

function absoluteUrl(rawUrl: string | undefined, pageUrl: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
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
    if (parsed.hostname.endsWith('communityforce.com')) parsed.protocol = 'https:';
    if (parsed.hostname.toLowerCase() === 'studentgrants.yale.edu') parsed.protocol = 'https:';
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

function isYaleOwnedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'yale.edu' || hostname.endsWith('.yale.edu');
  } catch {
    return false;
  }
}

function isCommunityForceUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().endsWith('communityforce.com');
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
    return /(?:find-funding|fellowship|fellowships|grant|grants|scholar|scholars|award|awards|prize|prizes|stem-fellowships|yale-undergraduate-research|undergraduate|internships|tobin-ra|research-internship-program|training\/fellowship)/i.test(
      pathname,
    );
  } catch {
    return false;
  }
}

function isEligibleCandidateHref(url: string): boolean {
  return isCommunityForceUrl(url) || isLikelyPublicFellowshipDetailUrl(url);
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

const MAX_DETAIL_PROGRAM_LINKS = 12;

function isProgramRelevantLink(url: string, label: string): boolean {
  if (isCommunityForceUrl(url) || isStudentGrantsUrl(url)) return true;
  if (/\b(?:apply|application)\b/i.test(label) && isYaleOwnedUrl(url)) return true;
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

function inferPurpose(text: string): string[] {
  const purposes: string[] = [];
  if (isResearchFocused(text)) purposes.push('Research');
  if (/\bstudy\b|\bcourse\b/i.test(text)) purposes.push('Study');
  if (/\btravel\b|\binternational\b|\babroad\b/i.test(text)) purposes.push('Travel');
  if (/\bservice\b|\bpublic service\b/i.test(text)) purposes.push('Service');
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

function isResearchFocused(text: string): boolean {
  if (hasExplicitNegativeResearchFocus(text)) return false;
  return /\b(?:original|independent|summer|faculty[- ]mentored|undergraduate) research\b|\bresearch (?:project|proposal|experience|fellowship|program)\b/i.test(
    text,
  );
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

  const monthPattern = Object.keys(MONTHS).join('|');
  const namedDate = `(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?[,]?\\s*(?:${monthPattern})\\s+\\d{1,2}(?!\\d)(?:,\\s*\\d{4})?`;
  const numericDate = String.raw`\d{1,2}\/\d{1,2}\/\d{2,4}`;
  const datePattern = new RegExp(`(?:${namedDate}|${numericDate})`, 'gi');
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

function utcStartOfDay(date: Date | undefined): Date | undefined {
  if (!date) return undefined;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function parseDeadlineToUtcEndOfDay(
  text: string,
  referenceDate: Date = new Date(),
): Date | undefined {
  const normalized = normalizeWhitespace(text);
  const numeric = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (numeric) {
    const numericMonth = Number(numeric[1]) - 1;
    const numericDay = Number(numeric[2]);
    const numericYear = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const numericDate = new Date(Date.UTC(numericYear, numericMonth, numericDay, 23, 59, 59, 999));
    if (
      numericDate.getUTCFullYear() === numericYear &&
      numericDate.getUTCMonth() === numericMonth &&
      numericDate.getUTCDate() === numericDay
    ) {
      return numericDate;
    }
  }
  const monthPattern = Object.keys(MONTHS).join('|');
  const match = normalized.match(
    new RegExp(
      `(?:deadline[^A-Za-z0-9]*)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?[,]?\\s*(${monthPattern})\\s+(\\d{1,2})(?!\\d)(?:,\\s*(\\d{4}))?`,
      'i',
    ),
  );
  if (!match) return undefined;

  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  let year = match[3] ? Number(match[3]) : referenceDate.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  if (!match[3] && date.getTime() < referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000) {
    year += 1;
    date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  }
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return undefined;
  }
  return date;
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

function summaryFromRowContext(rowContext: string, title: string): string | undefined {
  const safe = sanitizeStoredCatalogDescription(rowContext);
  return safe && safe !== title ? safe : undefined;
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
  const deadline = parseDeadlineToUtcEndOfDay(bestDeadlineText(contextText), referenceDate);
  const applicationLink = isCommunityForceUrl(href) ? href : undefined;
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
    contactOffice: 'Yale Fellowships and Funding',
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
  const deadline = parseDeadlineToUtcEndOfDay(bestDeadlineText(rowContext), referenceDate);
  const applicationLink = isCommunityForceUrl(href) ? href : undefined;
  const links = [{ label: applicationLink ? 'Application' : title, url: href }];
  const isAcceptingApplications =
    (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
    hasExplicitActiveApplicationLanguage(rowContext);

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
    contactOffice: contactOffice || undefined,
    contactEmail: extractEmail(summaryText),
    yearOfStudy: [],
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

function candidateFromDetailPage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  referenceDate: Date,
): FellowshipCatalogCandidate | undefined {
  const title = normalizeWhitespace($('h1').first().text());
  if (!title || !isLikelyFellowshipTitle(title)) return undefined;
  if (isGenericCatalogTitle(title)) return undefined;

  const specificContent = $('.node, article').first();
  const primaryContent = $('main, [role="main"]').first();
  const contentRoot =
    specificContent.length > 0
      ? specificContent
      : primaryContent.length > 0
        ? primaryContent
        : $('body');
  const chromeFreeRoot = contentRoot.clone();
  chromeFreeRoot
    .find(
      'script, style, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .breadcrumbs, .menu, .sidebar',
    )
    .remove();
  const bodyText = normalizeWhitespace(chromeFreeRoot.text());
  const safeDescription = sanitizeStoredCatalogDescription(bodyText, 2000);
  const applicationInformation = applicationSectionText($);
  const deadline = parseDeadlineToUtcEndOfDay(bestDeadlineText(bodyText), referenceDate);
  const applicationOpenDate = utcStartOfDay(
    parseDeadlineToUtcEndOfDay(bestApplicationOpenText(bodyText), referenceDate),
  );
  const links = dedupeProgramLinks(
    contentRoot
      .find('a')
      .toArray()
      .filter((link) => !isInExcludedPageRegion($(link)))
      .map((link) => {
        const rawUrl = absoluteUrl($(link).attr('href'), pageUrl);
        const url = rawUrl ? normalizeLinkUrl(rawUrl) : undefined;
        const label = normalizeWhitespace($(link).text()) || 'Link';
        return url ? { label, url } : undefined;
      })
      .filter((item): item is { label: string; url: string } => !!item)
      .filter((item) => isProgramRelevantLink(item.url, item.label)),
  ).slice(0, MAX_DETAIL_PROGRAM_LINKS);
  const applicationLink =
    links.find((link) => isCommunityForceUrl(link.url))?.url ||
    links.find((link) => isStudentGrantsUrl(link.url))?.url ||
    links.find((link) => /apply|application|student grants/i.test(link.label))?.url;
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
    researchFocused: isResearchFocused(bodyText),
    researchFocusExplicitNegative: hasExplicitNegativeResearchFocus(bodyText),
    sourcePageKind: 'detail',
    sourceUrl: pageUrl,
    applicationLink,
    links,
    deadline,
    applicationOpenDate,
    contactOffice: 'Yale Fellowships and Funding',
    contactEmail: extractEmail(bodyText),
    yearOfStudy: [],
    termOfAward: inferTerm(bodyText),
    purpose: inferPurpose(bodyText),
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
    yearOfStudy: Array.from(new Set([...existing.yearOfStudy, ...incoming.yearOfStudy])),
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

export function parseFellowshipCatalogPage(
  html: string,
  pageUrl: string,
  referenceDate: Date = new Date(),
): FellowshipCatalogCandidate[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const byKey = new Map<string, FellowshipCatalogCandidate>();

  const opportunityRowCandidates = candidatesFromMacmillanOpportunityPage(
    $,
    pageUrl,
    referenceDate,
  );
  if (opportunityRowCandidates.length > 0) {
    for (const candidate of opportunityRowCandidates) upsertCandidate(byKey, candidate);
    return Array.from(byKey.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  const detail = candidateFromDetailPage($, pageUrl, referenceDate);
  if (detail) upsertCandidate(byKey, detail);

  if (!detail) {
    for (const link of $('a').toArray()) {
      const candidate = candidateFromLink($, link, pageUrl, referenceDate);
      if (!candidate) continue;
      upsertCandidate(byKey, candidate);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.title.localeCompare(b.title));
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
  const classification = classifyProgram({
    title: candidate.title,
    summary: candidate.summary,
    description: candidate.description,
    purpose: candidate.purpose,
    termOfAward: candidate.termOfAward,
    sourceUrl: candidate.sourceUrl,
  });
  return [
    observation('sourceKey', candidate.sourceKey, candidate),
    observation('sourceName', YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE, candidate),
    observation('sourceUrl', candidate.sourceUrl, candidate),
    observation('sourceFingerprint', candidate.sourceFingerprint, candidate),
    observation('programCategory', classification.programCategory, candidate),
    observation('programKind', classification.programKind, candidate),
    observation('entryMode', classification.entryMode, candidate),
    observation('studentFacingCategory', classification.studentFacingCategory, candidate),
    observation('requiresMentorBeforeApply', classification.requiresMentorBeforeApply, candidate),
    observation('mentorMatching', classification.mentorMatching, candidate),
    observation('undergraduateOnly', classification.undergraduateOnly, candidate),
    observation('yaleCollegeOnly', classification.yaleCollegeOnly, candidate),
    observation('compensationSummary', classification.compensationSummary, candidate),
    observation('hoursPerWeek', classification.hoursPerWeek, candidate),
    observation('programDates', classification.programDates, candidate),
    observation('bestNextStep', classification.bestNextStep, candidate),
    observation('prepSteps', classification.prepSteps, candidate),
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
    observation('contactOffice', candidate.contactOffice, candidate),
    observation('contactEmail', candidate.contactEmail, candidate),
    observation('yearOfStudy', candidate.yearOfStudy, candidate),
    observation('termOfAward', candidate.termOfAward, candidate),
    observation('purpose', candidate.purpose, candidate),
    observation('globalRegions', candidate.globalRegions, candidate),
    observation('citizenshipStatus', candidate.citizenshipStatus, candidate),
    observation('isAcceptingApplications', candidate.isAcceptingApplications, candidate),
    observation('reviewRequired', candidate.reviewRequired, candidate),
  ].filter((item): item is ObservationInput => !!item);
}

async function fetchHtml(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 30000,
    headers: {
      'User-Agent': 'YLabsBot/1.0 (+https://ylabs.yale.edu)',
      Accept: 'text/html,application/xhtml+xml',
    },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = String(res.data || '');
  if (useCache) await setCached(YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE, cacheKey, html);
  return html;
}

export class YaleCollegeFellowshipsOfficeScraper implements IScraper {
  readonly name = YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE;
  readonly displayName = 'Yale College Fellowships Office';

  private readonly pageUrls: string[];
  private readonly fetchPage: FetchPage;
  private readonly retryDelay: (attempt: number) => Promise<void>;

  constructor(deps: YaleCollegeFellowshipsOfficeScraperDeps = {}) {
    this.pageUrls = deps.pageUrls || DEFAULT_PAGE_URLS;
    this.fetchPage = deps.fetchPage || fetchHtml;
    this.retryDelay =
      deps.retryDelay ||
      ((attempt) => new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)));
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 0)) {
      throw new Error('--limit must be a safe non-negative integer');
    }

    const referenceDate = new Date();
    const candidatesByKey = new Map<string, FellowshipCatalogCandidate>();
    const fetched = new Set<string>();
    const failedUrls: string[] = [];

    const parseAndMerge = async (url: string) => {
      if (fetched.has(url)) return;
      fetched.add(url);
      const html = await this.fetchPage(url, ctx.options.useCache);
      const parsed = parseFellowshipCatalogPage(html, url, referenceDate);
      for (const candidate of parsed) {
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

    const detailUrls = Array.from(
      new Set(
        Array.from(candidatesByKey.values()).flatMap((candidate) =>
          candidate.sourcePageKind === 'catalog' ? candidate.links.map((link) => link.url) : [],
        ),
      ),
    ).filter(
      (url) =>
        isLikelyPublicFellowshipDetailUrl(url) && !this.pageUrls.includes(url) && !fetched.has(url),
    );

    for (const url of detailUrls) {
      await tryParseAndMerge(url);
    }

    const allCandidates = Array.from(candidatesByKey.values()).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    const selected =
      limitOption !== undefined ? allCandidates.slice(0, limitOption) : allCandidates;
    const observations = selected.flatMap(candidateToObservations);
    if (observations.length > 0) await ctx.emit(observations);

    const deadlineParsed = selected.filter((candidate) => !!candidate.deadline).length;
    const reviewRequired = selected.filter((candidate) => candidate.reviewRequired).length;

    return {
      observationCount: observations.length,
      entitiesObserved: selected.length,
      notes:
        failedUrls.length > 0
          ? `Skipped ${failedUrls.length} fellowship page(s) after fetch/parse failure.`
          : undefined,
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
        },
      },
    };
  }
}
