import type * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { localPartNamesARole, normalizeName, slugify } from './scraperHelpers';

const ADDRESS_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const WHOLE_ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const PERSON_TYPE = /^(?:https?:\/\/schema\.org\/)?Person$/i;
const NODE_BOUNDARY_TAGS = new Set(['article', 'aside', 'nav', 'footer']);
const FOREIGN_BLOCK_LABEL =
  /related|co-?authors?|collaborat|colleague|media-contact|press|admin|assistant|support|staff|team|people|member|footer|sidebar|breadcrumb/i;
const CONTACT_FIELD_LABEL = /mail|contact/i;
const SUBJECT_ROLE_TOKENS = new Set(['lab', 'labs', 'program', 'programs']);
const ROLE_LEADING_WORDS = [
  'admin',
  'chair',
  'department',
  'dept',
  'info',
  'lab',
  'office',
  'program',
];
const NETID_SHAPE = /^[a-z]{2,6}\d{1,5}$/;

export function isYaleAddress(address: string): boolean {
  return /@yale\.edu$/i.test(address);
}

function decodedMailtoAddress(value: string): string {
  const withoutScheme = value
    .trim()
    .replace(/^mailto:/i, '')
    .split('?')[0];
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

function localPartTokens(localPart: string): string[] {
  return localPart.split(/[._+-]+/).filter(Boolean);
}

function tokenNamesALabOrProgram(token: string): boolean {
  return SUBJECT_ROLE_TOKENS.has(token);
}

function tokenLeadsWithARoleWord(token: string): boolean {
  if (NETID_SHAPE.test(token)) return false;
  return ROLE_LEADING_WORDS.some((word) => token.length > word.length && token.startsWith(word));
}

function localPartCarriesTheSubjectName(localPart: string, displayName: string): boolean {
  const joined = localPart.replace(/[._+-]+/g, '');
  return nameTokens(displayName)
    .filter((token) => token.length >= 3)
    .some((token) => joined.includes(token));
}

/**
 * Whether a local part names an office rather than the page's subject. A role word as a whole
 * token decides alone. A role word fused to a unit abbreviation with no separator (`chair` plus a
 * department code) is only a leading affix of a one-token local part, so it decides only when
 * the address also carries none of the subject's own name tokens; a surname that happens to
 * begin with a role word keeps its address.
 */
export function localPartNamesASubjectRole(localPart: string, displayName: string): boolean {
  if (localPartNamesARole(localPart)) return true;
  const tokens = localPartTokens(localPart);
  if (tokens.some(tokenNamesALabOrProgram)) return true;
  if (tokens.length !== 1 || !tokenLeadsWithARoleWord(tokens[0])) return false;
  return !localPartCarriesTheSubjectName(localPart, displayName);
}

export function admissibleSubjectAddress(value: unknown, displayName: string): string {
  const address = decodedMailtoAddress(String(value ?? ''))
    .trim()
    .toLowerCase();
  if (!WHOLE_ADDRESS.test(address)) return '';
  const localPart = address.split('@')[0].replace(/\+.*$/, '');
  return localPartNamesASubjectRole(localPart, displayName) ? '' : address;
}

function jsonLdTypes(node: Record<string, any>): string[] {
  const raw = node['@type'];
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(String);
}

export function isJsonLdPersonNode(node: Record<string, any>): boolean {
  return jsonLdTypes(node).some((type) => PERSON_TYPE.test(type));
}

export function jsonLdNodesThatMayNameThePerson(
  nodes: Array<Record<string, any>>,
): Array<Record<string, any>> {
  return nodes.filter((node) => jsonLdTypes(node).length === 0 || isJsonLdPersonNode(node));
}

function nameTokens(value: unknown): string[] {
  return slugify(normalizeName(String(value ?? '')))
    .split('-')
    .filter(Boolean);
}

export function namesTheSamePerson(left: unknown, right: unknown): boolean {
  const a = nameTokens(left);
  const b = nameTokens(right);
  return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a.at(-1) === b.at(-1);
}

export function isJsonLdNodeOfAnotherPerson(
  node: Record<string, any>,
  displayName: string,
): boolean {
  return isJsonLdPersonNode(node) && !namesTheSamePerson(node.name, displayName);
}

function singleAddress(addresses: Iterable<string>): string {
  const distinct = new Set([...addresses].filter(Boolean));
  return distinct.size === 1 ? [...distinct][0] : '';
}

export function subjectJsonLdEmail(nodes: Array<Record<string, any>>, displayName: string): string {
  const subjectNodes = nodes.filter(
    (node) => isJsonLdPersonNode(node) && namesTheSamePerson(node.name, displayName),
  );
  return singleAddress(
    subjectNodes
      .flatMap((node) => (Array.isArray(node.email) ? node.email : [node.email]))
      .map((email) => admissibleSubjectAddress(email, displayName)),
  );
}

function blockLabel($: cheerio.CheerioAPI, el: Element): string {
  return [$(el).attr('class'), $(el).attr('id'), $(el).attr('aria-label')].join(' ');
}

function belongsToSubjectContactField(
  $: cheerio.CheerioAPI,
  owner: Element,
  subjectNode: Element,
): boolean {
  let labelledAsContactField = false;
  for (let el: Element | null = owner; el && el !== subjectNode; el = el.parent as Element | null) {
    if (el.type !== 'tag') return false;
    if (NODE_BOUNDARY_TAGS.has(el.tagName.toLowerCase())) return false;
    const label = blockLabel($, el);
    if (FOREIGN_BLOCK_LABEL.test(label)) return false;
    if (CONTACT_FIELD_LABEL.test(label)) labelledAsContactField = true;
  }
  return labelledAsContactField;
}

function textAddressOwners(node: AnyNode, found: Array<[Element, string]>): void {
  if (node.type === 'text') {
    const parent = node.parent as Element | null;
    for (const match of node.data.matchAll(ADDRESS_IN_TEXT)) {
      if (parent) found.push([parent, match[0]]);
    }
    return;
  }
  if ('children' in node) for (const child of node.children) textAddressOwners(child, found);
}

/**
 * The address a profile page prints in its own person node's contact field, read only when
 * that node prints exactly one. Nested cards, asides, related-people and co-author widgets,
 * administrative and press contacts, and footers belong to someone else, so an address there
 * is never the subject's.
 */
export function subjectContactBlockEmail($: cheerio.CheerioAPI, displayName: string): string {
  if (!displayName) return '';
  const heading = $('h1')
    .filter((_i, el) => namesTheSamePerson($(el).text(), displayName))
    .first();
  const subjectNode = heading.closest('article').get(0);
  if (!subjectNode || subjectNode.type !== 'tag') return '';
  const owners: Array<[Element, string]> = [];
  $(subjectNode)
    .find('a[href]')
    .each((_i, el) => {
      const href = $(el).attr('href') || '';
      if (/^mailto:/i.test(href.trim())) owners.push([el, href]);
    });
  textAddressOwners(subjectNode, owners);
  return singleAddress(
    owners
      .filter(([owner]) => belongsToSubjectContactField($, owner, subjectNode))
      .map(([, value]) => admissibleSubjectAddress(value, displayName)),
  );
}

export function subjectDeclaredProfileEmail(
  $: cheerio.CheerioAPI,
  jsonLdNodes: Array<Record<string, any>>,
  displayName: string,
): string {
  return subjectJsonLdEmail(jsonLdNodes, displayName) || subjectContactBlockEmail($, displayName);
}
