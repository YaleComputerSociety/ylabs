import * as cheerio from 'cheerio';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { isCurriculumVitaeRecordSentence } from '../../utils/careerBiographyDescription';
import { removeRelatedEntityTeaserCards } from '../../utils/relatedEntityTeaserCards';
import { extractElementTextWithLineBreaks } from './htmlText';
import { removeProfilePublicityRegions } from './profilePublicityRegions';

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

function isStatementLine(line: string): boolean {
  return (
    wordCount(line) >= MIN_LINE_WORDS &&
    !isCurriculumVitaeRecordSentence(line) &&
    !isContactLine(line)
  );
}

function pageLinesWithHeadingMarks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  $(
    'script, style, noscript, svg, iframe, nav, header, footer, aside, form, button, address',
  ).remove();
  removeProfilePublicityRegions($);
  removeRelatedEntityTeaserCards($, pageUrl);
  $('h1, h2, h3, h4, h5, h6').each((_index, element) => {
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
 * chrome, navigation, footers, contact blocks, publicity regions and other units' teaser
 * cards, with the sections a heading names as publications, a bibliography, a CV or contact
 * details left out, and the sections a heading names as research placed first so the cap
 * keeps them. News, people and teaching sections stay, because a lab often states its
 * subject there; only their publication, CV and contact lines are dropped, wherever they
 * sit. Every line is kept only once.
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
    if (!isStatementLine(line) || seen.has(line)) continue;
    seen.add(line);
    kept.push(line);
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
 * details redacted the way ingest redacts prose, a page whose text repeats an earlier one
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
    const text = redactDirectContactInfo(researchStatementTextOfPage(page.html, page.url));
    if (text.length < MIN_RESEARCH_PAGE_TEXT_CHARS) continue;
    if (entries.some((entry) => entry.text === text)) continue;
    entries.push({ url: page.url, text });
  }
  return capResearchPageText(entries);
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
