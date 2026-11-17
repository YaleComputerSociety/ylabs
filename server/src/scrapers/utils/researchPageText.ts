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
const HEADING_LEVEL_MARK_BASE = 0xe010;
const HEADING_MARKS = /[\uE000\uE011-\uE016]/g;

const headingLevelMark = (tagName: string): string =>
  String.fromCharCode(HEADING_LEVEL_MARK_BASE + Number(tagName.slice(1)));

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
  /**
   * The section sits under an open research heading, so its lines are research for the cap's
   * budget even when its own heading names no research (#6109). Ordering still follows `kind`.
   */
  insideResearch: boolean;
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

// A past appointment told as a span of years: "taught at X from 1997-2018". It needs a career
// verb bound to a post, and "worked" or "served" must name a post or an institution, so a
// research sentence that spans years ("tracked kelp recovery from 1997 to 2018", "worked at
// field sites from 2005 to 2015") is not one. Kept local to page text, because
// isCurriculumVitaeRecordSentence also decides what a served description shows (#6201).
const CAREER_POST_OR_INSTITUTION =
  '(?:professor|lecturer|fellow|director|chair|dean|faculty|instructor|curator|editor|president|university|college|institute|hospital|school)';
const CAREER_HISTORY_YEAR_RANGE_SENTENCE = new RegExp(
  '\\b(?:(?:taught|lectured)\\s+(?:at|in)' +
    `|(?:served\\s+(?:as|on|at|in)|worked\\s+(?:at|as))\\s+[^.]{0,60}?\\b${CAREER_POST_OR_INSTITUTION}` +
    '|practi[cs]ed\\s+(?:at|as|in)|chaired\\s+the' +
    '|directed\\s+the\\s+[^.]{0,60}?\\b(?:center|centre|program(?:me)?|institute|department|school|division|museum|clinic))' +
    '\\b[^.]{0,120}?\\bfrom\\s+(?:19|20)\\d{2}\\s*(?:[-\\u2013\\u2014]|to|until|through)\\s*(?:(?:19|20)\\d{2}|present|now)\\b',
  'i',
);

const isPageTextCvRecord = (text: string): boolean =>
  isCurriculumVitaeRecordSentence(text) || CAREER_HISTORY_YEAR_RANGE_SENTENCE.test(text);

const isRecoverableResearchSentence = (sentence: string): boolean =>
  wordCount(sentence) >= MIN_RECOVERED_SENTENCE_WORDS &&
  !isPageTextCvRecord(sentence) &&
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

const ENDS_AS_A_SENTENCE = /[.!?]["')\]\u2019\u201d]?$/;
const SKIP_LINK_LINE = /^(?:skip|jump)\s+(?:to|past|over|content|navigation|main)\b/i;
const ACCESSIBILITY_LINK_LINE =
  /\b(?:accessibility\s+(?:statement|policy|notice|help|assistance|feedback|options|settings)|(?:report|request)\s+an?\s+(?:digital\s+)?accessibility\s+(?:issue|problem|barrier|accommodation)|screen\s+readers?\s+only)\b/i;
const MAX_ACCESSIBILITY_LINE_WORDS = 12;
const CURRICULUM_VITAE_LABEL = String.raw`curriculum vitae|c\.?v\.?|r[e\u00e9]sum[e\u00e9]`;
const CONTACT_OR_LINK_LABEL = String.raw`${CURRICULUM_VITAE_LABEL}|(?:lab |personal )?web\s?site|home\s?page|e-?mail|phone|tel(?:ephone)?|fax|mobile|office|address|orcid|google scholar|twitter|linkedin|bluesky|github|researchgate`;
const CONTACT_OR_LINK_LABEL_LINE = new RegExp(`^(?:${CONTACT_OR_LINK_LABEL})\\s*:`, 'i');
const IMAGE_CREDIT_LABEL_LINE =
  /^(?:(?:photo(?:graph)?|image|picture|illustration|video|cover|header|banner)s?\s+)?credits?\s*:/i;
const FILE_OR_DATE_NOTE = /\([^)]*\)/g;
const BARE_LABEL_ORNAMENT = /\s*(?::|\.{2,}|\u2026|[|\u203a\u00bb\u2192>]+)\s*$/;
const BARE_CONTACT_OR_LINK_LABEL_LINE = new RegExp(`^(?:${CONTACT_OR_LINK_LABEL})$`, 'i');
const MONTH_OR_SEASON =
  '(?:spring|summer|fall|autumn|winter|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const LABEL_DATE = new RegExp(`(?:\\b${MONTH_OR_SEASON}\\s+)?\\b(?:19|20)\\d{2}\\b`, 'gi');
const CURRICULUM_VITAE_LINK_QUALIFIER =
  /^(?:my|the|full|short|complete|current|updated|academic|printable|downloadable|download|view|see|open)$/i;
const CURRICULUM_VITAE_LINK_TAIL = new RegExp(`(?:^|\\s)(?:${CURRICULUM_VITAE_LABEL})$`, 'i');
const OWNER_NAME_TOKEN = /^\p{Lu}[\p{L}'\u2019.-]*$/u;
const MAX_CURRICULUM_VITAE_LINK_PREFIX_WORDS = 3;

const MAX_DROPPED_LABEL_VALUE_WORDS = 6;
const LINK_OR_EMAIL_VALUE = /^(?:https?:\/\/|www\.|[\w.+-]+@[\w-]+\.)/i;

const LISTING_NOUN =
  '(?:news|events|stories|posts|articles|updates|items|entries|publications|projects|results|videos|photos|press(?: releases)?|info(?:rmation)?)';
const LISTING_QUALIFIER = '(?:upcoming|recent|latest|past|older|our|lab|center|centre|department)';
const PROPER_NOUN = "\\p{Lu}[\\p{L}&'\u2019-]*";
const LISTING_NAVIGATION_LINE = new RegExp(
  '^(?:' +
    `(?:read|view|see|show|load|browse|learn)\\s+(?:more|less|all|full|the full|complete|entire)(?:\\s+[\\p{L}&'\u2019-]+){0,3}` +
    `|(?:more|all)(?:\\s+(?:${LISTING_QUALIFIER}|${PROPER_NOUN})){0,2}?\\s+${LISTING_NOUN}` +
    `|(?:older|newer|previous|next)(?:\\s+${LISTING_QUALIFIER}){0,2}?\\s+${LISTING_NOUN}` +
    ')\\s*(?:\\.{2,}|\u2026|[\u203a\u00bb\u2192>]+)?$',
  'iu',
);
const IMAGE_BYLINE_LINE =
  /^(?:photo(?:graph)?s?|images?|pictures?|illustrations?|artwork|video)\s+(?:by|courtesy(?:\s+of)?)\s+(.+)$/i;
const BYLINE_CONNECTOR = /^(?:and|&|of|the|de|van|von|la|le)$/i;
const MAX_BYLINE_CREDIT_WORDS = 6;
const MAX_IMAGE_BYLINE_WORDS = 12;

/** A skip link or an accessibility link line (#6201). */
function isSkipOrAccessibilityLine(line: string): boolean {
  return (
    SKIP_LINK_LINE.test(line) ||
    (wordCount(line) <= MAX_ACCESSIBILITY_LINE_WORDS && ACCESSIBILITY_LINK_LINE.test(line))
  );
}

const isListingNavigationLine = (line: string): boolean => LISTING_NAVIGATION_LINE.test(line);

function isImageBylineLine(line: string): boolean {
  const credited = line.match(IMAGE_BYLINE_LINE)?.[1]?.trim();
  if (!credited || ENDS_AS_A_SENTENCE.test(line) || wordCount(line) > MAX_IMAGE_BYLINE_WORDS) {
    return false;
  }
  const words = credited.split(/\s+/);
  return (
    words.length <= MAX_BYLINE_CREDIT_WORDS &&
    words.some((word) => OWNER_NAME_TOKEN.test(word)) &&
    words.every((word) => OWNER_NAME_TOKEN.test(word) || BYLINE_CONNECTOR.test(word))
  );
}

const POSSESSIVE = /['\u2019]s$/i;
const HONORIFIC = /^(?:dr|prof|professor|mr|ms|mrs)\.?$/i;

const GENERIC_HOST_LABELS = new Set([
  'www',
  'yale',
  'edu',
  'org',
  'com',
  'net',
  'io',
  'sites',
  'campuspress',
]);

/**
 * The lowercased words of the page's own address, which name the person a profile page is
 * about: its path segments, and its host labels, where a personal site carries the name.
 */
export function pageOwnerTokens(pageUrl: string): ReadonlySet<string> {
  try {
    const url = new URL(pageUrl);
    const hostLabels = url.hostname
      .toLowerCase()
      .split('.')
      .filter((label) => !GENERIC_HOST_LABELS.has(label));
    return new Set(
      [...url.pathname.toLowerCase().split(/[^\p{L}\p{N}]+/u), ...hostLabels].filter(
        (token) => token.length >= 2,
      ),
    );
  } catch {
    return new Set();
  }
}

const MIN_JOINED_NAME_PART = 3;

const ownerNamesPart = (ownerTokens: ReadonlySet<string>, part: string): boolean =>
  ownerTokens.has(part) ||
  (part.length >= MIN_JOINED_NAME_PART &&
    [...ownerTokens].some((token) => token.length > part.length && token.includes(part)));

const nameParts = (word: string): string[] =>
  word.replace(POSSESSIVE, '').toLowerCase().split(/[-.]/).filter(Boolean);

/**
 * A CV link: the label alone, after qualifiers, or after the page's own person, named by a
 * possessive or by a name word the page's address carries. A capitalized phrase that names
 * no one on the page ("Robust Visual CV", computer vision) is a topic, not a link (#6159).
 */
function isCurriculumVitaeLinkLine(line: string, ownerTokens: ReadonlySet<string>): boolean {
  if (ENDS_AS_A_SENTENCE.test(line)) return false;
  const core = line
    .replace(FILE_OR_DATE_NOTE, ' ')
    .replace(LABEL_DATE, ' ')
    .replace(BARE_LABEL_ORNAMENT, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tail = core.match(CURRICULUM_VITAE_LINK_TAIL);
  if (!tail) return false;
  const prefix = core.slice(0, tail.index).split(' ').filter(Boolean);
  if (prefix.length > MAX_CURRICULUM_VITAE_LINK_PREFIX_WORDS) return false;
  const names = prefix.filter(
    (word) => !CURRICULUM_VITAE_LINK_QUALIFIER.test(word) && !HONORIFIC.test(word),
  );
  if (names.length === 0) return true;
  if (!names.every((word) => OWNER_NAME_TOKEN.test(word))) return false;
  return (
    POSSESSIVE.test(names[names.length - 1]) ||
    names.some((word) => nameParts(word).some((part) => ownerNamesPart(ownerTokens, part)))
  );
}

const isBareContactOrLinkLabelLine = (line: string, ownerTokens: ReadonlySet<string>): boolean =>
  BARE_CONTACT_OR_LINK_LABEL_LINE.test(
    line
      .replace(FILE_OR_DATE_NOTE, ' ')
      .replace(BARE_LABEL_ORNAMENT, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ) || isCurriculumVitaeLinkLine(line, ownerTokens);

const isLinkOrCaptionLine = (line: string): boolean =>
  isSkipOrAccessibilityLine(line) || isListingNavigationLine(line) || isImageBylineLine(line);

/**
 * The line without a leading contact or link label such as "Curriculum Vitae:" or "Website:"
 * (#6201), or nothing when what follows the label is short, a link or an email address. On a
 * profile those labels sit beside the name and title, and once a recovered biography lifts
 * the row over the floor they would ride along into the stored text; a template that puts a
 * label before a blurb keeps the blurb.
 */
function withoutContactOrLinkLabel(
  line: string,
  ownerTokens: ReadonlySet<string> = new Set(),
): string {
  if (isBareContactOrLinkLabelLine(line, ownerTokens)) return '';
  const credit = line.match(IMAGE_CREDIT_LABEL_LINE);
  if (credit) {
    const value = line.slice(credit[0].length).trim();
    return ENDS_AS_A_SENTENCE.test(value) && wordCount(value) > MAX_DROPPED_LABEL_VALUE_WORDS
      ? value
      : '';
  }
  const label = line.match(CONTACT_OR_LINK_LABEL_LINE);
  if (!label) return line;
  const value = line.slice(label[0].length).trim();
  return wordCount(value) <= MAX_DROPPED_LABEL_VALUE_WORDS || LINK_OR_EMAIL_VALUE.test(value)
    ? ''
    : value;
}

function statementTextOfLine(rawLine: string, ownerTokens: ReadonlySet<string>): string {
  if (isLinkOrCaptionLine(rawLine)) return '';
  const line = withoutContactOrLinkLabel(rawLine, ownerTokens);
  if (wordCount(line) < MIN_LINE_WORDS || isContactLine(line)) return '';
  return isPageTextCvRecord(line) ? withoutCurriculumVitaeSentences(line) : line;
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
 * The prose a heading-block paragraph carries, held to the same rule as a recovered CV
 * paragraph (#6201). A profile's heading block often puts its name, title, a skip link and
 * "Website:" or "Curriculum Vitae:" labels in one paragraph split by line breaks, so each line
 * is read on its own. When the paragraph has several lines, one that does not end as a sentence
 * is a name, title or label. Only whole sentences passing that rule are kept, so a topical label
 * such as "Research interests:" is not dropped as a label, but it stays only inside a line that
 * ends as a sentence and only with a sentence of eight or more words.
 */
function headingBlockSummaryText(paragraph: AnyNode): string {
  const lines = extractElementTextWithLineBreaks(paragraph)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .filter((line) => !isLinkOrCaptionLine(line))
    .map((line) => withoutContactOrLinkLabel(line))
    .filter((line) => line && (lines.length === 1 || ENDS_AS_A_SENTENCE.test(line)))
    .flatMap((line) => splitDescriptionSentences(line))
    .filter(isRecoverableResearchSentence)
    .join(' ');
}

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
      .toArray()
      .filter((paragraph) => wordCount($(paragraph).text()) >= MIN_HEADING_BLOCK_SUMMARY_WORDS)
      .map((paragraph) => headingBlockSummaryText(paragraph))
      .filter(Boolean)
      .map((text) => $.html($('<p></p>').text(text)))
      .join('');
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
  $(DIV_SITE_MENU_SELECTORS.join(', ')).remove();
  removeHeadersKeepingPageSummary($);
  removeProfilePublicityRegions($);
  removeRelatedEntityTeaserCards($, pageUrl);
  $('h1, h2, h3, h4, h5, h6').each((_index, element) => {
    if (isInsideMenuContainer($, element)) return;
    $(element).prepend(
      `${PRIVATE_USE_HEADING_SENTINEL}${headingLevelMark((element as { tagName: string }).tagName)}`,
    );
  });
  return extractElementTextWithLineBreaks($('body')[0] ?? $.root()[0])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function headingLevelOf(line: string): number {
  const mark = line.charCodeAt(PRIVATE_USE_HEADING_SENTINEL.length) - HEADING_LEVEL_MARK_BASE;
  return mark >= 1 && mark <= 6 ? mark : 6;
}

/**
 * The page's sections in order. A heading nested below an open research heading keeps its own
 * `kind` but is marked `insideResearch`, unless it names publications or contact details.
 */
function pageSections(lines: readonly string[]): PageSection[] {
  const sections: PageSection[] = [{ kind: 'neutral', insideResearch: false, lines: [] }];
  const open: Array<{ level: number; research: boolean }> = [];
  for (const line of lines) {
    if (line.startsWith(PRIVATE_USE_HEADING_SENTINEL)) {
      const level = headingLevelOf(line);
      const heading = line.replace(HEADING_MARKS, '').trim();
      const kind = sectionKindOfHeading(heading);
      while (open.length > 0 && open[open.length - 1].level >= level) open.pop();
      const insideResearch =
        kind !== 'publications-or-contact' && open.some((ancestor) => ancestor.research);
      open.push({ level, research: kind === 'research' || insideResearch });
      sections.push({ kind, insideResearch, lines: heading ? [heading] : [] });
      continue;
    }
    sections[sections.length - 1].lines.push(line.replace(HEADING_MARKS, '').trim());
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
  const { research, neutral } = researchStatementPartsOfPage(html, pageUrl);
  return [research, neutral].filter(Boolean).join('\n');
}

/**
 * `researchStatementTextOfPage` split at the point where the page's research sections end, so
 * the cap can spend a row's budget on research lines before neutral ones (#6109). `researchLines`
 * also holds the lines of sections nested below a research heading, which keep their place in
 * the text but share the research budget.
 */
export function researchStatementPartsOfPage(
  html: string,
  pageUrl: string,
): { research: string; neutral: string; researchLines: string[] } {
  if (!html) return { research: '', neutral: '', researchLines: [] };
  const sections = pageSections(pageLinesWithHeadingMarks(html, pageUrl)).filter(
    (section) => section.kind !== 'publications-or-contact',
  );
  const ownerTokens = pageOwnerTokens(pageUrl);
  const seen = new Set<string>();
  const researchLines: string[] = [];
  const statementsOf = (kind: PageSection['kind']): string[] => {
    const kept: string[] = [];
    for (const section of sections.filter((candidate) => candidate.kind === kind)) {
      for (const line of section.lines) {
        const statement = statementTextOfLine(line, ownerTokens);
        if (!statement || seen.has(statement)) continue;
        seen.add(statement);
        kept.push(statement);
        if (kind === 'research' || section.insideResearch) researchLines.push(statement);
      }
    }
    return kept;
  };
  const research = statementsOf('research').join('\n');
  const neutral = statementsOf('neutral').join('\n');
  return { research, neutral, researchLines };
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

/** A page's text before the cap, with the lines that share the research budget. */
export interface ResearchPageTextCapEntry extends ResearchPageTextEntry {
  researchLines?: ReadonlySet<string>;
}

/**
 * Fair shares of `budget` over `lengths`: shortest first, each taking at most an even share of
 * what is left, so a short part keeps all of its text and a long one gives up only its tail.
 */
function fairShares(lengths: readonly number[], budget: number): number[] {
  const shares = lengths.map(() => 0);
  let remaining = budget;
  const byLength = lengths
    .map((length, index) => ({ index, length }))
    .sort((a, b) => a.length - b.length || a.index - b.index);
  byLength.forEach((part, position) => {
    const share = Math.floor(remaining / (byLength.length - position));
    const granted = Math.min(part.length, share);
    shares[part.index] = granted;
    remaining -= granted;
  });
  return shares;
}

const LINE_BREAK_CHARS = 1;

const lengthOfLines = (lines: readonly string[]): number =>
  lines.reduce((sum, line, index) => sum + line.length + (index > 0 ? LINE_BREAK_CHARS : 0), 0);

/**
 * The lines of `lines` that fit `budget`, by index, in order; the first one that does not fit is
 * cut at a sentence boundary and nothing after it is kept.
 */
function linesWithin(lines: readonly string[], budget: number): Map<number, string> {
  const kept = new Map<number, string>();
  let remaining = budget;
  for (const [index, line] of lines.entries()) {
    const separator = kept.size > 0 ? LINE_BREAK_CHARS : 0;
    if (line.length + separator <= remaining) {
      kept.set(index, line);
      remaining -= line.length + separator;
      continue;
    }
    const partial = truncateAtSentenceBoundary(line, remaining - separator);
    if (partial) kept.set(index, partial);
    break;
  }
  return kept;
}

const MIN_STATEMENT_SENTENCE_WORDS = 6;
const MIN_LISTED_TITLE_WORDS = 4;
const MIN_LISTED_TITLE_RUN = 3;

function isStatementSentence(line: string): boolean {
  return (
    ENDS_AS_A_SENTENCE.test(line) &&
    wordCount(line) >= MIN_STATEMENT_SENTENCE_WORDS &&
    !isBibliographicCitationSentence(line)
  );
}

/**
 * Lines of a research section that are one entry of a run of grant, publication or project
 * titles: unpunctuated multi-word lines, at least `MIN_LISTED_TITLE_RUN` in a row. A lone
 * unpunctuated line (a labelled interest list) is not a listed title.
 */
function listedTitleLines(lines: readonly string[]): boolean[] {
  const looksLikeTitle = lines.map(
    (line) => !ENDS_AS_A_SENTENCE.test(line) && wordCount(line) >= MIN_LISTED_TITLE_WORDS,
  );
  const listed = lines.map(() => false);
  let runStart = 0;
  for (let index = 0; index <= lines.length; index += 1) {
    if (index < lines.length && looksLikeTitle[index]) continue;
    if (index - runStart >= MIN_LISTED_TITLE_RUN) listed.fill(true, runStart, index);
    runStart = index + 1;
  }
  return listed;
}

const CapTier = { OwnStatement: 0, Research: 1, Rest: 2 } as const;
type CapTier = (typeof CapTier)[keyof typeof CapTier];

const CAP_TIERS: readonly CapTier[] = [CapTier.OwnStatement, CapTier.Research, CapTier.Rest];

interface CapLine {
  index: number;
  tier: CapTier;
  research: boolean;
}

/**
 * Which budget a line draws on. Statement sentences come first wherever they sit, so every page
 * keeps its own prose up to a fair share before any page's lists. Research-section lines that
 * are not sentences come next, except citations and runs of listed titles. Everything else shares
 * what is left. With no research marks every line is `Rest`, which is the even share per page.
 */
function capLinesOf(lines: readonly string[], researchLines?: ReadonlySet<string>): CapLine[] {
  if (!researchLines) {
    return lines.map((_line, index) => ({ index, tier: CapTier.Rest, research: false }));
  }
  const listedTitle = listedTitleLines(lines);
  return lines.map((line, index) => {
    const research = researchLines.has(line);
    if (isStatementSentence(line) && !listedTitle[index]) {
      return { index, tier: CapTier.OwnStatement, research };
    }
    if (research && !listedTitle[index] && !isBibliographicCitationSentence(line)) {
      return { index, tier: CapTier.Research, research };
    }
    return { index, tier: CapTier.Rest, research };
  });
}

/** A tier's lines in the order the budget takes them: research lines first, then page order. */
const selectionOrder = (capLines: readonly CapLine[], tier: CapTier): CapLine[] => {
  const ofTier = capLines.filter((line) => line.tier === tier);
  return [...ofTier.filter((line) => line.research), ...ofTier.filter((line) => !line.research)];
};

/**
 * Caps a row's pages to `maxChars` in total (#6109). The budget is spent tier by tier, each tier
 * shared fairly over the pages from what the tiers before it left: statement sentences first,
 * a page's research sentences before its other ones, then research lines that are not sentences,
 * then the rest. So each page keeps its own statements up to a fair share before another page's
 * people list, chrome or list of grant titles takes any budget, and a long research page cannot
 * push the other pages out. Kept lines stay in their page order, and a row under the cap is
 * unchanged.
 */
export function capResearchPageText(
  entries: readonly ResearchPageTextCapEntry[],
  maxChars: number = MAX_RESEARCH_PAGE_TEXT_CHARS,
): ResearchPageTextEntry[] {
  const total = entries.reduce((sum, entry) => sum + entry.text.length, 0);
  if (total <= maxChars) {
    return entries
      .map((entry) => ({ url: entry.url, text: entry.text }))
      .filter((entry) => entry.text.length >= MIN_RESEARCH_PAGE_TEXT_CHARS);
  }
  const pages = entries.map((entry) => {
    const lines = entry.text.split('\n');
    const capLines = capLinesOf(lines, entry.researchLines);
    return { entry, lines, order: CAP_TIERS.map((tier) => selectionOrder(capLines, tier)) };
  });
  const kept = pages.map(() => new Map<number, string>());
  let left = maxChars;
  for (const tier of CAP_TIERS) {
    const budget = tier === CAP_TIERS[0] ? left : left - pages.length * LINE_BREAK_CHARS;
    const tierLines = pages.map((page) => page.order[tier].map((line) => page.lines[line.index]));
    const shares = fairShares(tierLines.map(lengthOfLines), Math.max(0, budget));
    left = Math.max(0, budget - shares.reduce((sum, share) => sum + share, 0));
    pages.forEach((page, pageIndex) => {
      for (const [position, line] of linesWithin(tierLines[pageIndex], shares[pageIndex])) {
        kept[pageIndex].set(page.order[tier][position].index, line);
      }
    });
  }
  return pages
    .map((page, pageIndex) => ({
      url: page.entry.url,
      text: page.lines
        .map((_line, index) => kept[pageIndex].get(index))
        .filter((line): line is string => Boolean(line))
        .join('\n')
        .trim(),
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
  return researchPageTextEntriesWithoutChrome(capResearchPageText(uncappedResearchPageText(pages)));
}

/** Each page's text before the cap, with the length of its leading research part. */
function uncappedResearchPageText(
  pages: readonly FetchedResearchPage[],
): ResearchPageTextCapEntry[] {
  const seenUrls = new Set<string>();
  const entries: ResearchPageTextCapEntry[] = [];
  const prose = (text: string): string =>
    withoutResearchPageChromeMenusAndListings(redactDirectContactInfo(text)).trim();
  for (const page of pages) {
    if (seenUrls.has(page.url)) continue;
    seenUrls.add(page.url);
    const parts = researchStatementPartsOfPage(page.html, page.url);
    const text = prose([parts.research, parts.neutral].filter(Boolean).join('\n'));
    if (text.length < MIN_RESEARCH_PAGE_TEXT_CHARS) continue;
    if (entries.some((entry) => entry.text === text)) continue;
    entries.push({
      url: page.url,
      text,
      researchLines: new Set(parts.researchLines.map(prose).filter(Boolean)),
    });
  }
  return entries;
}

export interface ResearchPageTextCapComparison {
  changed: boolean;
  linesKeptOnlyByResearchFirst: number;
  linesKeptOnlyByEvenShare: number;
}

/**
 * The stored value under the research-first cap compared with the even share per page it
 * replaced (#6109), read from the same fetched pages so a dry run can measure the change with
 * no second fetch. Lines are compared as sets across the row.
 */
export function researchPageTextCapComparison(
  pages: readonly FetchedResearchPage[],
): ResearchPageTextCapComparison {
  const uncapped = uncappedResearchPageText(pages);
  const linesOf = (entries: readonly ResearchPageTextEntry[]): Set<string> =>
    new Set(entries.flatMap((entry) => entry.text.split('\n')));
  const researchFirst = linesOf(
    researchPageTextEntriesWithoutChrome(capResearchPageText(uncapped)),
  );
  const evenShare = linesOf(
    researchPageTextEntriesWithoutChrome(
      capResearchPageText(uncapped.map(({ url, text }) => ({ url, text }))),
    ),
  );
  const onlyIn = (a: Set<string>, b: Set<string>) => [...a].filter((line) => !b.has(line)).length;
  const linesKeptOnlyByResearchFirst = onlyIn(researchFirst, evenShare);
  const linesKeptOnlyByEvenShare = onlyIn(evenShare, researchFirst);
  return {
    changed: linesKeptOnlyByResearchFirst + linesKeptOnlyByEvenShare > 0,
    linesKeptOnlyByResearchFirst,
    linesKeptOnlyByEvenShare,
  };
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
