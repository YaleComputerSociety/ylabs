import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { looksLikeListedPersonName } from '../sources/officialResearchHomeRosterScraper';
import { centerMemberRelationshipObservationsForEntityKey } from '../sources/centersInstitutesScraper';
import { normalizeName, SLUG_MAX_LENGTH, slugify, slugTokens } from './scraperHelpers';
import {
  LISTED_LAB_TARGET_KEY_PREFIX,
  RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
} from '../centerRelationshipTarget';
import { extractElementTextWithBlockSeparators } from './htmlText';
import type { ObservationInput } from '../types';

export type CenterAffiliationStructure =
  | 'profile-grid'
  | 'directory-card'
  | 'reference-card'
  | 'custom-card'
  | 'spotlight-card'
  | 'person-teaser'
  | 'core-contact'
  | 'profile-directory-link'
  | 'profile-link'
  | 'labelled-lines'
  | 'section-list'
  | 'name-role-line';

export interface CenterAffiliationListedPerson {
  name: string;
  personSlug: string;
  profileUrl?: string;
  title?: string;
  sectionLabel: string;
  structure: CenterAffiliationStructure;
}

export interface CenterAffiliationListedLab {
  name: string;
  url?: string;
  sectionLabel: string;
  structure: CenterAffiliationStructure;
}

export type CenterAffiliationRefusalReason =
  | 'not-a-person-name'
  | 'non-member-section'
  | 'administrative-title'
  | 'name-disagrees-with-profile-url'
  | 'conflicting-profile-urls'
  | 'shared-profile-url'
  | 'prose-mention';

export type CenterAffiliationReadOutcome = 'listed' | 'prose-only' | 'empty';

export interface CenterAffiliationPageRead {
  outcome: CenterAffiliationReadOutcome;
  people: CenterAffiliationListedPerson[];
  labs: CenterAffiliationListedLab[];
  refusals: Record<CenterAffiliationRefusalReason, number>;
  proseCharacterCount: number;
}

interface Candidate {
  node: cheerio.Cheerio<AnyNode>;
  kind: 'person' | 'lab';
  rawName: string;
  href: string;
  title: string;
  structure: CenterAffiliationStructure;
  requiresMemberHeading: boolean;
  checksProfileUrlAgreement: boolean;
  trail?: string[];
}

const CHROME_SELECTOR = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'template',
  'nav',
  'aside',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="search"]',
  '.breadcrumb',
  '.breadcrumbs',
].join(', ');

const MEMBER_HEADING =
  /\b(?:faculty|members?|membership|people|leadership|leaders?|directors?|co-?directors?|team|steering|committee|investigators?|scientists?|affiliates?|affiliated|associates?|participants?|participating|contacts?|who we are|labs?|laborator(?:y|ies)|research groups?|fellows|council)\b/i;

const NON_MEMBER_HEADING =
  /\b(?:news|stories|story|events?|calendar|seminars?|talks?|lectures?|colloqui\w*|webinars?|symposi\w*|workshops?|spotlights?|publications?|papers|articles|press|media|related|announcements?|opportunit\w*|jobs?|positions?|openings?|careers?|hiring|alumni|alumnae|former|past|previous|emerit\w*|memoriam|students?|undergraduates?|postdoc\w*|trainees?|advisory|external|visiting|board|partners?|sponsors?|donors?|funders?|supporters?|gifts?|administration|administrative|operations|business|newsletter|featured|highlights?|recent|latest|upcoming|courses?|resources|awards?|grants?)\b/i;

const STAFF_HEADING = /\bstaff\b/i;
const RESEARCH_PEOPLE_HEADING =
  /\b(?:faculty|members?|leadership|directors?|investigators?|scientists?)\b/i;

const NON_MEMBER_CONTAINER_CLASS =
  /(?:^|[-_\s])(?:news|events?|related|publications?|calendar|cores-card|author|authors|byline|citation)(?:[-_\s]|$)/i;

const ADMINISTRATIVE_TITLE =
  /\b(?:administrat\w*|financial|finance|analyst|coordinator|business|communications?|registrar|accountant|receptionist|secretary|office manager|program manager|(?<!research\s)assistant(?!\s+(?:professor|director|research scientist))|student|postdoc\w*|undergraduate)\b/i;
const RESEARCH_TITLE = /\b(?:professor|faculty|director|investigator|lecturer|chair)\b/i;

const PERSON_PATH_MARKER =
  /^(?:people|person|persons|profile|profiles|faculty|directory|team|members?)$/i;
const NETID_PATH_SEGMENT = /^[a-z]{2,4}\d{1,5}$/i;
const LAB_NAME = /^\p{Lu}[\p{L}'’.\- &]*\s(?:lab|laboratory|group)$/iu;

const ENTRY_NAME_BOUNDARY = /\s*(?:[(,:;|]|\s[–—-]\s)/u;
const PROSE_RESIDUE_LIMIT = 80;
const LIST_RESIDUE_LIMIT = 200;
const PROSE_ONLY_MIN_CHARACTERS = 200;
const HEADING_WRAPPER_SLACK = 20;
const NAME_ROLE_LINE_LIMIT = 120;
const NAME_ROLE_LINE_ROLE =
  /^(?:(?:founding|faculty|associate|assistant|deputy|executive|interim|acting|co-?)\s+)*(?:director|co-?director|chair|co-?chair|member|faculty member|principal investigator)\b/i;

const textOf = (value: string | undefined): string => (value || '').replace(/\s+/g, ' ').trim();

function blockText(node: cheerio.Cheerio<AnyNode>): string {
  const element = node[0];
  return element ? textOf(extractElementTextWithBlockSeparators(element)) : '';
}

function absoluteUrl(href: string, base: string): string {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(trimmed)) {
    return '';
  }
  try {
    const url = new URL(trimmed, base);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function urlIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    return `${host}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return url.toLowerCase();
  }
}

function personPathSlug(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const markerAt = segments.length - 2;
    if (markerAt < 0 || !PERSON_PATH_MARKER.test(segments[markerAt])) return undefined;
    return segments[segments.length - 1];
  } catch {
    return undefined;
  }
}

function flippedLastFirst(name: string): string {
  const match = /^([^,]+?)\s*,\s*([^,]+?)$/.exec(name);
  return match ? `${match[2]} ${match[1]}` : name;
}

function isCredentialClause(clause: string): boolean {
  const tokens = clause.split(/\s+/).filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.every(
      (token) =>
        token.replace(/\./g, '').length <= 6 && (token.match(/\p{Lu}/gu) || []).length >= 2,
    )
  );
}

function withoutCredentialClauses(name: string): string {
  const clauses = name.split(',');
  while (clauses.length > 1 && isCredentialClause(textOf(clauses[clauses.length - 1]))) {
    clauses.pop();
  }
  return clauses.join(',');
}

export function listedPersonName(raw: string): string {
  const cleaned = textOf(raw)
    .replace(/^view full profile of\s+/i, '')
    .replace(/['’]s profile$/i, '');
  return textOf(flippedLastFirst(withoutCredentialClauses(normalizeName(cleaned))));
}

const ORGANIZATION_WORD =
  /\b(?:yale|projects?|initiatives?|programs?|centers?|centre|institutes?|society|network|consortium|collaborative|alliance|foundation|facility|core|laborator(?:y|ies)|labs?|groups?|dynamics|studies|sciences?|health|medicine|research|office|department|school|council|committee|series|forum|working|reading|seminars?|journal|data|fund|awards?|sequencing|clinic|hospital)\b/i;
const SHOUTED_TOKEN = /(?:^|\s)\p{Lu}{3,}(?=\s|$)/u;

export function isListedPersonName(name: string): boolean {
  return (
    looksLikeListedPersonName(name) && !ORGANIZATION_WORD.test(name) && !SHOUTED_TOKEN.test(name)
  );
}

const NAME_LIST_SEPARATOR = /\s*(?:,|;|&|\band\b)\s*/i;

function namesOnlyList(text: string): string[] {
  const parts = text.split(NAME_LIST_SEPARATOR).map(textOf).filter(Boolean);
  const names = parts.map(listedPersonName);
  return names.length > 0 && names.every(isListedPersonName) ? names : [];
}

export function profileUrlAgreesWithName(url: string, name: string): boolean {
  const slug = personPathSlug(url);
  if (!slug) return false;
  if (NETID_PATH_SEGMENT.test(slug)) return true;
  const nameTokens = slugTokens(name);
  const surname = nameTokens[nameTokens.length - 1];
  if (!surname) return false;
  const urlTokens = slugTokens(slug);
  return urlTokens.includes(surname) || urlTokens.join('').includes(surname);
}

function headingLevel(node: cheerio.Cheerio<AnyNode>): number {
  const tag = (node[0] as { tagName?: string } | undefined)?.tagName || 'h6';
  return Number(tag.slice(1)) || 6;
}

function trailIsNonMember(trail: readonly string[]): boolean {
  return trail.some(
    (label) =>
      NON_MEMBER_HEADING.test(label) ||
      (STAFF_HEADING.test(label) && !RESEARCH_PEOPLE_HEADING.test(label)),
  );
}

function hasNonMemberContainer(node: cheerio.Cheerio<AnyNode>): boolean {
  return node
    .parents()
    .addBack()
    .toArray()
    .some((element) =>
      NON_MEMBER_CONTAINER_CLASS.test(String((element as any).attribs?.class || '')),
    );
}

function isDatedCard(card: cheerio.Cheerio<AnyNode>): boolean {
  return card.find('time, .date-time').length > 0;
}

function collectTemplateCandidates(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<AnyNode>,
): Candidate[] {
  const candidates: Candidate[] = [];
  const add = (candidate: Omit<Candidate, 'requiresMemberHeading' | 'checksProfileUrlAgreement'>) =>
    candidates.push({
      ...candidate,
      requiresMemberHeading: false,
      checksProfileUrlAgreement: false,
    });

  root.find('.profile-grid-item').each((_i, element) => {
    const card = $(element);
    if (card.parents('.profile-grid-item').length > 0) return;
    const titles = card
      .find('.profile-grid-item__title')
      .toArray()
      .map((title) => textOf($(title).text()))
      .filter(Boolean);
    add({
      node: card,
      kind: 'person',
      rawName:
        textOf(card.find('.profile-grid-item__name').first().text()) ||
        textOf(card.attr('aria-label')),
      href: card.find('a.profile-grid-item__link-details').first().attr('href') || '',
      title: titles.join('; '),
      structure: 'profile-grid',
    });
  });

  const headedCards: Array<[string, string, string, string, CenterAffiliationStructure]> = [
    [
      '.directory-listing-card',
      '.directory-listing-card__heading',
      '.directory-listing-card__subheading',
      '.directory-listing-card__snippet',
      'directory-card',
    ],
    [
      '.reference-card',
      '.reference-card__heading',
      '.reference-card__subheading',
      '.reference-card__snippet',
      'reference-card',
    ],
    [
      '.custom-card',
      '.custom-card__heading',
      '.custom-card__subheading',
      '.custom-card__snippet',
      'custom-card',
    ],
  ];
  for (const [
    cardSelector,
    headingSelector,
    subheadingSelector,
    snippetSelector,
    structure,
  ] of headedCards) {
    root.find(cardSelector).each((_i, element) => {
      const card = $(element);
      if (isDatedCard(card)) return;
      const heading = card.find(headingSelector).first();
      const rawName = textOf(heading.text());
      const subheading = textOf(card.find(subheadingSelector).first().text());
      const snippet = textOf(card.find(snippetSelector).first().text());
      const headingIsPerson = isListedPersonName(listedPersonName(rawName));
      const snippetNames = headingIsPerson ? [] : namesOnlyList(snippet);
      for (const name of snippetNames) {
        add({ node: card, kind: 'person', rawName: name, href: '', title: rawName, structure });
      }
      if (snippetNames.length > 0 && !LAB_NAME.test(rawName)) return;
      add({
        node: card,
        kind: LAB_NAME.test(rawName) ? 'lab' : 'person',
        rawName,
        href: heading.find('a').first().attr('href') || '',
        title: [subheading, snippet.length <= PROSE_RESIDUE_LIMIT ? snippet : '']
          .filter(Boolean)
          .join('; '),
        structure,
      });
    });
  }

  root.find('.card--faculty').each((_i, element) => {
    const card = $(element);
    add({
      node: card,
      kind: 'person',
      rawName: textOf(card.find('.card--faculty__name').first().text()),
      href: card.find('a[href]').first().attr('href') || '',
      title: textOf(card.find('.card--faculty__position').first().text()),
      structure: 'person-teaser',
    });
  });

  root.find('.profile-contact-widget').each((_i, element) => {
    const widget = $(element);
    add({
      node: widget,
      kind: 'person',
      rawName: textOf(widget.find('.profile-contact-widget-content__name').first().text()),
      href:
        widget.find('a.profile-contact-widget-content__link-details').first().attr('href') || '',
      title: [
        textOf(widget.attr('aria-label')),
        textOf(widget.find('.profile-contact-widget-content__title').first().text()),
      ]
        .filter(Boolean)
        .join('; '),
      structure: 'profile-grid',
    });
  });

  root.find('.content-spotlight-portrait').each((_i, element) => {
    const card = $(element);
    const link = card.find('.content-spotlight-portrait__ctas a').first();
    if (link.length === 0) return;
    add({
      node: card,
      kind: 'person',
      rawName: textOf(link.text()),
      href: link.attr('href') || '',
      title: '',
      structure: 'spotlight-card',
    });
  });

  const teasers: Array<[string, string, string]> = [
    ['article.node-teaser--person', '.node-teaser__heading a', '.node-teaser__professional-title'],
    ['.grid__user', '.grid__user__title', '.grid__user__job-title'],
  ];
  for (const [cardSelector, nameSelector, titleSelector] of teasers) {
    root.find(cardSelector).each((_i, element) => {
      const card = $(element);
      const nameNode = card.find(nameSelector).first();
      const link = nameNode.is('a') ? nameNode : card.find('a[href]').first();
      add({
        node: card,
        kind: 'person',
        rawName: textOf(nameNode.text()),
        href: link.attr('href') || '',
        title: textOf(card.find(titleSelector).first().text()),
        structure: 'person-teaser',
      });
    });
  }
  root.find('.views-field-name a.username').each((_i, element) => {
    const link = $(element);
    const row = link.closest('.views-row, tr');
    add({
      node: link,
      kind: 'person',
      rawName: textOf(link.text()),
      href: link.attr('href') || '',
      title: textOf(row.find('.views-field-field-title .field-content').first().text()),
      structure: 'person-teaser',
    });
  });

  root.find('.contact-section__listing-item, .info-box__primary-contact').each((_i, element) => {
    const item = $(element);
    const nameNode = item.is('.info-box__primary-contact')
      ? item.children('h3, h4').first()
      : item.find('.contact-section__primary-contact__name').first();
    const roleLine = textOf(item.find('.contact-title').first().text());
    const spans = nameNode
      .siblings('span')
      .toArray()
      .map((span) => textOf($(span).text()))
      .filter(Boolean);
    add({
      node: item,
      kind: 'person',
      rawName: textOf(nameNode.text()),
      href: '',
      title: [roleLine, ...spans].filter(Boolean).join('; '),
      structure: 'core-contact',
    });
  });

  root.find('a.hyperlink[href*="/profile/"]').each((_i, element) => {
    const link = $(element);
    add({
      node: link,
      kind: 'person',
      rawName: textOf(link.text()),
      href: link.attr('href') || '',
      title: '',
      structure: 'profile-directory-link',
    });
  });

  return candidates;
}

function isInside(node: AnyNode, claimed: ReadonlySet<AnyNode>): boolean {
  let current: AnyNode | null = node;
  while (current) {
    if (claimed.has(current)) return true;
    current = (current as { parent?: AnyNode | null }).parent ?? null;
  }
  return false;
}

function leadingEntryName(text: string): string {
  const boundary = ENTRY_NAME_BOUNDARY.exec(text);
  return textOf(boundary && boundary.index > 0 ? text.slice(0, boundary.index) : text);
}

function collectGenericCandidates(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<AnyNode>,
  claimed: ReadonlySet<AnyNode>,
  pageUrl: string,
  refusals: Record<CenterAffiliationRefusalReason, number>,
): Candidate[] {
  const candidates: Candidate[] = [];
  const linkedBlocks = new Set<AnyNode>();

  root.find('a[href]').each((_i, element) => {
    if (isInside(element, claimed)) return;
    const link = $(element);
    const url = absoluteUrl(link.attr('href') || '', pageUrl);
    if (!url || !personPathSlug(url)) return;
    const name = listedPersonName(link.text());
    if (!isListedPersonName(name)) return;
    const block = link.closest('li, td, dd, dt, h1, h2, h3, h4, h5, h6, p, div');
    const residue = Math.max(0, blockText(block).length - textOf(link.text()).length);
    const residueLimit = block.is('p, div') ? PROSE_RESIDUE_LIMIT : LIST_RESIDUE_LIMIT;
    if (residue > residueLimit) {
      refusals['prose-mention'] += 1;
      return;
    }
    if (block[0]) linkedBlocks.add(block[0]);
    candidates.push({
      node: link,
      kind: 'person',
      rawName: link.text(),
      href: url,
      title: '',
      structure: 'profile-link',
      requiresMemberHeading: false,
      checksProfileUrlAgreement: true,
    });
  });

  root.find('p').each((_i, element) => {
    if (isInside(element, claimed) || linkedBlocks.has(element)) return;
    const paragraph = $(element);
    const html = paragraph.html() || '';
    if (!/<br\s*\/?>/i.test(html) || paragraph.find('strong, b').length === 0) return;
    let label = '';
    for (const lineHtml of html.split(/<br\s*\/?>/i)) {
      const line = cheerio.load(`<div>${lineHtml}</div>`);
      const lineText = textOf(line('div').text());
      if (!lineText) continue;
      const boldText = textOf(line('strong, b').text());
      if (boldText && boldText === lineText) {
        label = lineText;
        continue;
      }
      if (!label || !MEMBER_HEADING.test(label) || trailIsNonMember([label])) continue;
      const rawName = leadingEntryName(lineText);
      candidates.push({
        node: paragraph,
        kind: LAB_NAME.test(rawName) ? 'lab' : 'person',
        rawName,
        href: line('a[href]').first().attr('href') || '',
        title: textOf(lineText.slice(rawName.length).replace(/^[\s,:;|–—-]+/, '')),
        structure: 'labelled-lines',
        requiresMemberHeading: false,
        checksProfileUrlAgreement: false,
        trail: [label],
      });
    }
    linkedBlocks.add(element);
  });

  root.find('p').each((_i, element) => {
    if (isInside(element, claimed) || linkedBlocks.has(element)) return;
    const node = $(element);
    const text = blockText(node);
    if (!text || text.length > NAME_ROLE_LINE_LIMIT) return;
    const rawName = leadingEntryName(text);
    const role = textOf(text.slice(rawName.length).replace(/^[\s,:;|–—-]+/, ''));
    if (!role || !NAME_ROLE_LINE_ROLE.test(role)) return;
    if (!isListedPersonName(listedPersonName(rawName))) return;
    linkedBlocks.add(element);
    candidates.push({
      node,
      kind: 'person',
      rawName,
      href: node.find('a[href]').first().attr('href') || '',
      title: role,
      structure: 'name-role-line',
      requiresMemberHeading: false,
      checksProfileUrlAgreement: false,
    });
  });

  root.find('li, td, dt, dd').each((_i, element) => {
    if (isInside(element, claimed) || linkedBlocks.has(element)) return;
    const node = $(element);
    if (node.find('li, td, dt, dd').length > 0) return;
    const text = blockText(node);
    if (!text || text.length > LIST_RESIDUE_LIMIT + 60) return;
    const rawName = leadingEntryName(text);
    const isLab = LAB_NAME.test(rawName);
    if (!isLab && !isListedPersonName(listedPersonName(rawName))) return;
    candidates.push({
      node,
      kind: isLab ? 'lab' : 'person',
      rawName,
      href: node.find('a[href]').first().attr('href') || '',
      title: textOf(text.slice(rawName.length).replace(/^[\s,:;|–—-]+/, '')),
      structure: 'section-list',
      requiresMemberHeading: true,
      checksProfileUrlAgreement: false,
    });
  });

  return candidates;
}

function assignTrails(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<AnyNode>,
  candidates: Candidate[],
): void {
  const byNode = new Map<AnyNode, Candidate[]>();
  for (const candidate of candidates) {
    const element = candidate.node[0];
    if (!element || candidate.trail) continue;
    byNode.set(element, [...(byNode.get(element) || []), candidate]);
  }
  const candidateNodes = new Set(byNode.keys());
  const trail: Array<{ label: string; level: number; scope: AnyNode }> = [];
  root.find('*').each((_i, element) => {
    const waiting = byNode.get(element);
    if (waiting) {
      const inScope = trail.filter((entry) => isInside(element, new Set([entry.scope])));
      for (const candidate of waiting) candidate.trail = candidateTrail($, candidate, inScope);
    }
    const node = $(element);
    if (!node.is('h1, h2, h3, h4, h5, h6') || isInside(element, candidateNodes)) return;
    const label = blockText(node);
    if (!label) return;
    const level = headingLevel(node);
    while (trail.length > 0 && trail[trail.length - 1].level >= level) trail.pop();
    trail.push({ label, level, scope: headingScope(node, label) });
  });
}

function candidateTrail(
  $: cheerio.CheerioAPI,
  candidate: Candidate,
  inScope: ReadonlyArray<{ label: string; level: number }>,
): string[] {
  const ownHeading = candidate.node
    .find('h1, h2, h3, h4, h5, h6')
    .toArray()
    .map((element) => $(element))
    .find((heading) => {
      const label = blockText(heading);
      const nameSlug = slugTokens(listedPersonName(candidate.rawName)).join('-');
      return label && !`-${slugTokens(label).join('-')}-`.includes(`-${nameSlug}-`);
    });
  if (!ownHeading) return inScope.map((entry) => entry.label);
  const level = headingLevel(ownHeading);
  return [
    ...inScope.filter((entry) => entry.level < level).map((entry) => entry.label),
    blockText(ownHeading),
  ];
}

function headingScope(heading: cheerio.Cheerio<AnyNode>, label: string): AnyNode {
  let scope = heading.parent();
  while (
    scope.parent().length > 0 &&
    blockText(scope).length <= label.length + HEADING_WRAPPER_SLACK
  ) {
    scope = scope.parent();
  }
  return scope[0] ?? heading[0];
}

function emptyRefusals(): Record<CenterAffiliationRefusalReason, number> {
  return {
    'not-a-person-name': 0,
    'non-member-section': 0,
    'administrative-title': 0,
    'name-disagrees-with-profile-url': 0,
    'conflicting-profile-urls': 0,
    'shared-profile-url': 0,
    'prose-mention': 0,
  };
}

function givenAndSurnameKey(name: string): string {
  const tokens = slugTokens(name);
  return `${tokens[0] || ''}|${tokens[tokens.length - 1] || ''}`;
}

function namesAgreeOnFirstAndLast(left: string, right: string): boolean {
  const a = slugTokens(left);
  const b = slugTokens(right);
  return a.length > 0 && b.length > 0 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

function resolveAmbiguity(
  people: CenterAffiliationListedPerson[],
  refusals: Record<CenterAffiliationRefusalReason, number>,
): CenterAffiliationListedPerson[] {
  const bySlug = new Map<string, CenterAffiliationListedPerson[]>();
  for (const person of people) {
    const key = givenAndSurnameKey(person.name);
    bySlug.set(key, [...(bySlug.get(key) || []), person]);
  }
  const merged: CenterAffiliationListedPerson[] = [];
  for (const listings of bySlug.values()) {
    const urls = new Set(
      listings
        .map((listing) => listing.profileUrl)
        .filter(Boolean)
        .map((url) => urlIdentity(url as string)),
    );
    if (urls.size > 1) {
      refusals['conflicting-profile-urls'] += 1;
      continue;
    }
    const [fullest] = [...listings].sort((a, b) => b.name.length - a.name.length);
    merged.push({
      ...fullest,
      profileUrl: listings.find((listing) => listing.profileUrl)?.profileUrl,
      title: listings.find((listing) => listing.title)?.title,
    });
  }

  const byUrl = new Map<string, CenterAffiliationListedPerson[]>();
  for (const person of merged) {
    if (!person.profileUrl) continue;
    const key = urlIdentity(person.profileUrl);
    byUrl.set(key, [...(byUrl.get(key) || []), person]);
  }
  const refused = new Set<CenterAffiliationListedPerson>();
  const folded = new Set<CenterAffiliationListedPerson>();
  for (const sharers of byUrl.values()) {
    if (sharers.length < 2) continue;
    const [longest] = [...sharers].sort((a, b) => b.name.length - a.name.length);
    if (sharers.every((person) => namesAgreeOnFirstAndLast(person.name, longest.name))) {
      for (const person of sharers) if (person !== longest) folded.add(person);
      continue;
    }
    refusals['shared-profile-url'] += sharers.length;
    for (const person of sharers) refused.add(person);
  }
  return merged.filter((person) => !refused.has(person) && !folded.has(person));
}

export function extractCenterAffiliationsFromPage(input: {
  html: string;
  pageUrl: string;
}): CenterAffiliationPageRead {
  const refusals = emptyRefusals();
  const $ = cheerio.load(input.html || '');
  $(CHROME_SELECTOR).remove();
  $('header, footer')
    .filter((_i, element) => $(element).parents('article, main, section').length === 0)
    .remove();
  const main = $('main, [role="main"]').first();
  const root = main.length > 0 ? main : $('body');

  const templateCandidates = collectTemplateCandidates($, root);
  const claimed = new Set<AnyNode>(
    templateCandidates.map((candidate) => candidate.node[0]).filter(Boolean),
  );
  const candidates = [
    ...templateCandidates,
    ...collectGenericCandidates($, root, claimed, input.pageUrl, refusals),
  ];
  assignTrails($, root, candidates);

  const people: CenterAffiliationListedPerson[] = [];
  const labs: CenterAffiliationListedLab[] = [];
  const labKeys = new Set<string>();
  for (const candidate of candidates) {
    const trail = candidate.trail || [];
    const sectionLabel = trail[trail.length - 1] || '';
    if (trailIsNonMember(trail) || hasNonMemberContainer(candidate.node)) {
      refusals['non-member-section'] += 1;
      continue;
    }
    if (candidate.requiresMemberHeading && !MEMBER_HEADING.test(sectionLabel)) continue;
    const url = absoluteUrl(candidate.href, input.pageUrl);
    if (candidate.kind === 'lab') {
      const name = textOf(candidate.rawName);
      const key = slugify(name);
      if (!key || labKeys.has(key)) continue;
      labKeys.add(key);
      labs.push({ name, ...(url ? { url } : {}), sectionLabel, structure: candidate.structure });
      continue;
    }
    const name = listedPersonName(candidate.rawName);
    if (!isListedPersonName(name)) {
      refusals['not-a-person-name'] += 1;
      continue;
    }
    if (ADMINISTRATIVE_TITLE.test(candidate.title) && !RESEARCH_TITLE.test(candidate.title)) {
      refusals['administrative-title'] += 1;
      continue;
    }
    if (candidate.checksProfileUrlAgreement && !profileUrlAgreesWithName(url, name)) {
      refusals['name-disagrees-with-profile-url'] += 1;
      continue;
    }
    const personSlug = slugify(name);
    if (!personSlug) continue;
    people.push({
      name,
      personSlug,
      ...(url && urlIdentity(url) !== urlIdentity(input.pageUrl) ? { profileUrl: url } : {}),
      ...(candidate.title ? { title: candidate.title } : {}),
      sectionLabel,
      structure: candidate.structure,
    });
  }

  const listedPeople = resolveAmbiguity(people, refusals);
  const proseCharacterCount = root
    .find('p')
    .toArray()
    .reduce((total, element) => total + blockText($(element)).length, 0);
  const outcome: CenterAffiliationReadOutcome =
    listedPeople.length > 0 || labs.length > 0
      ? 'listed'
      : proseCharacterCount >= PROSE_ONLY_MIN_CHARACTERS
        ? 'prose-only'
        : 'empty';
  return { outcome, people: listedPeople, labs, refusals, proseCharacterCount };
}

const LISTED_LAB_RELATIONSHIP_TYPE = 'AFFILIATED_LAB';
const LISTED_AFFILIATION_EVIDENCE_STRENGTH = 'MODERATE';
const LISTED_AFFILIATION_CONFIDENCE = 0.72;

export function listedLabTargetEntityKey(lab: CenterAffiliationListedLab): string {
  const labSlug = slugify(lab.name);
  return labSlug ? `${LISTED_LAB_TARGET_KEY_PREFIX}${labSlug}`.slice(0, SLUG_MAX_LENGTH) : '';
}

function listedLabObservations(
  lab: CenterAffiliationListedLab,
  centerEntityKey: string,
  sourceUrl: string,
): ObservationInput[] {
  const targetEntityKey = listedLabTargetEntityKey(lab);
  if (!lab.url || !targetEntityKey) return [];
  const base = {
    entityType: 'researchEntityRelationship' as const,
    entityKey: `${centerEntityKey}:${targetEntityKey}:${LISTED_LAB_RELATIONSHIP_TYPE}`,
    sourceUrl,
  };
  return [
    { ...base, field: 'sourceEntityKey', value: centerEntityKey },
    { ...base, field: 'targetEntityKey', value: targetEntityKey },
    { ...base, field: 'relationshipType', value: LISTED_LAB_RELATIONSHIP_TYPE },
    { ...base, field: 'evidenceStrength', value: LISTED_AFFILIATION_EVIDENCE_STRENGTH },
    { ...base, field: 'confidence', value: LISTED_AFFILIATION_CONFIDENCE },
    { ...base, field: RELATIONSHIP_TARGET_WEBSITE_URL_FIELD, value: lab.url },
  ];
}

export function centerAffiliationPageObservations(
  read: CenterAffiliationPageRead,
  context: { centerEntityKey: string; sourceUrl: string },
): ObservationInput[] {
  if (!context.centerEntityKey) return [];
  return [
    ...read.people.flatMap((person) =>
      centerMemberRelationshipObservationsForEntityKey(
        context.centerEntityKey,
        {
          name: person.name,
          role: 'affiliated',
          profileUrl: person.profileUrl,
          title: person.title,
        },
        context.sourceUrl,
      ),
    ),
    ...read.labs.flatMap((lab) =>
      listedLabObservations(lab, context.centerEntityKey, context.sourceUrl),
    ),
  ];
}
