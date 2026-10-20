import * as cheerio from 'cheerio';
import {
  stripLeadingMicrositeBannerPrefix,
  stripTrailingResearchHomeDescription,
} from '../../utils/researchEntityNameNormalization';
import { isPlaceholderEntityName } from '../../utils/researchHomeNameIdentityAuthority';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const GOVERNANCE_ORG_NAME_RE =
  /^(?:the\s+)?(?:council|committee|consortium|commission|task\s+force|working\s+group|senate|assembly|office\s+of|board\s+of)\b/i;

// A microsite frequently leads with the PI's faculty title/credential line
// ("Joshua L. Warren Professor of Biostatistics, Yale University") rather than a
// branded research-home name. The LLM prompt already asks for an empty name in
// that case, but enforce it deterministically so a title line can never
// materialize as the entity's student-facing name.
const PERSON_TITLE_OR_CREDENTIAL_NAME_RE =
  /\bprofessor\b|\bph\.?\s?d\b|\bm\.?\s?d\b|\bendowed\s+chair\b|,\s*yale\s+university\s*$/i;

export function usefulLabName(value: unknown): string {
  const text = stripTrailingResearchHomeDescription(
    stripLeadingMicrositeBannerPrefix(textValue(value)),
  );
  if (text.length < 2 || text.length > 120) return '';
  if (isPlaceholderEntityName(text)) return '';
  if (/^(?:the lab|lab|laboratory|research)$/i.test(text)) return '';
  if (GOVERNANCE_ORG_NAME_RE.test(text)) return '';
  if (PERSON_TITLE_OR_CREDENTIAL_NAME_RE.test(text)) return '';
  return text;
}

/**
 * A labelled interest list restated as a body: "Research Interests: Geophysical and
 * geological fluid dynamics Continuum mechanics Multiphase physics". It is the row's
 * own topic chips with a heading in front, which is a value the visibility gate can
 * never accept, so writing it spends a generation to store an unservable body.
 *
 * Keyed on the label plus the absence of a finite verb rather than on the label
 * alone, because a real body does introduce itself that way ("Research interests in
 * my group centre on how ion channels gate"). A chip run has no predicate.
 */
const INTEREST_LIST_LABEL =
  /^(?:research|scholarly|academic)?\s*(?:interests?|areas?|fields?)\s*(?:of\s+(?:interest|expertise)\s*)?[:\u2013\u2014-]/i;

const FINITE_VERB_IN_PROSE =
  /\b(?:is|are|was|were|has|have|had|studies|study|studied|investigates?|investigated|examines?|examined|explores?|explored|develops?|developed|focuses|focused|works?|worked|uses?|used|aims?|seeks?|centres?|centers?|addresses|addressed|combines?|applies|applied)\b/i;

export function isInterestChipListText(value: unknown): boolean {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text || !INTEREST_LIST_LABEL.test(text)) return false;
  return !FINITE_VERB_IN_PROSE.test(text.replace(INTEREST_LIST_LABEL, ' '));
}

/**
 * A body that opens on the page's own navigation, because the menu is rendered
 * outside `<nav>` and flattens into the extracted text as one unpunctuated run that
 * the LLM then copies verbatim: "Main Menu Sub Menu home publications Research people
 * alum/theses Outreach contact links Welcome Current Research Projects ...".
 *
 * Refused rather than trimmed. Cutting the run needs a rule that recognises a run of
 * lowercase link labels, and `researchBodyChromeStrip.ts` records that exact
 * classifier being measured against 2,617 served bodies and rejected on precision.
 * Refusing costs this lane one body and keeps the menu out of the corpus; the page
 * can be re-read once the extractor stops feeding its menu to the model.
 */
const NAVIGATION_RUN_MARKER =
  /\b(?:Main\s+Menu|Sub\s+Menu|MENU\s+MENU|Skip\s+to\s+(?:main\s+)?content|Open\s+Main\s+Navigation|Close\s+Main\s+Navigation|Search\s+this\s+site|Search\s+form)\b/i;

const NAVIGATION_LEAD_CHARS = 200;

export function opensOnNavigationChrome(value: unknown): boolean {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return false;
  const match = NAVIGATION_RUN_MARKER.exec(text);
  if (!match) return false;
  // Only a marker in the body's OPENING is the page's own furniture. A body that
  // discusses a skip link further in is prose about accessibility, not chrome.
  const terminator = text.search(/[.!?]\s/);
  const boundary =
    terminator === -1 ? NAVIGATION_LEAD_CHARS : Math.min(terminator, NAVIGATION_LEAD_CHARS);
  return match.index < boundary;
}

const PAGE_HEADING_CHROME_SUFFIX_RE =
  /\s*[-\u2013\u2014|:\u00b7\u2022]\s*(?:home(?:\s*page)?|welcome|main\s+page)\s*$/i;
const PAGE_HEADING_CHROME_PREFIX_RE =
  /^\s*(?:home(?:\s*page)?|welcome)\s*[-\u2013\u2014|:\u00b7\u2022]\s*/i;

const comparableHeadingText = (value: string): string =>
  ` ${value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^\s*the\s+/, '')
    .trim()} `;

export function pageIdentityHeadings(html: string): string[] {
  const $ = cheerio.load(html);
  return [
    $('title').first().text(),
    $('meta[property="og:site_name"]').attr('content'),
    $('h1').first().text(),
  ]
    .map((heading) =>
      textValue(heading)
        .replace(PAGE_HEADING_CHROME_SUFFIX_RE, '')
        .replace(PAGE_HEADING_CHROME_PREFIX_RE, '')
        .trim(),
    )
    .filter(Boolean);
}

export function labNameIsStatedInPageHeadings(labName: string, html: string): boolean {
  const target = comparableHeadingText(labName);
  if (!target.trim()) return false;
  return pageIdentityHeadings(html).some((heading) =>
    comparableHeadingText(heading).includes(target),
  );
}
