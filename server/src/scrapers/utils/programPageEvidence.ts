import type * as cheerio from 'cheerio';
import { sanitizeStoredCatalogDescription } from '../../utils/descriptionHygiene';
import { humanizeProgramLinkLabel } from '../../utils/programLinkLabel';
import { isUnhelpfulProgramUrl } from '../../utils/researchHomeWebsiteUrl';

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

export function isApplicationFormUrl(value: string): boolean {
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
export function isSidebarApplicationFormLink(url: string, label: string): boolean {
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
  maxLength = 2000,
): string | undefined {
  const prose = chromeFreeRoot
    .find('p')
    .toArray()
    .map((node) => normalizeWhitespace($(node).text()))
    .filter(
      (text) => text.length >= MIN_PROSE_PARAGRAPH_CHARS && !FAQ_OR_QUESTION_PARAGRAPH.test(text),
    )
    .join(' ');
  const fromProse = prose ? sanitizeStoredCatalogDescription(prose, maxLength) : '';
  if (wordCount(fromProse) >= MIN_PROSE_DESCRIPTION_WORDS) return fromProse;
  return sanitizeStoredCatalogDescription(bodyText, maxLength) || fromProse || undefined;
}
