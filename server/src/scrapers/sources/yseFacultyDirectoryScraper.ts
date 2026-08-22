/**
 * YseFacultyDirectoryScraper
 *
 * Bespoke scraper for Yale School of the Environment faculty. Environmental
 * faculty and labs rarely maintain standalone lab microsites, so the YSE faculty
 * directory (environment.yale.edu/directory/faculty) and each faculty member's
 * individual profile page are their best official source of record. This
 * complements yseCentersScraper.ts (which covers YSE centers/programs/institutes,
 * not faculty).
 *
 * Crawl shape:
 *   - The directory root is a SEED only. It is never recorded as a source.
 *   - Each faculty's individual profile page (/directory/faculty/<slug>) is the
 *     official source cited for every observation about that person and their
 *     research home. Loader endpoints and the directory root are rejected
 *     listings and are never cited (issues #510/#516/#529/#549).
 *
 * A profile with research areas seeds a FACULTY_RESEARCH_AREA research home even
 * when the faculty has no lab microsite; a profile that links its own lab/personal
 * research site seeds a LAB home with that site as the websiteUrl. Contact is
 * fail-closed: emails are used only to derive a stable netid identity and are
 * redacted from public payloads at read time.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import { normalizeOrcid } from '../../utils/orcid';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';
import {
  isLikelyPersonSpecificYaleEmail,
  netidFromEmail,
  normalizeName,
  slugify,
  splitName,
} from '../utils/scraperHelpers';

const DIRECTORY_URL = 'https://environment.yale.edu/directory/faculty';
const SOURCE_KEY = 'yse-faculty-directory';
const SCHOOL_NAME = 'Yale School of the Environment';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
// The profile-page research prose is the faculty's own official description but
// lives on a profile page, so it must rank at the profile-page description tier:
// above the synthesized roster one-liner (0.5) and below a lab-microsite full
// page (0.82). Mirrors labMicrositeDescriptionLLMExtractor's profile branch.
const PROFILE_DESCRIPTION_CONFIDENCE = 0.55;
const INFERRED_PI_CONFIDENCE = 0.7;

export type HtmlFetcher = (url: string, useCache: boolean) => Promise<string>;

export interface RawYseFaculty {
  name: string;
  profileUrl: string;
  slug: string;
}

export interface YseFacultyProfile {
  name: string;
  profileUrl: string;
  slug: string;
  title?: string;
  email?: string;
  orcid?: string;
  researchAreas: string[];
  programs: string[];
  description?: string;
  labUrl?: string;
}

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function cleanText(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = cleanText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function facultyProfileSlug(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/\/directory\/faculty\/[^/]+\/?$/i.test(parsed.pathname)) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? last.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Parse the directory roster into {name, profileUrl, slug} rows. The directory
 * root itself and non-faculty (/directory/staff/...) links are ignored; only
 * genuine /directory/faculty/<slug> individual profile links are followed.
 */
export function parseDirectory(html: string, pageUrl: string = DIRECTORY_URL): RawYseFaculty[] {
  const $ = cheerio.load(html);
  const out: RawYseFaculty[] = [];
  const seen = new Set<string>();

  $('article.profile__item').each((_i, el) => {
    const card = $(el);
    const link = card.find('.profile__segment--name a[href*="/directory/faculty/"]').first();
    const href = link.attr('href') || '';
    if (!href) return;
    const profileUrl = absolutize(href, pageUrl);
    const slug = facultyProfileSlug(profileUrl);
    if (!slug || seen.has(slug)) return;
    const name = normalizeName(link.text());
    if (!name) return;
    seen.add(slug);
    out.push({ name, profileUrl, slug });
  });

  return out;
}

function sectionByEyebrow($: cheerio.CheerioAPI, label: string): cheerio.Cheerio<any> | null {
  let match: cheerio.Cheerio<any> | null = null;
  $('.profile__info').each((_i, el) => {
    if (match) return;
    const section = $(el);
    const eyebrow = cleanText(section.find('.eyebrow').first().text());
    if (eyebrow.toLowerCase() === label.toLowerCase()) match = section;
  });
  return match;
}

function extractResearchAreas($: cheerio.CheerioAPI): string[] {
  const section = sectionByEyebrow($, 'Areas of Expertise');
  if (!section) return [];
  const values: string[] = [];
  section.find('a[href*="/experts-guide/"]').each((_i, a) => {
    values.push(cleanText($(a).text()));
  });
  return uniqueStrings(values).slice(0, 30);
}

const GENERIC_FACULTY_ROLE_LABELS = new Set([
  'core faculty',
  'adjunct faculty',
  'affiliated faculty',
  'secondary faculty',
  'emeritus faculty',
  'emeritus',
  'lecturer',
  'faculty',
]);

/**
 * The "More" section lists a role-type link plus any academic program homes the
 * faculty belongs to (e.g. The Forest School). Role links point at faculty-type
 * filtered listings and are dropped; genuine program affiliations are kept as the
 * department-program value.
 */
export function extractPrograms($: cheerio.CheerioAPI): string[] {
  const section = sectionByEyebrow($, 'More');
  if (!section) return [];
  const values: string[] = [];
  section.find('ul li a[href]').each((_i, a) => {
    const link = $(a);
    const href = link.attr('href') || '';
    if (/facultytype|\/profiles\/faculty/i.test(href)) return;
    const text = cleanText(link.text());
    if (!text || GENERIC_FACULTY_ROLE_LABELS.has(text.toLowerCase())) return;
    values.push(text);
  });
  return uniqueStrings(values).slice(0, 5);
}

function extractDescription($: cheerio.CheerioAPI): string | undefined {
  const body = $('.cell.medium-8 .wysiwyg').first();
  if (!body.length) return undefined;
  const parts: string[] = [];
  body.find('p').each((_i, p) => {
    const text = cleanText($(p).text());
    if (text) parts.push(text);
  });
  const text = cleanText(parts.join(' '));
  if (text.length < 40) return undefined;
  return text.slice(0, 2000);
}

const GENERIC_RESEARCH_SITE_LABEL =
  /^(?:lab(?:oratory)?(?: website| site)?|website|personal(?: website| site| page)?|home ?page|research ?group(?: website| site)?|group(?: website| site)?)$/i;

/**
 * The "Links" section can list the faculty's own lab/personal research site, one
 * or more affiliated centers, an ORCID link, and a CV PDF. Only a generically
 * labeled self-site link ("Website" / "Lab Website") is treated as this person's
 * research home; a named-entity link (an affiliated center or institute) belongs
 * to a different research entity and is never adopted as this faculty's website.
 */
export function extractLabUrl($: cheerio.CheerioAPI, profileUrl: string): string | undefined {
  const section = sectionByEyebrow($, 'Links');
  if (!section) return undefined;
  let found: string | undefined;
  section.find('ul li a[href]').each((_i, a) => {
    if (found) return;
    const link = $(a);
    const text = cleanText(link.text());
    if (!GENERIC_RESEARCH_SITE_LABEL.test(text)) return;
    const href = link.attr('href') || '';
    if (/^mailto:|^tel:|^#|^javascript:/i.test(href)) return;
    const absolute = absolutize(href, profileUrl);
    let parsed: URL;
    try {
      parsed = new URL(absolute);
    } catch {
      return;
    }
    if (!/^https?:$/i.test(parsed.protocol)) return;
    if (/orcid\.org$/i.test(parsed.hostname)) return;
    if (/\.(?:pdf|docx?|pptx?|xlsx?)$/i.test(parsed.pathname)) return;
    found = absolute;
  });
  return found;
}

function extractOrcid($: cheerio.CheerioAPI): string | undefined {
  let orcid: string | undefined;
  $('a[href*="orcid.org"]').each((_i, a) => {
    if (orcid) return;
    const normalized = normalizeOrcid($(a).attr('href') || '');
    if (normalized) orcid = normalized;
  });
  return orcid;
}

export function extractProfile(
  html: string,
  faculty: RawYseFaculty,
): YseFacultyProfile {
  const $ = cheerio.load(html);
  const name = normalizeName($('h1').first().text()) || faculty.name;

  const positionBlock = $('.profile__position').first();
  const positionParts: string[] = [];
  positionBlock.find('.semijoin').each((_i, span) => {
    const text = cleanText($(span).text());
    if (text) positionParts.push(text);
  });
  const title =
    (positionParts.length > 0 ? positionParts.join('; ') : cleanText(positionBlock.text())) ||
    undefined;

  let email: string | undefined;
  const contact = sectionByEyebrow($, 'Contact');
  if (contact) {
    contact.find('a[href^="mailto:"]').each((_i, a) => {
      if (email) return;
      const candidate = ($(a).attr('href') || '').replace(/^mailto:/i, '').trim().toLowerCase();
      if (isLikelyPersonSpecificYaleEmail(candidate, name)) email = candidate;
    });
  }

  return {
    name,
    profileUrl: faculty.profileUrl,
    slug: faculty.slug,
    title,
    email,
    orcid: extractOrcid($),
    researchAreas: extractResearchAreas($),
    programs: extractPrograms($),
    description: extractDescription($),
    labUrl: extractLabUrl($, faculty.profileUrl),
  };
}

/**
 * User (Researcher) observations. Identity keys on netid when a person-specific
 * @yale.edu email is present, otherwise on a synthetic yse:<slug> key. Every
 * observation is sourced to the individual profile page, never the directory root.
 */
export function facultyToUserObservations(profile: YseFacultyProfile): {
  observations: ObservationInput[];
  entityKey: string;
} {
  const { first, last } = splitName(profile.name);
  const netid = netidFromEmail(profile.email);
  const entityKey = netid ? `netid:${netid}` : `yse:${profile.slug}`;
  const base = { entityType: 'user' as const, entityKey, sourceUrl: profile.profileUrl };
  const obs: ObservationInput[] = [];

  if (netid) obs.push({ ...base, field: 'netid', value: netid });
  if (first) obs.push({ ...base, field: 'fname', value: first });
  if (last) obs.push({ ...base, field: 'lname', value: last });
  obs.push({ ...base, field: 'userType', value: 'faculty' });
  obs.push({ ...base, field: 'primaryDepartment', value: SCHOOL_NAME });
  obs.push({ ...base, field: 'departments', value: [SCHOOL_NAME] });
  if (profile.email) obs.push({ ...base, field: 'email', value: profile.email });
  if (profile.title) obs.push({ ...base, field: 'title', value: profile.title });
  obs.push({ ...base, field: 'profileUrls', value: { departmental: profile.profileUrl } });
  if (profile.orcid) obs.push({ ...base, field: 'orcid', value: profile.orcid });
  if (profile.description) obs.push({ ...base, field: 'bio', value: profile.description });
  if (profile.researchAreas.length > 0) {
    obs.push({ ...base, field: 'researchInterests', value: profile.researchAreas });
    obs.push({ ...base, field: 'topics', value: profile.researchAreas });
  }
  obs.push({ ...base, field: 'dataSources', value: [SOURCE_KEY] });

  return { observations: obs, entityKey };
}

/**
 * ResearchEntity observations. A profile that links its own lab/personal research
 * site seeds a LAB home with that site as the websiteUrl; otherwise a profile with
 * research areas seeds a FACULTY_RESEARCH_AREA home whose only cited source is the
 * profile page (the profile page is not a research-home websiteUrl). Returns [] for
 * a profile with neither a lab site nor research areas so nothing empty is minted.
 */
export function facultyToResearchEntityObservations(
  profile: YseFacultyProfile,
  ownerEntityKey: string,
): ObservationInput[] {
  const hasLab = Boolean(profile.labUrl);
  if (!hasLab && profile.researchAreas.length === 0) return [];

  const slug = `yse-faculty-${profile.slug}`.slice(0, 100);
  const entityName = hasLab ? `${profile.name} Lab` : `${profile.name} Faculty Research`;
  const departments = uniqueStrings([SCHOOL_NAME, ...profile.programs]);
  const sourceUrls = hasLab ? [profile.profileUrl, profile.labUrl!] : [profile.profileUrl];
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: slug,
    sourceUrl: profile.profileUrl,
  };

  const obs: ObservationInput[] = [
    { ...base, field: 'slug', value: slug },
    { ...base, field: 'name', value: entityName },
    { ...base, field: 'kind', value: hasLab ? 'lab' : 'individual' },
    { ...base, field: 'entityType', value: hasLab ? 'LAB' : 'FACULTY_RESEARCH_AREA' },
    { ...base, field: 'school', value: SCHOOL_NAME },
    { ...base, field: 'departments', value: departments },
    { ...base, field: 'sourceUrls', value: sourceUrls },
    {
      ...base,
      field: 'inferredPiUserKey',
      value: ownerEntityKey,
      confidenceOverride: INFERRED_PI_CONFIDENCE,
    },
  ];

  if (hasLab) obs.push({ ...base, field: 'websiteUrl', value: profile.labUrl });
  if (profile.researchAreas.length > 0) {
    obs.push({ ...base, field: 'researchAreas', value: profile.researchAreas });
  }
  if (profile.description) {
    obs.push({
      ...base,
      field: 'fullDescription',
      value: profile.description,
      confidenceOverride: PROFILE_DESCRIPTION_CONFIDENCE,
    });
  }

  return obs;
}

async function fetchHtml(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = res.data as string;
  if (useCache) await setCached(SOURCE_KEY, cacheKey, html);
  return html;
}

export class YseFacultyDirectoryScraper implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'YSE faculty directory and individual profiles';

  constructor(private readonly htmlFetcher: HtmlFetcher = fetchHtml) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    ctx.log(`Fetching ${DIRECTORY_URL}`);
    const directoryHtml = await this.htmlFetcher(DIRECTORY_URL, ctx.options.useCache);
    const roster = parseDirectory(directoryHtml, DIRECTORY_URL);
    ctx.log(`Parsed ${roster.length} faculty from directory`);

    const limited = limitOption ? roster.slice(0, limitOption) : roster;

    let totalObs = 0;
    let facultyCount = 0;
    let entityCount = 0;
    let labCount = 0;
    let areaCount = 0;

    for (const faculty of limited) {
      let profileHtml: string;
      try {
        profileHtml = await this.htmlFetcher(faculty.profileUrl, ctx.options.useCache);
      } catch (err: any) {
        ctx.log(`[${faculty.slug}] profile fetch failed: ${sanitizeLogValue(err)}`);
        continue;
      }

      const profile = extractProfile(profileHtml, faculty);
      const { observations: userObs, entityKey } = facultyToUserObservations(profile);
      await ctx.emit(userObs);
      totalObs += userObs.length;
      facultyCount += 1;

      const entityObs = facultyToResearchEntityObservations(profile, entityKey);
      if (entityObs.length > 0) {
        await ctx.emit(entityObs);
        totalObs += entityObs.length;
        entityCount += 1;
        if (profile.labUrl) labCount += 1;
        if (profile.researchAreas.length > 0) areaCount += 1;
      }
    }

    ctx.log(
      `Emitted ${totalObs} observations across ${facultyCount} faculty / ${entityCount} entities ` +
        `(${labCount} with lab sites, ${areaCount} with research areas)`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: facultyCount + entityCount,
      notes: `YSE faculty: ${facultyCount} researchers, ${entityCount} research homes (${labCount} labs, ${areaCount} with areas)`,
    };
  }
}
