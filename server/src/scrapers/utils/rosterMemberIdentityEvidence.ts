import * as cheerio from 'cheerio';
import { isYaleProfileUrl } from '../yaleProfileDepartureEvidence';
import { isLikelyPersonSpecificYaleEmail } from './scraperHelpers';
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

function linkedProfileUrls(
  $: cheerio.CheerioAPI,
  people: ReadonlyArray<Record<string, unknown>>,
  pageUrl: string,
): string[] {
  const declared = [
    $('link[rel="canonical"]').first().attr('href'),
    $('meta[property="og:url"]').first().attr('content'),
    ...people.flatMap((person) => [...asList(person.url), ...asList(person.sameAs)]),
  ]
    .map((href) => absoluteHttpUrl(href, pageUrl))
    .filter(isYaleHostedUrl);
  const anchors: string[] = [];
  $('a[href]').each((_i, el) => {
    const url = absoluteHttpUrl($(el).attr('href'), pageUrl);
    if (url && isYaleProfileUrl(url)) anchors.push(url);
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
    linkedProfileUrls: linkedProfileUrls($, people, pageUrl),
    emails: personEmails($, people, memberName),
    netids: uniqueCapped(statedNetids(people), MAX_NETIDS),
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
