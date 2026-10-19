/**
 * Reads the director an organizational research home's own page states, with code.
 *
 * Lives under `scrapers/utils/` because it is a pure judging core: the
 * `center-director` lane dispatches it, and every module in `sources/` must be a
 * registered lane.
 *
 * A director counts only when the page states it in a shape code can settle: a short
 * title label beside exactly one person's name (a YaleSites or Drupal contact card, a
 * heading over a name, a definition list, a "Director: Name" line), or one strict
 * sentence ("<Name> is the director of the Center", "The Center is directed by
 * <Name>"). A title scoped to another unit, a past or retired directorship, and a
 * deputy, associate or functional directorate ("Director of Research") never count.
 * Two people at the same rank refuse the page rather than pick one, and a director the
 * page states only in other prose is returned as unsettled text, never as a name.
 */
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { normalizeName } from './scraperHelpers';
import { observedPersonNameAgreesWith } from './personNameAgreement';
import {
  isHistoricalDirectorship,
  ORGANIZATION_NOUN,
  organizationTextIsGenericSelfReference,
} from './organizationUnitNaming';

export type CenterDirectorRole = 'director' | 'co-director';

export type DirectorTitleTier = 'top' | 'head' | 'co';

export type CenterDirectorSignal = 'label' | 'heading' | 'definition' | 'inline' | 'sentence';

export interface CenterDirectorCandidate {
  name: string;
  title: string;
  tier: DirectorTitleTier;
  role: CenterDirectorRole;
  signal: CenterDirectorSignal;
  pageUrl: string;
  profileUrl?: string;
  groupLabel?: string;
}

export interface CenterDirectorPageSignals {
  pageUrl: string;
  candidates: CenterDirectorCandidate[];
  unsettledStatements: string[];
}

export type CenterDirectorRefusal = 'several-directors' | 'several-heads' | 'several-co-directors';

export type CenterDirectorDecision =
  | { outcome: 'named'; director: CenterDirectorCandidate }
  | { outcome: 'ambiguous'; reason: CenterDirectorRefusal; candidateCount: number }
  | { outcome: 'prose-only'; statements: string[]; pageUrl: string }
  | { outcome: 'none' };

const MAX_LABEL_CHARS = 240;
const MAX_CARD_LEAVES = 14;
const MAX_ANCESTOR_STEPS = 4;
const MAX_UNSETTLED_STATEMENTS = 3;
const MAX_UNSETTLED_STATEMENT_CHARS = 400;

const REMOVED_CHROME =
  'script, style, noscript, svg, iframe, nav, form, [role="navigation"], [aria-hidden="true"]';

const PAGE_CHROME = 'header, footer';

const CARD_CONTAINER = 'article, li, [class*="card"], [class*="teaser"]';

const BLOCK_TAGS = new Set([
  'p',
  'li',
  'dd',
  'dt',
  'td',
  'th',
  'div',
  'section',
  'article',
  'aside',
  'blockquote',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'dl',
  'table',
  'tr',
]);

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const NOT_CURRENT_TITLE =
  /\b(?:retired|former(?:ly)?|emerit(?:us|a)|past|outgoing|incoming|founding\s+director\s+emerit|board\s+of\s+directors|director['’]?s\s+(?:council|circle|award|message|welcome|note|office)|directory|directories|directorate)\b/i;

const SECONDARY_TITLE_WORD = /\b(?:associate|assistant|deputy|vice|assoc\.?)\b/i;

const CO_TITLE = /\bco[-\s]?directors?\b|\b(?:interim|acting)\s+(?:\S+\s+)?directors?\b/i;

const TOP_PREFIX_WORDS = new Set([
  'founding',
  'faculty',
  'center',
  'centre',
  'institute',
  'core',
  'initiative',
  'the',
]);

const HEAD_PREFIX_WORDS = new Set([
  'executive',
  'scientific',
  'technical',
  'managing',
  'medical',
  'facility',
  'laboratory',
  'lab',
  'cleanroom',
  'shop',
]);

const NAME_STOP_WORDS = new Set([
  'about',
  'adjunct',
  'administrator',
  'assistant',
  'associate',
  'chair',
  'chief',
  'clinical',
  'coordinator',
  'dean',
  'emeritus',
  'fellow',
  'instructor',
  'lecturer',
  'manager',
  'officer',
  'postdoctoral',
  'president',
  'provost',
  'scientist',
  'senior',
  'student',
  'visiting',
  'administration',
  'affiliates',
  'board',
  'center',
  'centre',
  'committee',
  'contact',
  'contacts',
  'core',
  'council',
  'department',
  'director',
  'directors',
  'email',
  'events',
  'facility',
  'faculty',
  'fellows',
  'general',
  'home',
  'inquiries',
  'initiative',
  'institute',
  'lab',
  'laboratory',
  'leadership',
  'learn',
  'members',
  'menu',
  'more',
  'news',
  'office',
  'our',
  'people',
  'phone',
  'primary',
  'professor',
  'profile',
  'program',
  'programs',
  'read',
  'research',
  'resources',
  'school',
  'science',
  'sciences',
  'search',
  'services',
  'staff',
  'studies',
  'team',
  'the',
  'university',
  'view',
  'yale',
]);

const NAME_PARTICLES = new Set([
  'al',
  'bin',
  'da',
  'das',
  'de',
  'del',
  'della',
  'der',
  'di',
  'dos',
  'du',
  'la',
  'le',
  'van',
  'von',
  'y',
]);

const NAME_TOKEN = /^(?:\p{Lu}[\p{L}'’-]*\.?|\p{Lu}\.(?:\p{Lu}\.)*)$/u;

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const CREDENTIAL_TAIL = /,\s*([\p{L}.()]{2,9})\s*$/u;

function withoutCredentialTail(text: string): string {
  let current = text;
  for (let match = current.match(CREDENTIAL_TAIL); match; match = current.match(CREDENTIAL_TAIL)) {
    if ((match[1].match(/\p{Lu}/gu) ?? []).length < 2) break;
    current = current.slice(0, match.index).trim();
  }
  return current;
}

export function personNameFromText(raw: string): string | undefined {
  const text = textOf(raw);
  if (!text || text.length > 80 || /[\d@/:|]/.test(text)) return undefined;
  if (/\(\p{Lu}{2,}\)/u.test(text)) return undefined;
  const name = normalizeName(withoutCredentialTail(text));
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return undefined;
  let lettered = 0;
  for (const token of tokens) {
    const lower = token.toLowerCase().replace(/[.,]+$/, '');
    if (NAME_STOP_WORDS.has(lower)) return undefined;
    if (NAME_PARTICLES.has(lower)) continue;
    if (!NAME_TOKEN.test(token)) return undefined;
    if (/\p{Ll}/u.test(token) || token.replace(/[^\p{L}]/gu, '').length > 1) lettered += 1;
  }
  const last = tokens[tokens.length - 1].replace(/[^\p{L}'’-]/gu, '');
  if (lettered < 2 || last.length < 2) return undefined;
  return name;
}

function titleClauses(title: string): string[] {
  return title
    .split(/[;|+\n]/)
    .map((clause) => clause.replace(/^\s*and\s+/i, '').trim())
    .filter(Boolean);
}

const DIRECTOR_WORD = /\bdirectors?\b/i;

const CHAIR_WORD = /\b(?:co[-\s]?)?chair(?:person|woman|man)?\b/i;

/**
 * Whatever follows the role word must name this unit or refer to it generically,
 * because "Director, Smilow Hospitalist Service", "Director of Research" and "Director of
 * Clinical Operations in the Center" are other directorates, and none carries a unit noun.
 */
function qualifierIsThisUnit(
  clause: string,
  centerName: string,
  roleWord: RegExp,
  qualifierRequired: boolean,
): boolean {
  const match = clause.match(roleWord);
  if (!match || match.index === undefined) return false;
  const qualifier = clause
    .slice(match.index + match[0].length)
    .replace(/^[\s,:\u2013\u2014-]+/, '')
    .replace(/^(?:of|for|at)\s+/i, '')
    .replace(/^the\s+/i, '')
    .trim();
  if (!qualifier) return !qualifierRequired;
  const head = qualifier.split(/\s*[,(]\s*|\s+(?:in|within|at)\s+/i)[0];
  return refersToThisUnitGenerically(head, centerName) || textNamesThisUnit(head, centerName);
}

/**
 * "The Center" refers to this unit only when this unit is a center: "Director, Program
 * in African Languages" on a council's page names a program inside it.
 */
function refersToThisUnitGenerically(text: string, centerName: string): boolean {
  if (!organizationTextIsGenericSelfReference(text)) return false;
  const unitWords = new Set(lowerWords(centerName));
  return lowerWords(text)
    .filter((word) => ORGANIZATION_NOUN.test(word))
    .every((word) => unitWords.has(word));
}

/**
 * A council or committee is led by its chair, so "Chair, Council on African Studies"
 * states the unit's head at the rank a director holds elsewhere. A bare "Chair" never counts, because it usually chairs a
 * department or a board rather than the unit being read.
 */
function chairTier(clause: string, centerName: string): DirectorTitleTier | null {
  if (DIRECTOR_WORD.test(clause) || !CHAIR_WORD.test(clause)) return null;
  if (NOT_CURRENT_TITLE.test(clause) || SECONDARY_TITLE_WORD.test(clause)) return null;
  if (!qualifierIsThisUnit(clause, centerName, CHAIR_WORD, true)) return null;
  return /\bco[-\s]?chair/i.test(clause) ? 'co' : 'top';
}

const UNIT_FILLER_WORDS = new Set([
  'a',
  'and',
  'at',
  'center',
  'centre',
  'core',
  'facility',
  'for',
  'in',
  'initiative',
  'institute',
  'of',
  'on',
  'program',
  'the',
  'yale',
]);

function lowerWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Whether a qualifier names this unit: it carries every distinctive word of the unit's
 * name, or an acronym the name states or forms. One shared word is not enough, because
 * "Director of Preservation and Conservation Services, Yale Library" shares a word with
 * the Institute for the Preservation of Cultural Heritage and names another office.
 */
export function textNamesThisUnit(text: string, centerName: string): boolean {
  const unitWords = lowerWords(centerName.replace(/\([^)]*\)/g, ' '));
  const distinctive = unitWords.filter((word) => !UNIT_FILLER_WORDS.has(word));
  const textWords = new Set(lowerWords(text));
  if (distinctive.length > 0 && distinctive.every((word) => textWords.has(word))) return true;
  const statedAcronyms = (centerName.match(/\b\p{Lu}{2,}\d*\b/gu) ?? []).map((word) =>
    word.toLowerCase(),
  );
  const initials = unitWords.filter(
    (word) => !['a', 'and', 'at', 'for', 'in', 'of', 'on', 'the'].includes(word),
  );
  const formed = [initials, initials.filter((word) => word !== 'yale')]
    .map((words) => words.map((word) => word[0]).join(''))
    .filter((acronym) => acronym.length >= 2);
  return [...statedAcronyms, ...formed].some((acronym) => textWords.has(acronym));
}

function clauseTier(clause: string, centerName: string): DirectorTitleTier | null {
  if (!DIRECTOR_WORD.test(clause)) return chairTier(clause, centerName);
  if (NOT_CURRENT_TITLE.test(clause) || isHistoricalDirectorship(clause)) return null;
  if (SECONDARY_TITLE_WORD.test(clause)) return null;
  if (!qualifierIsThisUnit(clause, centerName, DIRECTOR_WORD, false)) return null;
  if (CO_TITLE.test(clause)) return 'co';
  const prefix = clause
    .slice(0, clause.search(/\bdirectors?\b/i))
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const unitWords = new Set(lowerWords(centerName));
  const ownPrefix = textNamesThisUnit(prefix.join(' '), centerName)
    ? prefix.filter((word) => !unitWords.has(word))
    : prefix;
  if (ownPrefix.length > 3) return null;
  if (ownPrefix.every((word) => TOP_PREFIX_WORDS.has(word))) return 'top';
  if (ownPrefix.every((word) => TOP_PREFIX_WORDS.has(word) || HEAD_PREFIX_WORDS.has(word))) {
    return 'head';
  }
  return null;
}

const TIER_RANK: Record<DirectorTitleTier, number> = { top: 0, co: 1, head: 2 };

export function directorTitleTier(title: string, centerName: string): DirectorTitleTier | null {
  const text = textOf(title).replace(/[:\s]+$/, '');
  if (!text || text.length > MAX_LABEL_CHARS) return null;
  const tiers = titleClauses(text)
    .map((clause) => clauseTier(clause, centerName))
    .filter((tier): tier is DirectorTitleTier => tier !== null);
  if (tiers.length === 0) return null;
  return tiers.sort((left, right) => TIER_RANK[left] - TIER_RANK[right])[0];
}

function roleForTier(tier: DirectorTitleTier): CenterDirectorRole {
  return tier === 'co' ? 'co-director' : 'director';
}

function ownSegments(element: Element): string[] {
  const segments: string[] = [];
  let current = '';
  for (const child of element.children ?? []) {
    const node = child as AnyNode;
    if (node.type === 'text') current += ` ${(node as unknown as { data: string }).data}`;
    else if (node.type === 'tag' && (node as Element).tagName === 'br') {
      segments.push(current);
      current = '';
    }
  }
  segments.push(current);
  return segments.map(textOf).filter(Boolean);
}

interface TextLeaf {
  element: Element;
  text: string;
}

function sameLeaf(left: TextLeaf, right: TextLeaf): boolean {
  return left.element === right.element && left.text === right.text;
}

function leavesWithin(root: Element): TextLeaf[] {
  const leaves: TextLeaf[] = [];
  const visit = (element: Element) => {
    for (const text of ownSegments(element)) leaves.push({ element, text });
    for (const child of element.children ?? []) {
      if ((child as AnyNode).type === 'tag') visit(child as Element);
    }
  };
  visit(root);
  return leaves;
}

function yaleProfileUrl(
  $: cheerio.CheerioAPI,
  element: Element,
  pageUrl: string,
): string | undefined {
  const anchor = element.tagName === 'a' ? $(element) : $(element).closest('a');
  const href = textOf(anchor.attr('href'));
  if (!href || /^(?:mailto|tel|javascript):/i.test(href)) return undefined;
  try {
    const url = new URL(href, pageUrl);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    if (!/(?:^|\.)yale\.edu$/i.test(url.hostname)) return undefined;
    return url.toString().replace(/#.*$/, '');
  } catch {
    return undefined;
  }
}

interface NamedLeaf {
  name: string;
  profileUrl?: string;
}

function namedLeaves(
  $: cheerio.CheerioAPI,
  leaves: TextLeaf[],
  pageUrl: string,
  exclude: TextLeaf,
): NamedLeaf[] {
  const named: NamedLeaf[] = [];
  for (const leaf of leaves) {
    if (sameLeaf(leaf, exclude)) continue;
    const name = personNameFromText(leaf.text);
    if (!name) continue;
    if (named.some((entry) => observedPersonNameAgreesWith(entry.name, name))) continue;
    named.push({ name, profileUrl: yaleProfileUrl($, leaf.element, pageUrl) });
  }
  return named;
}

function parentElement(element: Element): Element | null {
  return element.parent && (element.parent as AnyNode).type === 'tag'
    ? (element.parent as Element)
    : null;
}

/**
 * A signature block in running copy puts the name and the title in adjacent
 * paragraphs of a container too large to read as one card, so the paragraph just
 * before the label is read first, then the one just after it.
 */
function namesBesideScope(
  $: cheerio.CheerioAPI,
  scope: Element,
  label: TextLeaf,
  pageUrl: string,
): NamedLeaf[] | null {
  for (const sibling of [$(scope).prev(), $(scope).next()]) {
    const element = sibling.get(0) as Element | undefined;
    if (!element || HEADING_TAGS.has(element.tagName)) continue;
    const leaves = leavesWithin(element);
    if (leaves.length > MAX_CARD_LEAVES) continue;
    const named = namedLeaves($, leaves, pageUrl, label);
    if (named.length > 0) return named;
  }
  return null;
}

function namesNearLabel(
  $: cheerio.CheerioAPI,
  label: TextLeaf,
  pageUrl: string,
): NamedLeaf[] | null {
  let scope: Element = label.element;
  let child: Element | null = null;
  for (let step = 0; step <= MAX_ANCESTOR_STEPS; step += 1) {
    const leaves = leavesWithin(scope);
    if (leaves.length > MAX_CARD_LEAVES) return null;
    const named = namedLeaves($, leaves, pageUrl, label);
    if (named.length > 1 && child) return namesBesideScope($, child, label, pageUrl) ?? named;
    if (named.length > 0) return named;
    child = scope;
    const parent = parentElement(scope);
    if (!parent) return null;
    if (leavesWithin(parent).length > MAX_CARD_LEAVES) {
      return namesBesideScope($, scope, label, pageUrl);
    }
    scope = parent;
  }
  return null;
}

function namesUnderHeading(
  $: cheerio.CheerioAPI,
  label: TextLeaf,
  pageUrl: string,
): NamedLeaf[] | null {
  const level = Number(label.element.tagName.slice(1));
  let sibling = $(label.element).next();
  for (let step = 0; step < 3 && sibling.length; step += 1) {
    const element = sibling.get(0) as Element;
    if (HEADING_TAGS.has(element.tagName) && Number(element.tagName.slice(1)) <= level) {
      return null;
    }
    const leaves = leavesWithin(element);
    if (leaves.length > MAX_CARD_LEAVES) return null;
    const named = namedLeaves($, leaves, pageUrl, label);
    if (named.length > 0) return named;
    sibling = sibling.next();
  }
  return null;
}

function namesInDefinition(
  $: cheerio.CheerioAPI,
  label: TextLeaf,
  term: Element,
  pageUrl: string,
): NamedLeaf[] | null {
  const definition = $(term).nextAll('dd').first().get(0) as Element | undefined;
  if (!definition) return null;
  const named = namedLeaves($, leavesWithin(definition), pageUrl, label);
  return named.length > 0 ? named : null;
}

const MAX_TEASER_ANCESTOR_STEPS = 6;

const PERSON_PAGE_PATH =
  /\/(?:profile|profiles|people|person|faculty|team|staff|directory|bio|humans)\//i;

function samePage(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.host === b.host && a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
}

/**
 * A listing of related units repeats each unit's own contact card, so a "Director"
 * label inside a teaser whose heading links to another unit's page names that unit's
 * director, not this one's.
 */
function insideOtherUnitTeaser(
  $: cheerio.CheerioAPI,
  element: Element,
  pageUrl: string,
  centerName: string,
): boolean {
  let current = $(element);
  for (let step = 0; step < MAX_TEASER_ANCESTOR_STEPS; step += 1) {
    current = current.parent();
    if (!current.length || current.is('body')) return false;
    const headingLinks = current.find('h1 a[href], h2 a[href], h3 a[href], h4 a[href]').toArray();
    if (headingLinks.length === 0) continue;
    if (headingLinks.length > 1) return false;
    const link = headingLinks[0];
    const text = textOf($(link).text());
    if (!text || /\bdirect/i.test(text)) return false;
    let target: URL;
    try {
      target = new URL(textOf($(link).attr('href')), pageUrl);
    } catch {
      return false;
    }
    if (PERSON_PAGE_PATH.test(target.pathname)) return false;
    return !samePage(target.toString(), pageUrl) && !textNamesThisUnit(text, centerName);
  }
  return false;
}

const INLINE_LABEL = /^(.{3,80}?)\s*[:|\u2013\u2014-]\s+(.{4,80})$/;

const CONTINUATION_LABEL = /^(?:&|and\b|\+)/i;

function candidatesFromLabel(
  $: cheerio.CheerioAPI,
  label: TextLeaf,
  pageUrl: string,
  centerName: string,
): CenterDirectorCandidate[] {
  const { element, text } = label;
  if (text.length > MAX_LABEL_CHARS || !/\b(?:direct|chair)/i.test(text)) return [];
  if (CONTINUATION_LABEL.test(text)) return [];
  if (insideOtherUnitTeaser($, element, pageUrl, centerName)) return [];

  const inline = text.match(INLINE_LABEL);
  if (inline) {
    const tier = directorTitleTier(inline[1], centerName);
    const name = tier ? personNameFromText(inline[2]) : undefined;
    if (tier && name) {
      return [
        {
          name,
          title: textOf(inline[1]),
          tier,
          role: roleForTier(tier),
          signal: 'inline',
          pageUrl,
        },
      ];
    }
  }

  const tier = directorTitleTier(text, centerName);
  if (!tier) return [];
  const term = element.tagName === 'dt' ? element : ($(element).closest('dt').get(0) as Element);
  let named: NamedLeaf[] | null;
  let signal: CenterDirectorSignal = 'label';
  if (term) {
    named = namesInDefinition($, label, term, pageUrl);
    signal = 'definition';
  } else {
    named = namesNearLabel($, label, pageUrl);
    if (!named && HEADING_TAGS.has(element.tagName)) {
      named = namesUnderHeading($, label, pageUrl);
      signal = 'heading';
    }
  }
  const people = named ?? [];
  const groupLabel = people.length > 1 && /\bdirectors\b/i.test(text);
  if (people.length > 1 && !groupLabel) return [];
  return people.map((person) => ({
    ...(groupLabel ? { groupLabel: text } : {}),
    name: person.name,
    title: text.replace(/[:|\s]+$/, ''),
    tier,
    role: roleForTier(tier),
    signal,
    pageUrl,
    ...(person.profileUrl ? { profileUrl: person.profileUrl } : {}),
  }));
}

/**
 * A plural heading such as "Institute Directors" groups a leadership team whose
 * members carry their own titles, so once any member's own title is stated the group
 * heading says nothing more about who directs the unit.
 */
function withoutTeamHeadings(candidates: CenterDirectorCandidate[]): CenterDirectorCandidate[] {
  const individual = candidates.filter((candidate) => !candidate.groupLabel);
  const supersededGroups = new Set(
    candidates
      .filter(
        (candidate) =>
          candidate.groupLabel &&
          individual.some((person) => observedPersonNameAgreesWith(person.name, candidate.name)),
      )
      .map((candidate) => candidate.groupLabel),
  );
  return candidates.filter(
    (candidate) => !candidate.groupLabel || !supersededGroups.has(candidate.groupLabel),
  );
}

function candidatesFromLabels(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  centerName: string,
): CenterDirectorCandidate[] {
  const candidates: CenterDirectorCandidate[] = [];
  $('body *').each((_index, node) => {
    const element = node as Element;
    for (const text of ownSegments(element)) {
      candidates.push(...candidatesFromLabel($, { element, text }, pageUrl, centerName));
    }
  });
  return withoutTeamHeadings(candidates);
}

const SENTENCE_NAME =
  "((?:\\p{Lu}[\\p{Ll}'’-]+|\\p{Lu}\\.)(?:\\s+(?:\\p{Lu}[\\p{L}'’-]+|\\p{Lu}\\.|de|da|del|van|von|di|du|la|le)){1,4})";
const SENTENCE_CREDENTIALS =
  '(?:,\\s*(?:Ph\\.?\\s?D|M\\.?\\s?D|M\\.?\\s?P\\.?\\s?H|J\\.?\\s?D|M\\.?\\s?S|M\\.?\\s?A)\\.?)*';
const SENTENCE_TITLE = '((?:founding\\s+|faculty\\s+|co-?)?director)';

const IS_DIRECTOR_OF = new RegExp(
  `${SENTENCE_NAME}${SENTENCE_CREDENTIALS},?\\s+(?:is|serves\\s+as)\\s+(?:the\\s+)?${SENTENCE_TITLE}\\s+(?:of|for)\\s+(?:the\\s+)?([^.,;()]{2,120})`,
  'gu',
);
const APPOSITIVE_DIRECTOR_OF = new RegExp(
  `${SENTENCE_NAME}${SENTENCE_CREDENTIALS},\\s+(?:the\\s+)?${SENTENCE_TITLE}\\s+(?:of|for)\\s+(?:the\\s+)?([^.,;()]{2,120})`,
  'gu',
);
const DIRECTED_BY = new RegExp(
  `(?:^|[.;]\\s+|\\b)((?:the\\s+|this\\s+)?[\\p{L}&' -]{2,120}?)\\s+(?:is|are)\\s+(co-)?directed\\s+by\\s+(?:professor\\s+|prof\\.\\s+|dr\\.?\\s+)?${SENTENCE_NAME}`,
  'giu',
);

function sentenceUnitIsThisUnit(unitText: string, centerName: string): boolean {
  const unit = textOf(unitText);
  return refersToThisUnitGenerically(unit, centerName) || textNamesThisUnit(unit, centerName);
}

function blockTexts($: cheerio.CheerioAPI): string[] {
  const texts: string[] = [];
  $('body *').each((_index, node) => {
    const element = node as Element;
    if (!BLOCK_TAGS.has(element.tagName)) return;
    const hasBlockChild = (element.children ?? []).some(
      (child) => (child as AnyNode).type === 'tag' && BLOCK_TAGS.has((child as Element).tagName),
    );
    if (hasBlockChild) return;
    const text = textOf($(element).text());
    if (text) texts.push(text);
  });
  return texts;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=\p{Lu})/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function candidatesFromSentence(
  sentence: string,
  pageUrl: string,
  centerName: string,
): CenterDirectorCandidate[] {
  const found: CenterDirectorCandidate[] = [];
  const push = (rawName: string, title: string, coDirected = false) => {
    const name = personNameFromText(rawName);
    if (!name) return;
    const tier: DirectorTitleTier = coDirected || /^co/i.test(title) ? 'co' : 'top';
    found.push({
      name,
      title: textOf(title),
      tier,
      role: roleForTier(tier),
      signal: 'sentence',
      pageUrl,
    });
  };
  for (const pattern of [IS_DIRECTOR_OF, APPOSITIVE_DIRECTOR_OF]) {
    for (const match of sentence.matchAll(pattern)) {
      const [, rawName, title, unit] = match;
      if (sentenceUnitIsThisUnit(unit, centerName)) push(rawName, title);
    }
  }
  for (const match of sentence.matchAll(DIRECTED_BY)) {
    const [, subject, co, rawName] = match;
    if (sentenceUnitIsThisUnit(subject.replace(/^.*\b(?:the|this)\s+/i, 'the '), centerName)) {
      push(rawName, co ? 'Co-Director' : 'Director', Boolean(co));
    }
  }
  return found;
}

function statementMentionsThisUnit(sentence: string, centerName: string): boolean {
  if (
    /\b(?:the|this|our)\s+(?:center|centre|institute|core|facility|program|initiative)\b/i.test(
      sentence,
    )
  ) {
    return true;
  }
  return textNamesThisUnit(sentence, centerName);
}

export function readCenterDirectorSignals(
  html: string,
  pageUrl: string,
  centerName: string,
): CenterDirectorPageSignals {
  const $ = cheerio.load(html || '');
  $(REMOVED_CHROME).remove();
  $(PAGE_CHROME)
    .filter((_index, element) => $(element).closest(CARD_CONTAINER).length === 0)
    .remove();
  const candidates = candidatesFromLabels($, pageUrl, centerName);
  const unsettledStatements: string[] = [];
  const seenStatements = new Set<string>();
  for (const block of blockTexts($)) {
    for (const sentence of sentencesOf(block)) {
      if (!/\bdirect(?:or|ors|ed\s+by)\b/i.test(sentence)) continue;
      const fromSentence = candidatesFromSentence(sentence, pageUrl, centerName);
      if (fromSentence.length > 0) {
        candidates.push(...fromSentence);
        continue;
      }
      if (sentence.length > MAX_UNSETTLED_STATEMENT_CHARS || sentence.length < 30) continue;
      if (!statementMentionsThisUnit(sentence, centerName)) continue;
      if (seenStatements.has(sentence)) continue;
      seenStatements.add(sentence);
      if (unsettledStatements.length < MAX_UNSETTLED_STATEMENTS) unsettledStatements.push(sentence);
    }
  }
  return { pageUrl, candidates, unsettledStatements };
}

interface StatedPerson {
  candidate: CenterDirectorCandidate;
  titles: string[];
}

function distinctPeople(candidates: CenterDirectorCandidate[]): StatedPerson[] {
  const people: StatedPerson[] = [];
  for (const candidate of candidates) {
    const person = people.find((entry) =>
      observedPersonNameAgreesWith(entry.candidate.name, candidate.name),
    );
    if (!person) {
      people.push({ candidate, titles: [candidate.title] });
      continue;
    }
    person.titles.push(candidate.title);
    if (!person.candidate.profileUrl && candidate.profileUrl) {
      person.candidate = { ...person.candidate, profileUrl: candidate.profileUrl };
    }
  }
  return people;
}

const FACULTY_DIRECTOR_TITLE = /\bfaculty\s+director\b/i;

/**
 * Owner decision (2026-10-19, #5296): where a page lists a "Director" beside a "Faculty
 * Director", the faculty director directs the unit, because the other title then names the
 * staff director who runs it day to day. Two faculty directors still refuse.
 */
function facultyDirectorAmongDirectors(people: StatedPerson[]): CenterDirectorCandidate | null {
  const faculty = people.filter((person) =>
    person.titles.some((title) => FACULTY_DIRECTOR_TITLE.test(title)),
  );
  if (faculty.length !== 1) return null;
  const othersAreDirectors = people
    .filter((person) => person !== faculty[0])
    .every((person) => person.titles.every((title) => DIRECTOR_WORD.test(title)));
  if (!othersAreDirectors) return null;
  const [person] = faculty;
  const title = person.titles.find((entry) => FACULTY_DIRECTOR_TITLE.test(entry)) ?? '';
  return { ...person.candidate, title };
}

const REFUSAL_BY_TIER: Record<DirectorTitleTier, CenterDirectorRefusal> = {
  top: 'several-directors',
  head: 'several-heads',
  co: 'several-co-directors',
};

/**
 * The one director the read pages state, at the best rank any page states. Two
 * different people at that rank refuse the whole read, because picking one would be a
 * guess, and a read with no settled director falls back to its unsettled statements.
 */
export function decideCenterDirector(
  pages: readonly CenterDirectorPageSignals[],
): CenterDirectorDecision {
  const all = pages.flatMap((page) => page.candidates);
  for (const tier of ['top', 'co', 'head'] as const) {
    const people = distinctPeople(all.filter((candidate) => candidate.tier === tier));
    if (people.length === 1) return { outcome: 'named', director: people[0].candidate };
    if (people.length > 1) {
      const faculty = tier === 'top' ? facultyDirectorAmongDirectors(people) : null;
      if (faculty) return { outcome: 'named', director: faculty };
      return { outcome: 'ambiguous', reason: REFUSAL_BY_TIER[tier], candidateCount: people.length };
    }
  }
  const withStatements = pages.find((page) => page.unsettledStatements.length > 0);
  if (withStatements) {
    return {
      outcome: 'prose-only',
      statements: withStatements.unsettledStatements,
      pageUrl: withStatements.pageUrl,
    };
  }
  return { outcome: 'none' };
}

/** Every distinct person the pages state as a director of this unit, at any rank. */
export function statedCenterDirectors(
  pages: readonly CenterDirectorPageSignals[],
): Array<{ name: string; role: CenterDirectorRole }> {
  return distinctPeople(pages.flatMap((page) => page.candidates)).map(({ candidate }) => ({
    name: candidate.name,
    role: candidate.role,
  }));
}

const MAX_DIRECTOR_PAGES = 4;

const LEADERSHIP_LINK =
  /\b(?:leadership|directors?|people|team|staff|faculty|administration|governance|who[-\s]?we[-\s]?are|about(?:[-\s]?us)?|contacts?)\b/i;

function leadershipLinkRank(label: string): number {
  if (/\b(?:leadership|directors?)\b/i.test(label)) return 0;
  if (/\b(?:about|who[-\s]?we[-\s]?are|governance|administration)\b/i.test(label)) return 1;
  return 2;
}

function subtreePrefix(url: URL): string {
  const pathname = url.pathname;
  if (pathname.endsWith('/')) return pathname;
  const withoutFile = /\/[^/]*\.[a-z0-9]{2,5}$/i.test(pathname)
    ? pathname.replace(/\/[^/]*$/, '')
    : pathname;
  return withoutFile.endsWith('/') ? withoutFile : `${withoutFile}/`;
}

/**
 * The pages to read for a unit's director: its own page first, then leadership pages
 * inside its own subtree. A Yale CMS unit page carries the whole school's navigation,
 * so a same-host "About" or "Leadership" link off a center's page usually reaches the
 * dean's or the provost's page, which names someone who leads a different unit.
 */
export function centerDirectorCandidateUrls(
  landingUrl: string,
  landingHtml: string,
  max = MAX_DIRECTOR_PAGES,
): string[] {
  let landing: URL;
  try {
    landing = new URL(landingUrl);
  } catch {
    return [];
  }
  const urls: string[] = [];
  const add = (value: string) => {
    const normalized = value.replace(/#.*$/, '');
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  };
  add(landing.toString());
  const prefix = subtreePrefix(landing).toLowerCase();
  const $ = cheerio.load(landingHtml || '');
  const ranked: Array<{ url: string; rank: number }> = [];
  $('a[href]').each((_index, node) => {
    const href = textOf($(node).attr('href'));
    if (!href || /^(?:mailto|tel|javascript):/i.test(href)) return;
    let resolved: URL;
    try {
      resolved = new URL(href, landing);
    } catch {
      return;
    }
    if (resolved.host !== landing.host) return;
    if (!resolved.pathname.toLowerCase().startsWith(prefix)) return;
    const label = `${textOf($(node).text())} ${resolved.pathname}`;
    if (!LEADERSHIP_LINK.test(label)) return;
    ranked.push({ url: resolved.toString(), rank: leadershipLinkRank(label) });
  });
  for (const entry of ranked.sort((left, right) => left.rank - right.rank)) add(entry.url);
  return urls.slice(0, max);
}
