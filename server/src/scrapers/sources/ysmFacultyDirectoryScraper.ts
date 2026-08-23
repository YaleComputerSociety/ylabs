/**
 * YsmFacultyDirectoryScraper
 *
 * Bespoke per-faculty enrichment scraper for the Yale School of Medicine's
 * school-wide A-Z faculty directory (issue #639). `ysm-atoz-index` covers YSM
 * lab research homes discovered from the centralized lab-websites index;
 * `ysm-mesh-keyword` attaches governed MeSH research areas to entities that
 * already exist. Neither walks the school-wide faculty directory itself to
 * discover new PIs and lab websites directly from each faculty's own profile.
 *
 * Crawl shape:
 *   - The A-Z directory root is a SEED only (~14k entries: faculty, staff, and
 *     trainees). It is never recorded as a source.
 *   - Each individual's own profile page (`/profile/<slug>/`) is the official
 *     source cited for every observation about that person and their research
 *     home. The directory root and any listing/facet page are rejected
 *     listings and are never cited (issues #510/#516/#529/#549).
 *   - A profile is only processed further when its own "research" section
 *     carries a lab website or governed MeSH research areas; the directory
 *     lists many non-research staff and trainees whose profile has no
 *     research section at all, and those are skipped without emitting any
 *     observation (identity roster maintenance for the wider community is
 *     `yale-directory`'s job, not this per-PI enrichment pass).
 *
 * A profile with its own lab website seeds a LAB research home with that site
 * as the websiteUrl; a profile with governed research areas but no lab site
 * seeds a FACULTY_RESEARCH_AREA home instead. Contact is fail-closed: emails
 * derive stable Researcher identity and key the lead PI to the canonical Yale
 * User, and are redacted from public payloads at read time. The lead PI is
 * never attached from a surname match against the User collection (#562,
 * #579); identity here comes directly from the person's own official profile
 * page, keyed by their own profile email/netid, exactly as `yseFacultyDirectoryScraper`
 * already does for YSE.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { normalizeOrcid } from '../../utils/orcid';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import {
  isLikelyPersonSpecificYaleEmail,
  netidFromEmail,
  splitName,
} from '../utils/scraperHelpers';
import { classifyUserType, looksLikeNonResearchTitle } from './yaleDirectoryScraper';
import { normalizeYsmProfileUrl } from './ysmMeshKeywordScraper';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';

const DIRECTORY_URL = 'https://medicine.yale.edu/faculty/faculty-directory/facultylist/';
const SOURCE_KEY = 'ysm-faculty-directory';
const SCHOOL_NAME = 'Yale School of Medicine';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
// The profile-page research prose is the faculty's own official description but
// lives on a profile page, so it must rank at the profile-page description tier:
// above the synthesized roster one-liner and below a lab-microsite full page.
// Mirrors yseFacultyDirectoryScraper and labMicrositeDescriptionLLMExtractor's
// profile branch.
const PROFILE_DESCRIPTION_CONFIDENCE = 0.55;
const INFERRED_PI_CONFIDENCE = 0.7;
const MAX_RESEARCH_AREAS = 24;
const MAX_DEPARTMENTS = 10;

export type HtmlFetcher = (url: string, useCache: boolean) => Promise<string>;

export interface RawYsmFaculty {
  name: string;
  profileUrl: string;
  slug: string;
}

export interface YsmFacultyProfile {
  name: string;
  profileUrl: string;
  slug: string;
  title?: string;
  email?: string;
  orcid?: string;
  departments: string[];
  researchAreas: string[];
  description?: string;
  bio?: string;
  labUrl?: string;
  labName?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = textValue(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function decodeEmbeddedJson(raw: string): unknown | null {
  const decoded = cheerio.load(`<textarea>${raw}</textarea>`)('textarea').text();
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function parsePageData(html: string): Record<string, unknown> | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  const targeted = $('script#page-data').first().html();
  if (targeted) {
    const parsed = decodeEmbeddedJson(targeted);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  }
  let found: Record<string, unknown> | null = null;
  $('script[type="application/json"]').each((_i, el) => {
    if (found) return;
    const raw = $(el).html() || '';
    if (!raw.includes('mainComponents')) return;
    const parsed = decodeEmbeddedJson(raw);
    if (parsed && typeof parsed === 'object') found = parsed as Record<string, unknown>;
  });
  return found;
}

function mainComponentsOf(pageData: Record<string, unknown> | null): Record<string, unknown>[] {
  const components = pageData?.mainComponents;
  return Array.isArray(components) ? (components as Record<string, unknown>[]) : [];
}

function profileSlugFromUrl(url: string): string {
  return url.match(/\/profile\/([^/]+)\/?$/i)?.[1]?.toLowerCase() || '';
}

function nameFromDirectoryText(text: string): string {
  const [last, first] = text.split(',').map((part) => part.trim());
  if (last && first) return `${first} ${last}`;
  return text.trim();
}

function htmlToText(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  return cheerio
    .load(raw)
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}

function clippedText(value: string, minChars = 40, maxChars = 2000): string | undefined {
  if (value.length < minChars) return undefined;
  return value.slice(0, maxChars);
}

function isHttpUrl(value: unknown): boolean {
  const raw = textValue(value);
  if (!raw) return false;
  try {
    return /^https?:$/i.test(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/**
 * Parse the school-wide A-Z directory into {name, profileUrl, slug} rows. The
 * full model.items payload is embedded in the single directory page (no
 * pagination): every category letter's roster is a crawl SEED only, never
 * cited as a source. External links and non-`/profile/` entries are dropped.
 */
export function parseYsmFacultyDirectory(html: string): RawYsmFaculty[] {
  const pageData = parsePageData(html);
  const listing = mainComponentsOf(pageData).find((component) => component.key === 'PeopleAzList');
  const model = (listing?.model || {}) as Record<string, unknown>;
  const categories = Array.isArray(model.items) ? model.items : [];

  const bySlug = new Map<string, RawYsmFaculty>();
  for (const category of categories) {
    const items = Array.isArray((category as Record<string, unknown>)?.items)
      ? ((category as Record<string, unknown>).items as Record<string, unknown>[])
      : [];
    for (const item of items) {
      if (item.isExternal) continue;
      const profileUrl = normalizeYsmProfileUrl(textValue(item.url), DIRECTORY_URL);
      if (!profileUrl) continue;
      const slug = profileSlugFromUrl(profileUrl);
      if (!slug || bySlug.has(slug)) continue;
      const rawText = textValue(item.text);
      bySlug.set(slug, { name: nameFromDirectoryText(rawText) || rawText, profileUrl, slug });
    }
  }
  return Array.from(bySlug.values());
}

function departmentsFromAboutSection(about: Record<string, unknown>): string[] {
  const appointments = Array.isArray(about.appointments)
    ? (about.appointments as Record<string, unknown>[])
    : [];
  const organizations = Array.isArray(about.organizations)
    ? (about.organizations as Record<string, unknown>[])
    : [];
  const primary = appointments
    .filter((a) => textValue(a.type) === 'Primary')
    .map((a) => textValue(a.organizationName));
  const secondary = appointments
    .filter((a) => textValue(a.type) !== 'Primary')
    .map((a) => textValue(a.organizationName));
  const orgNames = organizations.map((o) => textValue(o.name));
  return uniqueStrings([...primary, ...secondary, ...orgNames]).slice(0, MAX_DEPARTMENTS);
}

function extractPersonEmail(rawEmail: unknown, name: string): string | undefined {
  const email = textValue(rawEmail).toLowerCase();
  if (!email || !isLikelyPersonSpecificYaleEmail(email, name)) return undefined;
  return email;
}

function extractOrcid(research: Record<string, unknown>): string | undefined {
  const entries = Array.isArray(research.orcids)
    ? (research.orcids as Record<string, unknown>[])
    : [];
  for (const entry of entries) {
    const normalized = normalizeOrcid(textValue(entry.url) || textValue(entry.text));
    if (normalized) return normalized;
  }
  return undefined;
}

function extractLabWebsite(
  research: Record<string, unknown>,
  about: Record<string, unknown>,
): { url?: string; name?: string } {
  const raw = (research.labWebsite || about.labWebsite) as Record<string, unknown> | null;
  const url = raw && isHttpUrl(raw.url) ? textValue(raw.url) : undefined;
  return { url, name: url ? textValue(raw?.name) || undefined : undefined };
}

/**
 * Parse an individual profile page's `ProfileDetails` component into a
 * researcher-shaped record. Returns null when the page carries no
 * `ProfileDetails` component (a malformed/removed profile).
 */
export function extractProfile(html: string, faculty: RawYsmFaculty): YsmFacultyProfile | null {
  const pageData = parsePageData(html);
  const profileDetails = mainComponentsOf(pageData).find(
    (component) => component.key === 'ProfileDetails',
  );
  if (!profileDetails) return null;
  const model = (profileDetails.model || {}) as Record<string, unknown>;
  const name = textValue(model.fullName) || faculty.name;
  const sections = Array.isArray(model.sections)
    ? (model.sections as Record<string, unknown>[])
    : [];
  const about = (sections.find((s) => s.sectionType === 'about') || {}) as Record<string, unknown>;
  const research = (sections.find((s) => s.sectionType === 'research') || {}) as Record<
    string,
    unknown
  >;
  const getInTouch = (sections.find((s) => s.sectionType === 'getInTouch') || {}) as Record<
    string,
    unknown
  >;

  const meshKeywords = Array.isArray(research.meshKeywords)
    ? (research.meshKeywords as Record<string, unknown>[])
    : [];
  const researchAreas = uniqueStrings(meshKeywords.map((k) => k.name)).slice(
    0,
    MAX_RESEARCH_AREAS,
  );
  const labWebsite = extractLabWebsite(research, about);

  return {
    name,
    profileUrl: faculty.profileUrl,
    slug: faculty.slug,
    title: textValue(about.workdayTitle) || undefined,
    email: extractPersonEmail(getInTouch.email, name),
    orcid: extractOrcid(research),
    departments: departmentsFromAboutSection(about),
    researchAreas,
    description: clippedText(htmlToText(research.researchDescription)),
    bio: clippedText(htmlToText(about.bio)),
    labUrl: labWebsite.url,
    labName: labWebsite.name,
  };
}

/**
 * User (Researcher) observations. Identity keys on netid when derivable from a
 * person-specific @yale.edu email, otherwise on a synthetic ysm:<slug> key.
 * Every observation is sourced to the individual profile page, never the
 * directory root.
 */
export function facultyToUserObservations(profile: YsmFacultyProfile): {
  observations: ObservationInput[];
  entityKey: string;
} {
  const { first, last } = splitName(profile.name);
  const netid = netidFromEmail(profile.email);
  const entityKey = netid ? `netid:${netid}` : `ysm:${profile.slug}`;
  const base = { entityType: 'user' as const, entityKey, sourceUrl: profile.profileUrl };
  const obs: ObservationInput[] = [];

  if (netid) obs.push({ ...base, field: 'netid', value: netid });
  if (first) obs.push({ ...base, field: 'fname', value: first });
  if (last) obs.push({ ...base, field: 'lname', value: last });
  obs.push({ ...base, field: 'userType', value: classifyUserType(profile.title) });
  if (profile.departments.length > 0) {
    obs.push({ ...base, field: 'primaryDepartment', value: profile.departments[0] });
    obs.push({ ...base, field: 'departments', value: profile.departments });
  }
  if (profile.email) obs.push({ ...base, field: 'email', value: profile.email });
  if (profile.title) obs.push({ ...base, field: 'title', value: profile.title });
  obs.push({
    ...base,
    field: 'profileUrls',
    value: { medicine: profile.profileUrl, official: profile.profileUrl },
  });
  if (profile.orcid) obs.push({ ...base, field: 'orcid', value: profile.orcid });
  if (profile.bio) obs.push({ ...base, field: 'bio', value: profile.bio });
  if (profile.researchAreas.length > 0) {
    obs.push({ ...base, field: 'researchInterests', value: profile.researchAreas });
    obs.push({ ...base, field: 'topics', value: profile.researchAreas });
  }
  obs.push({ ...base, field: 'dataSources', value: [SOURCE_KEY] });

  return { observations: obs, entityKey };
}

/**
 * ResearchEntity observations. A profile whose own research section links a
 * lab website seeds a LAB home with that site as the websiteUrl; otherwise a
 * profile with governed research areas seeds a FACULTY_RESEARCH_AREA home
 * whose only cited source is the profile page. Returns [] for a profile with
 * neither so nothing empty is minted.
 *
 * The lead PI is keyed on the person-specific email when present, mirroring
 * yseFacultyDirectoryScraper: identity here comes from the person's own
 * profile, not a name search against the User collection, so this never risks
 * the surname-collision failure mode fixed in #562/#579.
 */
export function facultyToResearchEntityObservations(
  profile: YsmFacultyProfile,
  fallbackUserKey: string,
): ObservationInput[] {
  const hasLab = Boolean(profile.labUrl);
  if (!hasLab && profile.researchAreas.length === 0) return [];

  const slug = `ysm-faculty-${profile.slug}`.slice(0, 100);
  const entityName = hasLab
    ? profile.labName || `${profile.name} Lab`
    : `${profile.name} Faculty Research`;
  const sourceUrls = hasLab ? [profile.profileUrl, profile.labUrl!] : [profile.profileUrl];
  const piUserKey = profile.email || fallbackUserKey;
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
    { ...base, field: 'sourceUrls', value: sourceUrls },
    {
      ...base,
      field: 'inferredPiUserKey',
      value: piUserKey,
      confidenceOverride: INFERRED_PI_CONFIDENCE,
    },
  ];

  if (profile.departments.length > 0) {
    obs.push({ ...base, field: 'departments', value: profile.departments });
  }
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

function matchesOnlyFilter(faculty: RawYsmFaculty, only: string[]): boolean {
  const normalized = new Set(
    [faculty.slug, faculty.name, faculty.profileUrl].map((value) => value.toLowerCase().trim()),
  );
  return only.some((value) => normalized.has(value.toLowerCase().trim()));
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

export class YsmFacultyDirectoryScraper implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'YSM faculty directory and individual profiles';

  constructor(private readonly htmlFetcher: HtmlFetcher = fetchHtml) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const offsetOption = ctx.options.offset;
    if (offsetOption !== undefined && (!Number.isSafeInteger(offsetOption) || offsetOption < 0)) {
      throw new Error('--offset must be a safe non-negative integer');
    }

    ctx.log(`Fetching ${DIRECTORY_URL}`);
    const directoryHtml = await this.htmlFetcher(DIRECTORY_URL, ctx.options.useCache);
    const roster = parseYsmFacultyDirectory(directoryHtml);
    ctx.log(`Parsed ${roster.length} faculty-directory entries`);

    const only = ctx.options.only || [];
    const selected = only.length ? roster.filter((r) => matchesOnlyFilter(r, only)) : roster;
    const offset = offsetOption && offsetOption > 0 ? offsetOption : 0;
    const offsetRoster = offset > 0 ? selected.slice(offset) : selected;
    const limited = limitOption ? offsetRoster.slice(0, limitOption) : offsetRoster;

    let totalObs = 0;
    let profilesScanned = 0;
    let researchersEnriched = 0;
    let entityCount = 0;
    let labCount = 0;
    let areaCount = 0;

    for (const faculty of limited) {
      profilesScanned += 1;
      let profileHtml: string;
      try {
        profileHtml = await this.htmlFetcher(faculty.profileUrl, ctx.options.useCache);
      } catch (err) {
        ctx.log(`[${faculty.slug}] profile fetch failed: ${sanitizeLogValue(err)}`);
        continue;
      }

      const profile = extractProfile(profileHtml, faculty);
      if (!profile) continue;
      if (looksLikeNonResearchTitle(profile.title)) continue;
      if (!profile.labUrl && profile.researchAreas.length === 0) continue;

      researchersEnriched += 1;
      const { observations: userObs, entityKey } = facultyToUserObservations(profile);
      await ctx.emit(userObs);
      totalObs += userObs.length;

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
      `Emitted ${totalObs} observations across ${researchersEnriched} researchers / ${entityCount} entities ` +
        `(${labCount} with lab sites, ${areaCount} with research areas) of ${profilesScanned} profiles scanned`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: researchersEnriched + entityCount,
      notes:
        `YSM faculty directory: ${researchersEnriched} researchers with research content, ` +
        `${entityCount} research homes (${labCount} labs, ${areaCount} with areas) of ${profilesScanned} profiles scanned`,
    };
  }
}
