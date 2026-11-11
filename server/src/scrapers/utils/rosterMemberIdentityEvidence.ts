import * as cheerio from 'cheerio';
import { isYaleProfileUrl } from '../yaleProfileDepartureEvidence';
import { isLikelyPersonSpecificYaleEmail } from './scraperHelpers';
import { observedPersonNameAgreesWith } from './personNameAgreement';
import { normalizedYaleNetid } from '../../utils/yaleNetid';

export const ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD = 'profileIdentityEvidence';

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

const SUBJECT_LINK_LABEL =
  /^(?:view\s+|visit\s+|see\s+)?(?:(?:my|full|faculty|official|yale|personal|lab|research|department)\s+)?(?:profile|website|web\s*site|home\s*page|homepage|web\s*page|bio|biography|page)$/i;

const BARE_URL_TEXT = /^(?:https?:\/\/)?[\w.-]+\.yale\.edu\b/i;

/**
 * Whether an anchor is the page subject's own link: outside navigation, footers and asides,
 * and labelled either generically ("Profile", "Website") or with the member's own name. An
 * anchor labelled with someone else's name or a publication title belongs to a co-author,
 * colleague or related-items block, and never names the member's profile (#5592).
 */
function anchorIsSubjectLink(
  $: cheerio.CheerioAPI,
  el: Parameters<cheerio.CheerioAPI>[0],
  memberName: string,
): boolean {
  const anchor = $(el);
  if (anchor.closest('nav, footer, aside').length > 0) return false;
  const label = (anchor.text() || anchor.attr('aria-label') || anchor.attr('title') || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return false;
  if (SUBJECT_LINK_LABEL.test(label) || BARE_URL_TEXT.test(label)) return true;
  return Boolean(memberName) && namesAgree(label, memberName);
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
  const anchors: string[] = [];
  $('a[href]').each((_i, el) => {
    const url = absoluteHttpUrl($(el).attr('href'), pageUrl);
    if (url && isYaleProfileUrl(url) && anchorIsSubjectLink($, el, memberName)) anchors.push(url);
  });
  return uniqueCapped([pageUrl, ...declared, ...anchors], MAX_LINKED_PROFILE_URLS);
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
