import type * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import {
  admissibleSubjectAddress,
  isYaleAddress,
  subjectDeclaredProfileEmail,
} from './officialProfileSubjectEmail';

const NETID_SHAPE = /^[a-z]{2,6}\d{1,5}$/;
const SITE_CHROME_TAGS = new Set(['footer', 'nav']);
const SITE_CHROME_ROLES = new Set(['navigation', 'contentinfo', 'banner']);
const SITE_CHROME_LABEL = /footer|breadcrumb|mega-?menu|site-header|navigation/i;
const SIDEBAR_TAGS = new Set(['aside']);
const SIDEBAR_LABEL = /sidebar/i;
const FOREIGN_BLOCK_LABEL =
  /related|co-?authors?|collaborat|colleague|media-contact|press|admin|assistant|support|staff|business|team|member/i;
const CONTACT_FIELD_LABEL = /mail|contact/i;
const PAGE_ROOT_TAGS = new Set(['body', 'html']);

type MailtoRegion = 'chrome' | 'foreign' | 'sidebar' | 'contact-field' | 'content';

function flattenJsonLd(value: unknown): Array<Record<string, any>> {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (typeof value !== 'object') return [];
  const record = value as Record<string, any>;
  return [record, ...flattenJsonLd(record['@graph']), ...flattenJsonLd(record.mainEntity)];
}

function jsonLdNodes($: cheerio.CheerioAPI): Array<Record<string, any>> {
  const nodes: Array<Record<string, any>> = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      nodes.push(...flattenJsonLd(JSON.parse($(el).contents().text())));
    } catch {
      return;
    }
  });
  return nodes;
}

function mailtoRegion($: cheerio.CheerioAPI, link: Element): MailtoRegion {
  let sidebar = false;
  let contactField = false;
  for (let el: Element | null = link; el; el = el.parent as Element | null) {
    if (el.type !== 'tag') break;
    const tag = el.tagName.toLowerCase();
    if (PAGE_ROOT_TAGS.has(tag)) break;
    const label = [$(el).attr('class'), $(el).attr('id'), $(el).attr('aria-label')].join(' ');
    const role = String($(el).attr('role') || '').toLowerCase();
    if (SITE_CHROME_TAGS.has(tag) || SITE_CHROME_ROLES.has(role) || SITE_CHROME_LABEL.test(label)) {
      return 'chrome';
    }
    if (FOREIGN_BLOCK_LABEL.test(label)) return 'foreign';
    if (SIDEBAR_TAGS.has(tag) || role === 'complementary' || SIDEBAR_LABEL.test(label)) {
      sidebar = true;
    }
    if (CONTACT_FIELD_LABEL.test(label)) contactField = true;
  }
  if (sidebar) return 'sidebar';
  return contactField ? 'contact-field' : 'content';
}

type RegionedAddress = { address: string; inSidebar: boolean };

function mailtoAddressInSubjectContent(
  $: cheerio.CheerioAPI,
  link: Element,
  displayName: string,
): RegionedAddress | undefined {
  const region = mailtoRegion($, link);
  if (region === 'chrome' || region === 'foreign') return undefined;
  const address = admissibleSubjectAddress($(link).attr('href'), displayName);
  if (!address) return undefined;
  const netidShaped = NETID_SHAPE.test(address.split('@')[0]);
  if (netidShaped && region !== 'contact-field') return undefined;
  return { address, inSidebar: region === 'sidebar' };
}

function soleAddress(addresses: RegionedAddress[]): string | undefined {
  const distinct = new Set(addresses.map((candidate) => candidate.address));
  return distinct.size === 1 ? [...distinct][0] : undefined;
}

/**
 * The address a roster person's own profile page states for that person, or nothing.
 *
 * The subject's own JSON-LD node or contact field decides first. Otherwise a site footer,
 * navigation or a block labelled as someone else's (an assistant, business office, press
 * contact, co-author or related-people card) prints a real person's address that is not the
 * subject's (#5780), so only a mailto outside those counts. A netid-shaped address carries no
 * name the roster can check against the subject, so it is read only from a contact field in the
 * page's own content, never a sidebar. A sidebar is read only when the page content states no
 * address. Two different addresses leave the subject's undecided.
 */
export function rosterProfileSubjectEmail(
  $: cheerio.CheerioAPI,
  displayName: string | undefined,
): string | undefined {
  const name = displayName ?? '';
  const declared = name ? subjectDeclaredProfileEmail($, jsonLdNodes($), name) : '';
  if (declared && isYaleAddress(declared)) return declared;
  const candidates: RegionedAddress[] = [];
  $('a[href^="mailto:"]').each((_i, el) => {
    const candidate = mailtoAddressInSubjectContent($, el, name);
    if (candidate) candidates.push(candidate);
  });
  const inPageContent = candidates.filter((candidate) => !candidate.inSidebar);
  if (inPageContent.length > 0) return soleAddress(inPageContent);
  return soleAddress(candidates);
}
