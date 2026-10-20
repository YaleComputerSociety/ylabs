import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import {
  containsHtmlTagMarkup,
  deadAnchorCtaSentencePattern,
  isAdministrativeTitleEnumerationText,
  isBibliographyCitationEntryText,
  isCitationAuthorListDumpText,
  isCtaNewsTickerDumpText,
  isFormFieldDumpText,
  isNavigationDumpText,
  isPhilanthropicFundAppealText,
  isPublicationsListDumpText,
  isStaffContactBlockText,
} from '../../utils/descriptionHygiene';
import { nonResearchBodyShape } from '../../utils/descriptionNonResearchBodyShape';
import {
  isBibliographicCitationSentence,
  isCareerFactSentence,
  isTeachingOrPastTraineeSentence,
  splitDescriptionSentences,
} from '../../utils/careerBiographyDescription';
import { isEducationOrCareerTimelineSentence } from '../../utils/researchEntityBiographyDescriptionRepair';
import { isProfileTemplateChrome } from '../../utils/profileTemplateChrome';
import { removeRelatedEntityTeaserCards } from '../../utils/relatedEntityTeaserCards';
import { namesAPostingRatherThanResearch } from '../../utils/postingName';
import { isPersonCmsProfileUrl } from '../../utils/researchHomeWebsiteUrl';
import {
  claimsAnotherPersonsLab,
  eponymMatchesIdentity,
  isPersonScopedResearchEntity,
  isUmbrellaOrganizationName,
  namesAnOrganizationalResearchHome,
  nameIsOnlyTheLeadPersonsName,
  namesASelfDeclaredLaboratory,
  nameNamesACitedSharedAcademicHost,
  entityKeyPersonTokens,
  researchHomeIdentityTokens,
} from '../../utils/researchHomeNameIdentityAuthority';
import type { DescriptionEntityKind } from '../../utils/researchHomeDescriptionSelection';
import type { ResearchEntityType } from '../../models/researchAccessTypes';
import {
  admissibleResearchAreas,
  type ResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import { extractLabeledResearchAreaItems } from '../sources/researchAreaSourceExtractor';
import { isInterestChipListText, opensOnNavigationChrome, usefulLabName } from './labPageIdentity';
import { removeProfilePublicityRegions } from './profilePublicityRegions';
import { extractElementTextWithBlockSeparators } from './htmlText';

export type LabPageNameSource = 'og:site_name' | 'h1' | 'title';

export interface LabPageName {
  value: string;
  from: LabPageNameSource;
  declaresLaboratory: boolean;
  leadsPersonalPage: boolean;
}

export type LabPagePassageOrigin =
  'research-section' | 'main-content' | 'structured-data' | 'meta-description';

export interface LabPageResearchPassage {
  origin: LabPagePassageOrigin;
  heading?: string;
  text: string;
}

export interface LabPageReadContext {
  pageUrl: string;
  kind: DescriptionEntityKind;
  entityType?: string;
  entityKey?: string;
  personName?: string;
  knownPersonSurnames?: ReadonlySet<string>;
  departments?: readonly string[];
  recordCitedUrls?: readonly string[];
}

export interface LabPageRead {
  name?: LabPageName;
  passages: LabPageResearchPassage[];
  researchText: string;
  topics: string[];
}

export const MAX_RESEARCH_TEXT_CHARS = 8000;
// A listing page can carry tens of thousands of paragraphs, and reading them all held the
// event loop for seconds, long enough for the database driver's monitor to drop the run's
// connection (#5296); the stored text keeps at most MAX_RESEARCH_TEXT_CHARS in page order.
export const MAX_READ_HTML_CHARS = 2_000_000;
export const MAX_PASSAGE_CANDIDATES = 120;
const PASSAGE_TEXT_BUDGET_CHARS = 3 * MAX_RESEARCH_TEXT_CHARS;
const MIN_PASSAGE_CHARS = 60;
const MAX_TOPICS = 12;
// One approved term a page mentions once is how a passing "popular in orthopedics" became a
// lab's only topic, so an unlabelled page must name at least two before it states a list.
const MIN_UNLABELLED_PROSE_TOPICS = 2;

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5';
const CHROME_SELECTOR =
  'script, style, noscript, svg, iframe, nav, header, footer, aside, form, button, [role="navigation"], [aria-hidden="true"], [hidden], [class*="disclaimer" i], [class*="publication" i], [class*="citation" i], [class*="bibliograph" i]';
const BLOCK_CHILD_SELECTOR = 'p, div, section, article, ul, ol, li, table, h1, h2, h3, h4, h5, h6';
const MIN_LEAF_BLOCK_CHARS = 120;
const MAIN_CONTENT_SELECTOR = 'main, article, [role="main"]';

const RESEARCH_SECTION_HEADING_RE =
  /^(?:biography|bio|about(?:\s+(?:us|me|the\s+(?:lab|laboratory|group|center|centre|program|institute)|our\s+(?:lab|laboratory|group|research|work)))?|overview|introduction|welcome|mission|our\s+mission|what\s+we\s+do|our\s+(?:research|work|focus)|(?:lab|laboratory|group|program|center|centre)\s+(?:overview|mission|research)|research(?:\s+(?:overview|interests?|focus|summary|areas?|program(?:me)?|statement|description|themes?|projects?|directions?))?|current\s+research|research\s+in\s+the\s+(?:lab|laboratory|group)|areas?\s+of\s+(?:research|focus|interest)|research\s+and\s+scholarship|scholarship)$/i;

const INSTITUTIONAL_HOST_NAME_RE =
  /^(?:the\s+)?(?:yale(?:\s+university)?|yale\s+(?:school|college|university|department|medicine|health|news)\b.*|(?:department|school|faculty|college|division|section)\s+of\b.*|home|welcome|people|research|publications|news|contact(?:\s+us)?)$/i;

const STATES_A_SENTENCE_RE = /[.!?]["”’)]?(?:\s|$)/u;
const PATIENT_CTA_SENTENCE_RE =
  /^are\s+you\s+a\s+patient\b|\bview\s+(?:this|the|my|our)\s+(?:doctor|physician|provider)['’]?s?\s+clinical\s+profile\b/i;

const TITLE_SEGMENT_SPLIT_RE = /\s+[|–—·•:-]\s+|\s*[|·•]\s*/;

const collapse = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const headingKey = (value: string): string =>
  collapse(value)
    .replace(/[:.–—-]+$/u, '')
    .trim();

function headingLevel(el: Element): number {
  const match = /^h([1-6])$/i.exec(el.tagName ?? '');
  return match ? Number(match[1]) : 7;
}

function isHeading(node: AnyNode): node is Element {
  return node.type === 'tag' && /^h[1-6]$/i.test((node as Element).tagName);
}

export function boundedHtml(html: string): string {
  return html.length > MAX_READ_HTML_CHARS ? html.slice(0, MAX_READ_HTML_CHARS) : html;
}

class PassageBudget {
  private count = 0;
  private chars = 0;

  get spent(): boolean {
    return this.count >= MAX_PASSAGE_CANDIDATES || this.chars >= PASSAGE_TEXT_BUDGET_CHARS;
  }

  take(passage: LabPageResearchPassage, into: LabPageResearchPassage[]): void {
    this.count += 1;
    this.chars += passage.text.length;
    into.push(passage);
  }
}

function loadReadablePage(html: string, pageUrl: string): cheerio.CheerioAPI {
  const $ = cheerio.load(boundedHtml(html));
  $(CHROME_SELECTOR).remove();
  removeProfilePublicityRegions($);
  removeRelatedEntityTeaserCards($, pageUrl);
  return $;
}

function nameCandidates(html: string): Array<{ value: string; from: LabPageNameSource }> {
  const $ = cheerio.load(boundedHtml(html));
  const candidates: Array<{ value: string; from: LabPageNameSource }> = [];
  const siteName = collapse($('meta[property="og:site_name"]').attr('content'));
  if (siteName) candidates.push({ value: siteName, from: 'og:site_name' });
  const h1 = collapse($('h1').first().text());
  if (h1) candidates.push({ value: h1, from: 'h1' });
  const title = collapse($('title').first().text());
  for (const segment of title.split(TITLE_SEGMENT_SPLIT_RE)) {
    const value = collapse(segment);
    if (value) candidates.push({ value, from: 'title' });
  }
  return candidates;
}

const NAME_HEAD_WORDS = new Set([
  'the',
  'of',
  'and',
  'for',
  'at',
  'in',
  'on',
  'lab',
  'labs',
  'laboratory',
  'laboratories',
  'group',
  'groups',
  'research',
  'yale',
]);

function namesAnotherKnownPerson(name: string, context: LabPageReadContext): boolean {
  const roster = context.knownPersonSurnames;
  if (!roster || roster.size === 0) return false;
  const identity = researchHomeIdentityTokens({
    personName: context.personName,
    slug: context.entityKey,
  });
  if (identity.length === 0) return false;
  const tokens = (
    name
      .normalize('NFKD')
      .toLowerCase()
      .match(/[a-z]+/g) ?? []
  ).filter((token) => token.length >= 2 && !NAME_HEAD_WORDS.has(token));
  return tokens.some((token) => roster.has(token) && !eponymMatchesIdentity(token, identity));
}

function admissiblePageName(candidate: string, context: LabPageReadContext): string {
  const name = usefulLabName(candidate);
  if (!name || INSTITUTIONAL_HOST_NAME_RE.test(name)) return '';
  if (!namesAnOrganizationalResearchHome(name)) return '';
  if (namesAPostingRatherThanResearch(name)) return '';
  const personScoped = isPersonScopedResearchEntity({ entityType: context.entityType });
  if (personScoped && isUmbrellaOrganizationName(name)) return '';
  if (personScoped && namesAnotherKnownPerson(name, context)) return '';
  if (!personScoped) return name;
  if (
    nameNamesACitedSharedAcademicHost({
      harvestedName: name,
      recordCitedUrls: context.recordCitedUrls ?? [],
      identityTokens: entityKeyPersonTokens(context.entityKey),
    })
  ) {
    return '';
  }
  const claimsAnotherPerson = claimsAnotherPersonsLab({
    harvestedName: name,
    websiteUrl: context.pageUrl,
    identityTokens: researchHomeIdentityTokens({
      personName: context.personName,
      slug: context.entityKey,
    }),
    knownPersonSurnames: context.knownPersonSurnames ?? new Set<string>(),
  });
  return claimsAnotherPerson ? '' : name;
}

function leadsPersonalPageName(
  candidates: ReadonlyArray<{ value: string; from: LabPageNameSource }>,
  context: LabPageReadContext,
): LabPageName | undefined {
  if (collapse(context.entityType).toUpperCase() !== 'LAB' || !context.personName) return undefined;
  const personal = candidates.find((candidate) =>
    nameIsOnlyTheLeadPersonsName({ name: candidate.value, personName: context.personName }),
  );
  return personal
    ? {
        value: personal.value,
        from: personal.from,
        declaresLaboratory: false,
        leadsPersonalPage: true,
      }
    : undefined;
}

const nameTokens = (value: string): string[] =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];

/**
 * The fullest stated form of the first admissible name: a site's short `og:site_name`
 * ("Fried Lab") gives way to a heading that repeats every word of it and says more ("Terri
 * Fried Lab for Clinical Research in Geriatrics"), so a read never shortens a name the
 * page states in full.
 */
function fullestStatedName(admissible: ReadonlyArray<{ value: string; from: LabPageNameSource }>): {
  value: string;
  from: LabPageNameSource;
} {
  const [first, ...rest] = admissible;
  const required = nameTokens(first.value);
  let fullest = first;
  for (const candidate of rest) {
    const tokens = new Set(nameTokens(candidate.value));
    const containsFirst = required.every((token) => tokens.has(token));
    const addsWords = [...tokens].some((token) => token !== 'the' && !required.includes(token));
    if (containsFirst && addsWords && candidate.value.length > fullest.value.length) {
      fullest = candidate;
    }
  }
  return fullest;
}

export function readLabPageName(
  html: string,
  context: LabPageReadContext,
): LabPageName | undefined {
  if (!html || isPersonCmsProfileUrl(context.pageUrl)) return undefined;
  const candidates = nameCandidates(html);
  const admissible = candidates
    .map((candidate) => ({
      value: admissiblePageName(candidate.value, context),
      from: candidate.from,
    }))
    .filter((candidate) => candidate.value);
  if (admissible.length > 0) {
    const chosen = fullestStatedName(admissible);
    return {
      value: chosen.value,
      from: chosen.from,
      declaresLaboratory: namesASelfDeclaredLaboratory(chosen.value),
      leadsPersonalPage: false,
    };
  }
  return leadsPersonalPageName(candidates, context);
}

function isNonResearchPassage(text: string, entityType?: string): boolean {
  return (
    containsHtmlTagMarkup(text) ||
    isAdministrativeTitleEnumerationText(text) ||
    isBibliographyCitationEntryText(text) ||
    isCitationAuthorListDumpText(text) ||
    isPublicationsListDumpText(text) ||
    isProfileTemplateChrome(text) ||
    opensOnNavigationChrome(text) ||
    isNavigationDumpText(text) ||
    isInterestChipListText(text) ||
    isStaffContactBlockText(text) ||
    isFormFieldDumpText(text) ||
    isCtaNewsTickerDumpText(text) ||
    isPhilanthropicFundAppealText(text) ||
    nonResearchBodyShape(text, entityType as ResearchEntityType | undefined) !== null
  );
}

const isNonResearchSentence = (sentence: string): boolean =>
  PATIENT_CTA_SENTENCE_RE.test(sentence) ||
  deadAnchorCtaSentencePattern.test(sentence) ||
  isCareerFactSentence(sentence) ||
  isEducationOrCareerTimelineSentence(sentence) ||
  isBibliographicCitationSentence(sentence) ||
  isTeachingOrPastTraineeSentence(sentence);

export function cleanResearchPassage(
  raw: string,
  entityType?: string,
  shape: 'prose' | 'list' = 'prose',
): string {
  const text = collapse(redactDirectContactInfo(collapse(raw)));
  if (text.length < MIN_PASSAGE_CHARS) return '';
  if (shape === 'prose' && !STATES_A_SENTENCE_RE.test(text)) return '';
  if (isNonResearchPassage(text, entityType)) return '';
  const kept = splitDescriptionSentences(text).filter(
    (sentence) => !isNonResearchSentence(sentence),
  );
  const cleaned = collapse(kept.join(' '));
  return cleaned.length >= MIN_PASSAGE_CHARS ? cleaned : '';
}

interface SectionBlock {
  text: string;
  shape: 'prose' | 'list';
}

const MIN_LIST_ITEMS = 2;

function listText($: cheerio.CheerioAPI, list: AnyNode): string {
  const items = $(list)
    .children('li')
    .toArray()
    .map((item) => collapse($(item).text()))
    .filter((item) => item.length > 0);
  const linkOnly = $(list)
    .children('li')
    .toArray()
    .filter((item) => {
      const text = collapse($(item).text());
      return text.length > 0 && text === collapse($(item).find('a').text());
    }).length;
  if (items.length < MIN_LIST_ITEMS || linkOnly * 2 >= items.length) return '';
  return items.join('; ');
}

function blockTexts($: cheerio.CheerioAPI, nodes: AnyNode[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  for (const node of nodes) {
    if (node.type !== 'tag') continue;
    const el = $(node);
    const lists = el.is('ul, ol') ? [node] : el.find('ul, ol').toArray();
    const paragraphs = el.is('p') ? [node] : el.find('p').toArray();
    for (const paragraph of paragraphs) {
      blocks.push({ text: collapse($(paragraph).text()), shape: 'prose' });
    }
    for (const list of lists) blocks.push({ text: listText($, list), shape: 'list' });
    if (paragraphs.length === 0 && lists.length === 0) {
      blocks.push({ text: collapse(extractElementTextWithBlockSeparators(node)), shape: 'prose' });
    }
  }
  return blocks.filter((block) => block.text.length > 0);
}

function sectionBody($: cheerio.CheerioAPI, heading: Element): AnyNode[] {
  const level = headingLevel(heading);
  const collect = (start: AnyNode): AnyNode[] => {
    const body: AnyNode[] = [];
    for (let node = start.nextSibling; node; node = node.nextSibling) {
      if (isHeading(node) && headingLevel(node) <= level) break;
      if (
        node.type === 'tag' &&
        $(node)
          .find(HEADING_SELECTOR)
          .toArray()
          .some((inner) => headingLevel(inner as Element) <= level)
      ) {
        break;
      }
      body.push(node);
    }
    return body;
  };
  const direct = collect(heading);
  if (direct.some((node) => collapse($(node).text()).length > 0)) return direct;
  return heading.parent && heading.parent.type === 'tag' ? collect(heading.parent) : [];
}

function researchSectionPassages(
  $: cheerio.CheerioAPI,
  budget: PassageBudget,
  entityType?: string,
): LabPageResearchPassage[] {
  const passages: LabPageResearchPassage[] = [];
  for (const heading of $(HEADING_SELECTOR).toArray() as Element[]) {
    if (budget.spent) break;
    const label = headingKey($(heading).text());
    if (!RESEARCH_SECTION_HEADING_RE.test(label)) continue;
    for (const block of blockTexts($, sectionBody($, heading))) {
      if (budget.spent) break;
      const cleaned = cleanResearchPassage(block.text, entityType, block.shape);
      if (cleaned) {
        budget.take({ origin: 'research-section', heading: label, text: cleaned }, passages);
      }
    }
  }
  return passages;
}

const INTRODUCES_A_LIST_RE = /[:：]$/u;

function paragraphWithItsList($: cheerio.CheerioAPI, paragraph: AnyNode): SectionBlock {
  const text = collapse($(paragraph).text());
  if (!INTRODUCES_A_LIST_RE.test(text)) return { text, shape: 'prose' };
  const list = $(paragraph).next('ul, ol')[0];
  const items = list ? listText($, list) : '';
  return items ? { text: `${text} ${items}`, shape: 'list' } : { text, shape: 'prose' };
}

function mainContentPassages(
  $: cheerio.CheerioAPI,
  budget: PassageBudget,
  entityType?: string,
): LabPageResearchPassage[] {
  const roots = $(MAIN_CONTENT_SELECTOR)
    .toArray()
    .filter((root) => collapse($(root).text()).length >= MIN_LEAF_BLOCK_CHARS);
  const scope = roots.length > 0 ? roots : [$('body')[0] ?? $.root()[0]];
  const passages: LabPageResearchPassage[] = [];
  for (const root of scope) {
    for (const paragraph of $(root).find('p').toArray()) {
      if (budget.spent) break;
      const block = paragraphWithItsList($, paragraph);
      const cleaned = cleanResearchPassage(block.text, entityType, block.shape);
      if (cleaned) budget.take({ origin: 'main-content', text: cleaned }, passages);
    }
    for (const block of $(root).find('div, section, td, span').toArray()) {
      if (budget.spent) break;
      if ($(block).children(BLOCK_CHILD_SELECTOR).length > 0) continue;
      const text = collapse(extractElementTextWithBlockSeparators(block));
      if (text.length < MIN_LEAF_BLOCK_CHARS) continue;
      const cleaned = cleanResearchPassage(text, entityType);
      if (cleaned) budget.take({ origin: 'main-content', text: cleaned }, passages);
    }
  }
  return passages;
}

function structuredDataDescriptions(html: string): string[] {
  const $ = cheerio.load(boundedHtml(html));
  const descriptions: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    const description = collapse(record.description);
    if (description) descriptions.push(description);
    visit(record['@graph']);
    visit(record.mainEntity);
  };
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      visit(JSON.parse($(script).contents().text()));
    } catch {
      continue;
    }
  }
  return descriptions;
}

function structuredDataPassages(html: string, entityType?: string): LabPageResearchPassage[] {
  return structuredDataDescriptions(html)
    .map((text) => cleanResearchPassage(text, entityType))
    .filter(Boolean)
    .map((text) => ({ origin: 'structured-data' as const, text }));
}

function metaDescriptionPassages(html: string, entityType?: string): LabPageResearchPassage[] {
  const $ = cheerio.load(boundedHtml(html));
  const values = [
    $('meta[property="og:description"]').attr('content'),
    $('meta[name="description"]').attr('content'),
  ];
  return values
    .map((value) => cleanResearchPassage(collapse(value), entityType))
    .filter(Boolean)
    .map((text) => ({ origin: 'meta-description' as const, text }));
}

const comparablePassage = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function withoutRepeatedPassages(passages: LabPageResearchPassage[]): LabPageResearchPassage[] {
  const kept: Array<LabPageResearchPassage & { key: string }> = [];
  for (const passage of passages) {
    const key = comparablePassage(passage.text);
    if (!key || kept.some((existing) => existing.key.includes(key))) continue;
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (key.includes(kept[index].key)) kept.splice(index, 1);
    }
    kept.push({ ...passage, key });
  }
  return kept.map(({ key: _key, ...passage }) => passage);
}

export function readLabPageResearchPassages(
  html: string,
  context: Pick<LabPageReadContext, 'pageUrl' | 'entityType'>,
): LabPageResearchPassage[] {
  if (!html) return [];
  const $ = loadReadablePage(html, context.pageUrl);
  const budget = new PassageBudget();
  return withoutRepeatedPassages([
    ...researchSectionPassages($, budget, context.entityType),
    ...mainContentPassages($, budget, context.entityType),
    ...structuredDataPassages(html, context.entityType),
    ...metaDescriptionPassages(html, context.entityType),
  ]);
}

export function joinResearchPassages(passages: readonly LabPageResearchPassage[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const passage of passages) {
    if (length + passage.text.length > MAX_RESEARCH_TEXT_CHARS) break;
    parts.push(passage.text);
    length += passage.text.length + 2;
  }
  return parts.join('\n\n');
}

const KEYWORD_LIST_HEADING_RE =
  /^(?:(?:medical|clinical|public\s+health|scientific)\s+)?research\s+(?:interests|keywords)$|^(?:research\s+)?keywords$/i;
const MAX_KEYWORD_LIST_CHARS = 1200;

export function readKeywordListItems(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(boundedHtml(html));
  const items: string[] = [];
  for (const heading of $(HEADING_SELECTOR).toArray() as Element[]) {
    if (!KEYWORD_LIST_HEADING_RE.test(headingKey($(heading).text()))) continue;
    const list = collapse($(heading).next().text());
    if (!list || list.length > MAX_KEYWORD_LIST_CHARS) continue;
    items.push(
      ...list
        .split(/\s*;\s*/)
        .map(collapse)
        .filter(Boolean),
    );
  }
  return items;
}

const ROLE_OR_APPOINTMENT_SENTENCE_RE =
  /\b(?:serves?\s+as|served\s+as|dean\s+of|vice\s+chair|chair\s+of|director\s+of|president\s+of|member\s+of\s+the|fellow\s+of|affiliate\s+of|board\s+of|is\s+(?:also\s+)?(?:the|an?)\s+(?:dean|director|chair|chief|associate\s+dean|editor))\b/i;
const ADMINISTRATIVE_SENTENCE_RE =
  /\b(?:curriculum|student\s+affairs|residential\s+experience|undergraduate\s+education|admissions|accreditation)\b/i;
const TRAINING_SENTENCE_RE =
  /\b(?:ph\.?\s?d|m\.?\s?sc|b\.?\s?a\.|b\.?\s?s\.|m\.?\s?a\.|m\.?\s?d\.|degrees?|graduated|trained|training|postdoctoral|post-doctoral|residency|doctoral\s+candidate)\b/i;
const PUBLICATION_VENUE_SENTENCE_RE =
  /\b(?:journals?|lancet|proceedings|reviewer|editor(?:ial)?|published\s+(?:in|by)|press)\b/i;
const POSTAL_ADDRESS_RE =
  /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd\.?|Drive|Way)\b|\bP\.?\s?O\.?\s+Box\b|\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;
const ORGANIZATION_NAME_SPAN_RE =
  /\b(?:(?:[A-Z][\w'’&-]*|of|for|and|on|in|&)\s+){0,6}(?:Center|Centre|Institute|Department|Program|Programme|School|College|Society|Association|Academy|Council|Division|Office|Foundation|Hospital|Clinic|Journal|Press)\b(?:\s+(?:of|for|on)\s+(?:the\s+)?(?:[A-Z][\w'’&-]*\s*(?:and|&|of|in)?\s*){1,6})?/g;

export function topicScanText(researchText: string): string {
  return researchText
    .split(/\n\n/)
    .flatMap((passage) => splitDescriptionSentences(passage))
    .filter(
      (sentence) =>
        !ROLE_OR_APPOINTMENT_SENTENCE_RE.test(sentence) &&
        !ADMINISTRATIVE_SENTENCE_RE.test(sentence) &&
        !TRAINING_SENTENCE_RE.test(sentence) &&
        !PUBLICATION_VENUE_SENTENCE_RE.test(sentence) &&
        !POSTAL_ADDRESS_RE.test(sentence),
    )
    .map((sentence) => sentence.replace(ORGANIZATION_NAME_SPAN_RE, ' '))
    .join(' ');
}

export function readLabPageTopics(
  html: string,
  researchText: string,
  canonicalizer: ResearchAreaCanonicalizer,
  departments: readonly string[] = [],
): string[] {
  const admitted = (areas: string[]) =>
    admissibleResearchAreas(canonicalizer, areas, departments as string[]);
  const keywordList = admitted(readKeywordListItems(html));
  const labeled = admitted(
    canonicalizer.matchCanonicalResearchAreas(extractLabeledResearchAreaItems(boundedHtml(html))),
  );
  const fromProse = admitted(
    canonicalizer.deriveResearchAreasFromText(topicScanText(researchText)),
  );
  const seen = new Set<string>();
  const topics: string[] = [];
  const proseTopics =
    keywordList.length + labeled.length === 0 && fromProse.length < MIN_UNLABELLED_PROSE_TOPICS
      ? []
      : fromProse;
  for (const topic of [...keywordList, ...labeled, ...proseTopics]) {
    const key = topic.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
  }
  return topics.slice(0, MAX_TOPICS);
}

export function readLabPage(
  html: string,
  context: LabPageReadContext,
  canonicalizer?: ResearchAreaCanonicalizer,
): LabPageRead {
  const passages = readLabPageResearchPassages(html, context);
  const researchText = joinResearchPassages(passages);
  return {
    name: readLabPageName(html, context),
    passages,
    researchText,
    topics: canonicalizer
      ? readLabPageTopics(html, researchText, canonicalizer, context.departments)
      : [],
  };
}
