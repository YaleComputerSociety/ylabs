import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import {
  isBibliographicCitationSentence,
  isCurriculumVitaeRecordSentence,
  splitDescriptionSentences,
} from '../../utils/careerBiographyDescription';
import { removeRelatedEntityTeaserCards } from '../../utils/relatedEntityTeaserCards';
import { extractElementTextWithLineBreaks } from './htmlText';
import { removeProfilePublicityRegions } from './profilePublicityRegions';
import {
  withoutResearchPageChrome,
  withoutResearchPageChromeMenusAndListings,
} from './researchPageChrome';

export const RESEARCH_PAGE_TEXT_SOURCE = 'research-page-text';
export const RESEARCH_PAGE_TEXT_FIELD = 'researchPageText';

/**
 * Folded into the lane's content hash, so a change to the extraction below re-emits every
 * row once instead of leaving text the old extraction produced in place.
 */
export const RESEARCH_PAGE_TEXT_CONTRACT = 'research-page-text-v2';

export const MAX_RESEARCH_PAGE_TEXT_CHARS = 16000;
export const MIN_RESEARCH_PAGE_TEXT_CHARS = 120;
const MIN_LINE_WORDS = 2;

export interface ResearchPageTextEntry {
  url: string;
  text: string;
}

export interface FetchedResearchPage {
  url: string;
  html: string;
}

const PRIVATE_USE_HEADING_SENTINEL = '\uE000';

const RESEARCH_HEADING =
  /\b(?:research|interests?|projects?|focus|about|overview|mission|stud(?:y|ies)|areas?|themes?|questions?|approach)\b/i;
const PUBLICATION_OR_CONTACT_HEADING =
  /\b(?:publications?|papers|bibliography|cv|curriculum vitae|contact(?:s| us| information| info)?)\b/i;
const CONTACT_LABEL_LINE =
  /^(?:e-?mail|phone|tel(?:ephone)?|fax|mobile|cell|office|address|mailing address|room|location)\s*:/i;
const MAX_CONTACT_LINE_WORDS = 12;

type SectionKind = 'research' | 'neutral' | 'publications-or-contact';

interface PageSection {
  kind: SectionKind;
  lines: string[];
}

function sectionKindOfHeading(heading: string): SectionKind {
  if (PUBLICATION_OR_CONTACT_HEADING.test(heading)) return 'publications-or-contact';
  if (RESEARCH_HEADING.test(heading)) return 'research';
  return 'neutral';
}

const wordCount = (line: string): number => line.split(/\s+/).filter(Boolean).length;

/**
 * A short line that is mostly an address, an email or a phone number is a contact entry;
 * a longer sentence that mentions one is prose, and redaction handles it.
 */
function isContactLine(line: string): boolean {
  if (CONTACT_LABEL_LINE.test(line)) return true;
  return wordCount(line) <= MAX_CONTACT_LINE_WORDS && redactDirectContactInfo(line) !== line;
}

const MIN_RECOVERED_SENTENCE_WORDS = 8;
const CITATION_FRAGMENT =
  /\b(?:doi|pmid|pmcid|isbn)\b|\b(?:19|20)\d{2}[a-z]?\s*[).]|\(\s*(?:19|20)\d{2}/i;

const isRecoverableResearchSentence = (sentence: string): boolean =>
  wordCount(sentence) >= MIN_RECOVERED_SENTENCE_WORDS &&
  !isCurriculumVitaeRecordSentence(sentence) &&
  !isBibliographicCitationSentence(sentence) &&
  !CITATION_FRAGMENT.test(sentence);

/**
 * A line the CV-record test flags, less its CV sentences (#6159). An extracted line is often
 * a whole biography paragraph, and judging it as one sentence let a single "author of" or
 * "appointed" drop the research sentences beside it. A line that is itself a citation stays
 * dropped, and only whole prose sentences are recovered, because splitting a citation yields
 * author, year and venue pieces the sentence-level test no longer recognises.
 */
function withoutCurriculumVitaeSentences(line: string): string {
  if (isBibliographicCitationSentence(line)) return '';
  return splitDescriptionSentences(line).filter(isRecoverableResearchSentence).join(' ');
}

function statementTextOfLine(line: string): string {
  if (wordCount(line) < MIN_LINE_WORDS || isContactLine(line)) return '';
  return isCurriculumVitaeRecordSentence(line) ? withoutCurriculumVitaeSentences(line) : line;
}

const NON_CONTENT_ELEMENTS =
  'script, style, noscript, svg, iframe, nav, footer, aside, form, button, address';

const MAIN_CONTENT = 'main, article, [role="main"]';
const MIN_HEADING_BLOCK_SUMMARY_WORDS = 12;

const isPageHeadingBlock = ($: cheerio.CheerioAPI, header: AnyNode): boolean =>
  $(header).attr('role') !== 'banner' &&
  $(header).parents(MAIN_CONTENT).length > 0 &&
  $(header).find('h1').length > 0;

/**
 * Removes every `header` except the summary paragraphs of the page's own heading block: the
 * header in the main content that holds the page's `h1`, where a center or program page often
 * states what it does (#6159). Its link labels, photo buttons and name line are still removed,
 * and so are banners and the headers of teaser cards, which carry no `h1`.
 */
function removeHeadersKeepingPageSummary($: cheerio.CheerioAPI): void {
  $('header').each((_index, header) => {
    if (!isPageHeadingBlock($, header)) {
      $(header).remove();
      return;
    }
    const summary = $(header)
      .find('p')
      .filter(
        (_paragraph, paragraph) =>
          wordCount($(paragraph).text()) >= MIN_HEADING_BLOCK_SUMMARY_WORDS,
      )
      .toArray();
    $(header).replaceWith(summary);
  });
}

const DIV_SITE_MENU_SELECTORS: readonly string[] = [
  '[class*="navigation-panel"]',
  '[class*="mobile-navigation"]',
  'details.menu__expand',
  '.sf-menu',
];

const MENU_CONTAINER =
  '[role="navigation"], [role="menu"], [role="menubar"], ul[class*="menu"], li[class*="menu"], details[class*="menu"]';

function isInsideMenuContainer($: cheerio.CheerioAPI, element: AnyNode): boolean {
  return $(element).parents(MENU_CONTAINER).length > 0;
}

function pageLinesWithHeadingMarks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  $(NON_CONTENT_ELEMENTS).remove();
  removeHeadersKeepingPageSummary($);
  $(DIV_SITE_MENU_SELECTORS.join(', ')).remove();
  removeProfilePublicityRegions($);
  removeRelatedEntityTeaserCards($, pageUrl);
  $('h1, h2, h3, h4, h5, h6').each((_index, element) => {
    if (isInsideMenuContainer($, element)) return;
    $(element).prepend(PRIVATE_USE_HEADING_SENTINEL);
  });
  return extractElementTextWithLineBreaks($('body')[0] ?? $.root()[0])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function pageSections(lines: readonly string[]): PageSection[] {
  const sections: PageSection[] = [{ kind: 'neutral', lines: [] }];
  for (const line of lines) {
    if (line.startsWith(PRIVATE_USE_HEADING_SENTINEL)) {
      const heading = line.replaceAll(PRIVATE_USE_HEADING_SENTINEL, '').trim();
      const kind = sectionKindOfHeading(heading);
      sections.push({ kind, lines: heading ? [heading] : [] });
      continue;
    }
    sections[sections.length - 1].lines.push(
      line.replaceAll(PRIVATE_USE_HEADING_SENTINEL, '').trim(),
    );
  }
  return sections;
}

/**
 * The text of a page's research statement, read with code: the page body without site
 * chrome, navigation, headers other than the page's own summary, footers, contact blocks, publicity regions and other
 * units' teaser cards, with the sections a heading names as publications, a bibliography, a CV or contact
 * details left out, and the sections a heading names as research placed first so the cap
 * keeps them. News, people and teaching sections stay, because a lab often states its
 * subject there; only their publication, CV and contact lines are dropped, wherever they
 * sit, a flagged paragraph keeping its research sentences. Every line is kept only once.
 */
export function researchStatementTextOfPage(html: string, pageUrl: string): string {
  if (!html) return '';
  const sections = pageSections(pageLinesWithHeadingMarks(html, pageUrl)).filter(
    (section) => section.kind !== 'publications-or-contact',
  );
  const ordered = [
    ...sections.filter((section) => section.kind === 'research'),
    ...sections.filter((section) => section.kind === 'neutral'),
  ];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of ordered.flatMap((section) => section.lines)) {
    const statement = statementTextOfLine(line);
    if (!statement || seen.has(statement)) continue;
    seen.add(statement);
    kept.push(statement);
  }
  return kept.join('\n');
}

const SENTENCE_END = /[.!?]["')\]’”]?(?=\s|$)/g;

/**
 * The longest prefix of `text` within `maxChars` that ends at a sentence or line end,
 * or at a word end when no sentence or line ends in the second half of the window.
 */
export function truncateAtSentenceBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 0) return '';
  const window = text.slice(0, maxChars + 1);
  let boundary = window.lastIndexOf('\n');
  for (const match of window.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end <= maxChars && end > boundary) boundary = end;
  }
  if (boundary >= maxChars / 2) return text.slice(0, boundary).trim();
  const lastSpace = window.lastIndexOf(' ', maxChars);
  return (lastSpace > 0 ? text.slice(0, lastSpace) : text.slice(0, maxChars)).trim();
}

/**
 * Shares the total budget fairly: pages are served shortest first, each taking at most an
 * even share of what is left, so a short page keeps all of its text and a long one gives
 * up only its tail. Page order is preserved in the result.
 */
export function capResearchPageText(
  entries: readonly ResearchPageTextEntry[],
  maxChars: number = MAX_RESEARCH_PAGE_TEXT_CHARS,
): ResearchPageTextEntry[] {
  const allowance = new Map<number, number>();
  let remaining = maxChars;
  const byLength = entries
    .map((entry, index) => ({ index, length: entry.text.length }))
    .sort((a, b) => a.length - b.length || a.index - b.index);
  byLength.forEach((page, position) => {
    const share = Math.floor(remaining / (byLength.length - position));
    const granted = Math.min(page.length, share);
    allowance.set(page.index, granted);
    remaining -= granted;
  });
  return entries
    .map((entry, index) => ({
      url: entry.url,
      text: truncateAtSentenceBoundary(entry.text, allowance.get(index) ?? 0),
    }))
    .filter((entry) => entry.text.length >= MIN_RESEARCH_PAGE_TEXT_CHARS);
}

/**
 * The stored value for a row's research pages: each page's research statement, contact
 * details redacted the way ingest redacts prose, the writer's chrome, menu and publication
 * strips applied so the cap is spent on prose (#5894), a page whose text repeats an earlier one
 * (a `/people/` and a `/profile/` address of the same profile) kept once, then capped. Same pages in, same value
 * out.
 */
export function researchPageTextValue(
  pages: readonly FetchedResearchPage[],
): ResearchPageTextEntry[] {
  const seenUrls = new Set<string>();
  const entries: ResearchPageTextEntry[] = [];
  for (const page of pages) {
    if (seenUrls.has(page.url)) continue;
    seenUrls.add(page.url);
    const text = withoutResearchPageChromeMenusAndListings(
      redactDirectContactInfo(researchStatementTextOfPage(page.html, page.url)),
    ).trim();
    if (text.length < MIN_RESEARCH_PAGE_TEXT_CHARS) continue;
    if (entries.some((entry) => entry.text === text)) continue;
    entries.push({ url: page.url, text });
  }
  return researchPageTextEntriesWithoutChrome(capResearchPageText(entries));
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** A stored `researchPageText` value, read defensively: anything not `{url, text}` is dropped. */
export function researchPageTextEntries(value: unknown): ResearchPageTextEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const url = textOf(record.url);
    const text = textOf(record.text);
    return url && text ? [{ url, text }] : [];
  });
}

/**
 * Stored page text with the site chrome removed (#5577). The lane applies it again after the
 * cap, having stripped chrome, menus and publications before it (#5894), so on stored text it
 * is a no-op and the topic cache key equals the stored value's. Changing the order or adding
 * other stripping here forces a description rewrite and a topic re-derive for every affected row.
 */
export function researchPageTextEntriesWithoutChrome(value: unknown): ResearchPageTextEntry[] {
  return researchPageTextEntries(value).flatMap((entry) => {
    const text = withoutResearchPageChrome(entry.text).trim();
    return text ? [{ url: entry.url, text }] : [];
  });
}

/**
 * The pages a topic reading reads and is keyed on (#5882): the stored text through the
 * writer's own strips (`withoutResearchPageChromeMenusAndListings`), so a site or theme menu
 * is never quote evidence for a topic (#5939) and text the lane already stripped at capture
 * (#5894) keeps its key. It is not folded into `researchPageTextEntriesWithoutChrome`, which
 * would change the stored value and every row's `writerInputHash`. Changing it moves every
 * topic cache key, so it needs a `research-topics:rekey-topic-text` run before the next
 * materialize.
 */
export function researchPageTextEntriesForTopics(value: unknown): ResearchPageTextEntry[] {
  return researchPageTextEntries(value).flatMap((entry) => {
    const text = withoutResearchPageChromeMenusAndListings(entry.text).trim();
    return text ? [{ url: entry.url, text }] : [];
  });
}
