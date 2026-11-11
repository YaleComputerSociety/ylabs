import * as cheerio from 'cheerio';
import { normalizeOfficialProfileDestination } from '../../services/leadProfileIdentity';
import { isYaleProfileUrl } from '../yaleProfileDepartureEvidence';
import { isLikelyPersonSpecificYaleEmail, splitName } from './scraperHelpers';
import {
  isPersonNameParticleOrSuffixToken,
  sanitizePersonName,
} from '../../utils/personNameHygiene';
import { observedPersonNameAgreesWith } from './personNameAgreement';
import { givenNamesEquivalent } from './piNameMatch';
import { normalizedYaleNetid } from '../../utils/yaleNetid';

export const ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD = 'profileIdentityEvidence';

/**
 * Cached evidence is keyed on this, so changing what the extractor emits without bumping it
 * serves the old extractor's output for every cached page (#5677). A test pins it to the
 * extractor's output on a fixture corpus, so a change here or in a dependency fails until bumped.
 */
export const ROSTER_MEMBER_IDENTITY_EVIDENCE_EXTRACTOR_VERSION = 3;

const MAX_LINKED_PROFILE_URLS = 40;
const MAX_EMAILS = 5;
const MAX_NETIDS = 3;
const YALE_EMAIL_PATTERN = /[a-z0-9._%+-]+@yale\.edu\b/gi;

export interface RosterMemberIdentityEvidence {
  pageUrl: string;
  linkedProfileUrls: string[];
  emails: string[];
  netids: string[];
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const uniqueCapped = (values: readonly string[], cap: number): string[] =>
  [...new Set(values.filter(Boolean))].slice(0, cap);

export function isYaleHostedUrl(value: unknown): boolean {
  try {
    const url = new URL(textOf(value));
    return /^https?:$/.test(url.protocol) && /(^|\.)yale\.edu$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function absoluteHttpUrl(href: unknown, base: string): string {
  try {
    const url = new URL(textOf(href), base);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function flattenJsonLd(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [record, ...flattenJsonLd(record['@graph']), ...flattenJsonLd(record.mainEntity)];
}

function jsonLdPeople($: cheerio.CheerioAPI): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      nodes.push(...flattenJsonLd(JSON.parse($(el).contents().text())));
    } catch {
      return;
    }
  });
  return nodes.filter((node) => {
    const type = node['@type'];
    return Array.isArray(type) ? type.includes('Person') : type === 'Person';
  });
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

function statedNetids(people: ReadonlyArray<Record<string, unknown>>): string[] {
  const netids: string[] = [];
  for (const person of people) {
    for (const identifier of asList(person.identifier)) {
      if (!identifier || typeof identifier !== 'object') continue;
      const record = identifier as Record<string, unknown>;
      const label = `${textOf(record.propertyID)} ${textOf(record.name)}`.toLowerCase();
      if (!/\bnet\s?id\b/.test(label)) continue;
      const netid = normalizedYaleNetid(textOf(record.value));
      if (netid) netids.push(netid);
    }
  }
  return netids;
}

const namesAgree = (left: string, right: string): boolean =>
  observedPersonNameAgreesWith(left, right) || observedPersonNameAgreesWith(right, left);

function jsonLdPersonName(person: Record<string, unknown>): string {
  const stated = textOf(person.name);
  if (stated) return stated;
  return [textOf(person.givenName), textOf(person.familyName)].filter(Boolean).join(' ');
}

/**
 * The Person metadata about the page's subject. A people grid or a co-author block declares a
 * Person per listed colleague, so only a node whose name agrees with the member counts, and an
 * unnamed node counts only when it is the page's single Person (#5592).
 */
function subjectPeople(
  people: ReadonlyArray<Record<string, unknown>>,
  memberName: string,
): Array<Record<string, unknown>> {
  if (!memberName) return people.length === 1 ? [...people] : [];
  return people.filter((person) => {
    const name = jsonLdPersonName(person);
    return name ? namesAgree(name, memberName) : people.length === 1;
  });
}

const LINK_TARGET_NOUN =
  '(?:profile|website|web\\s*site|home\\s*page|homepage|web\\s*page|bio|biography|page)';

const SUBJECT_LINK_LABEL = new RegExp(
  `^(?:view\\s+|visit\\s+|see\\s+)?(?:(?:my|full|faculty|official|yale|personal|lab|research|department)\\s+)?${LINK_TARGET_NOUN}$`,
  'i',
);

const SCHOOL_QUALIFIER_WORDS = new Set([
  'engineering',
  'medicine',
  'nursing',
  'law',
  'divinity',
  'management',
  'architecture',
  'music',
  'drama',
  'art',
  'health',
  'public',
  'environment',
  'school',
  'department',
]);

const LINK_TARGET_NOUN_ONLY = new RegExp(`^${LINK_TARGET_NOUN}$`, 'i');

/**
 * "SOM Faculty Profile", "Engineering Faculty Profile": a school named in front of the noun.
 * A qualifier must be an all-capitals acronym or a school word, never free text, because a
 * free qualifier lets "<colleague> Profile" through as a generic label.
 */
function isSchoolQualifiedLinkLabel(label: string): boolean {
  const words = label.split(' ');
  const noun = words.pop() ?? '';
  if (!LINK_TARGET_NOUN_ONLY.test(noun)) return false;
  if (words[words.length - 1]?.toLowerCase() === 'faculty') words.pop();
  if (words.length < 1 || words.length > 2) return false;
  return words.every(
    (word) => /^[A-Z]{2,6}$/.test(word) || SCHOOL_QUALIFIER_WORDS.has(word.toLowerCase()),
  );
}

const BARE_URL_TEXT = /^(?:https?:\/\/)?[\w.-]+\.yale\.edu\b/i;

type AnchorLabelKind = 'generic' | 'member-name' | 'member-slug';

interface SubjectAnchorCandidate {
  url: string;
  destination: string;
  label: string;
  kind: AnchorLabelKind;
}

const anchorLabel = ($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]): string => {
  const anchor = $(el);
  return (anchor.text() || anchor.attr('aria-label') || anchor.attr('title') || '')
    .replace(/\s+/g, ' ')
    .trim();
};

const isGenericSubjectLabel = (label: string): boolean =>
  SUBJECT_LINK_LABEL.test(label) || isSchoolQualifiedLinkLabel(label) || BARE_URL_TEXT.test(label);

/**
 * Only an anchor labelled with what reads as someone's full name speaks for another person.
 * "Learn more", "Contact", a publication title or a bare "Dr. <Surname>" names nobody, so it
 * must not cost the member a generic link to the same page (#5677).
 */
const LABEL_HONORIFIC_LEAD_IN = /^(?:dr|prof|professor|dean|mr|mrs|ms|mx)\.?\s+/i;

const NON_NAME_LINK_WORDS = new Set([
  'about',
  'bio',
  'click',
  'contact',
  'details',
  'email',
  'here',
  'home',
  'info',
  'information',
  'lab',
  'learn',
  'more',
  'page',
  'profile',
  'read',
  'see',
  'view',
  'visit',
  'website',
]);

const MAX_PERSON_NAME_LABEL_TOKENS = 5;

function labelReadsAsPersonName(label: string): boolean {
  const name = label.replace(LABEL_HONORIFIC_LEAD_IN, '').trim();
  if (/\d/.test(name)) return false;
  const tokens = name.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > MAX_PERSON_NAME_LABEL_TOKENS) return false;
  return tokens.every(
    (token) =>
      !NON_NAME_LINK_WORDS.has(token.toLowerCase().replace(/[.,]+$/, '')) &&
      (/^\p{Lu}/u.test(token) || isPersonNameParticleOrSuffixToken(token)),
  );
}

const nameTokens = (value: string): string[] =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length > 1);

/**
 * Whether a profile URL's last path segment spells the member's given name (or a recognised
 * variant) and surname. A surname alone is not enough: a co-author card for a colleague who
 * shares a common surname would pass (#5677).
 */
const GENERATIONAL_SUFFIX_TOKENS = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

function slugNamesMember(url: string, memberName: string): boolean {
  const { first, last } = splitName(sanitizePersonName(memberName) ?? memberName);
  const surname = nameTokens(last)
    .filter((token) => !GENERATIONAL_SUFFIX_TOKENS.has(token))
    .pop();
  const given = nameTokens(first)[0];
  if (!surname || !given) return false;
  let slugTokens: string[];
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    slugTokens = nameTokens(segments[segments.length - 1] ?? '');
  } catch {
    return false;
  }
  if (!slugTokens.includes(surname)) return false;
  return slugTokens.some(
    (token) => token !== surname && (token === given || givenNamesEquivalent(token, given)),
  );
}

/**
 * Anchors the page subject could own, each pointing at a person-profile-shaped page and outside
 * navigation and footers. An anchor whose URL spells the member's full name counts whatever its
 * label, even in an aside ("Associated programs"). Otherwise it must sit outside asides and be
 * labelled either generically ("Profile", "Website") or with the member's own name: one labelled
 * with someone else's name or a publication title belongs to a co-author, colleague or
 * related-items block (#5592, #5677), and only one labelled with another person's name marks its
 * destination as that person's.
 */
/**
 * Containers whose links never belong to the page subject: navigation, footers, and co-author or
 * collaborator blocks. A profile showing one co-author card trips neither the repeated-label nor
 * the other-person rule, because the card's name is plain text beside a lone "View Full Profile"
 * (#5677).
 */
const NON_SUBJECT_LINK_CONTAINER =
  'nav, footer, [class*="co-author"], [class*="coauthor"], [class*="collaborator"]';

function subjectAnchorCandidates(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  memberName: string,
): { candidates: SubjectAnchorCandidate[]; otherPersonDestinations: Set<string> } {
  const candidates: SubjectAnchorCandidate[] = [];
  const otherPersonDestinations = new Set<string>();
  $('a[href]').each((_i, el) => {
    const url = absoluteHttpUrl($(el).attr('href'), pageUrl);
    if (!url || !isYaleProfileUrl(url) || $(el).closest(NON_SUBJECT_LINK_CONTAINER).length > 0) {
      return;
    }
    const destination = normalizeOfficialProfileDestination(url);
    const label = anchorLabel($, el);
    if (slugNamesMember(url, memberName)) {
      candidates.push({ url, destination, label, kind: 'member-slug' });
      return;
    }
    if (!label || $(el).closest('aside').length > 0) return;
    if (isGenericSubjectLabel(label)) {
      candidates.push({ url, destination, label: label.toLowerCase(), kind: 'generic' });
    } else if (memberName && namesAgree(label, memberName)) {
      candidates.push({ url, destination, label, kind: 'member-name' });
    } else if (labelReadsAsPersonName(label)) {
      otherPersonDestinations.add(destination);
    }
  });
  return { candidates, otherPersonDestinations };
}

/**
 * A generic label speaks for the page subject only when nothing on the page says it speaks for
 * someone else. A people grid or co-author block repeats "View Full Profile" under every card,
 * beside an anchor to the same page labelled with that colleague's name, so a generic anchor is
 * dropped when another anchor names a different person at its destination, or when its label
 * leads to more than one page (#5677).
 */
function subjectAnchorUrls($: cheerio.CheerioAPI, pageUrl: string, memberName: string): string[] {
  const { candidates, otherPersonDestinations } = subjectAnchorCandidates($, pageUrl, memberName);
  const destinationsByGenericLabel = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'generic') continue;
    const destinations = destinationsByGenericLabel.get(candidate.label) ?? new Set<string>();
    destinations.add(candidate.destination);
    destinationsByGenericLabel.set(candidate.label, destinations);
  }
  return candidates
    .filter((candidate) => {
      if (candidate.kind !== 'generic') return true;
      if (otherPersonDestinations.has(candidate.destination)) return false;
      return (destinationsByGenericLabel.get(candidate.label)?.size ?? 0) <= 1;
    })
    .map((candidate) => candidate.url);
}

function linkedProfileUrls(
  $: cheerio.CheerioAPI,
  people: ReadonlyArray<Record<string, unknown>>,
  pageUrl: string,
  memberName: string,
): string[] {
  const declared = [
    $('link[rel="canonical"]').first().attr('href'),
    $('meta[property="og:url"]').first().attr('content'),
    ...subjectPeople(people, memberName).flatMap((person) => [
      ...asList(person.url),
      ...asList(person.sameAs),
    ]),
  ]
    .map((href) => absoluteHttpUrl(href, pageUrl))
    .filter(isYaleHostedUrl);
  return uniqueCapped(
    [pageUrl, ...declared, ...subjectAnchorUrls($, pageUrl, memberName)],
    MAX_LINKED_PROFILE_URLS,
  );
}

// Only mailto links and the page's own Person metadata are read, never body text, because a
// footer or sidebar contact address is not the member's; the name filter then drops a lab
// manager or department address listed beside the member.
function personEmails(
  $: cheerio.CheerioAPI,
  people: ReadonlyArray<Record<string, unknown>>,
  memberName: string,
): string[] {
  const candidates: string[] = people.flatMap((person) => asList(person.email).map(textOf));
  $('a[href^="mailto:"]').each((_i, el) => {
    candidates.push(textOf($(el).attr('href')).replace(/^mailto:/i, ''));
  });
  const emails = candidates
    .flatMap((candidate) => candidate.match(YALE_EMAIL_PATTERN) ?? [])
    .map((email) => email.toLowerCase())
    .filter((email) => isLikelyPersonSpecificYaleEmail(email, memberName));
  return uniqueCapped(emails, MAX_EMAILS);
}

export function extractRosterMemberIdentityEvidence(
  html: string,
  pageUrl: string,
  memberName: string,
): RosterMemberIdentityEvidence {
  const $ = cheerio.load(html);
  const people = jsonLdPeople($);
  return {
    pageUrl,
    linkedProfileUrls: linkedProfileUrls($, people, pageUrl, memberName),
    emails: personEmails($, people, memberName),
    netids: uniqueCapped(statedNetids(subjectPeople(people, memberName)), MAX_NETIDS),
  };
}

const stringList = (value: unknown, cap: number): string[] =>
  Array.isArray(value) ? uniqueCapped(value.map(textOf), cap) : [];

export function parseRosterMemberIdentityEvidence(
  value: unknown,
): RosterMemberIdentityEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const evidence: RosterMemberIdentityEvidence = {
    pageUrl: textOf(record.pageUrl),
    linkedProfileUrls: stringList(record.linkedProfileUrls, MAX_LINKED_PROFILE_URLS).filter(
      isYaleHostedUrl,
    ),
    emails: stringList(record.emails, MAX_EMAILS)
      .map((email) => email.toLowerCase())
      .filter((email) => /^[a-z0-9._%+-]+@yale\.edu$/.test(email)),
    netids: stringList(record.netids, MAX_NETIDS).map(normalizedYaleNetid).filter(Boolean),
  };
  const statesAnything =
    evidence.linkedProfileUrls.length + evidence.emails.length + evidence.netids.length > 0;
  return statesAnything ? evidence : null;
}
