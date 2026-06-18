/**
 * YsmAtoZScraper
 *
 * Scrapes Yale School of Medicine's centralized A-to-Z lab websites index:
 * https://medicine.yale.edu/about/a-to-z-index/lab-websites/
 *
 * The page is a single HTML table with ~266 rows, each `<tr>` containing a lab name
 * (link) and the lab website URL. No PI names are shown directly; we infer the PI
 * surname from the lab name ("Arnsten Lab" -> "Arnsten") and try to match it against
 * existing Yale faculty Users.
 *
 * Each row produces ResearchGroup observations keyed by slug (derived from the URL or
 * from the lab name). The slug is the unique identifier `EntityMaterializer` uses to
 * upsert the ResearchGroup.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { User } from '../../models/user';
import { serializedDocumentId } from '../../utils/idSerialization';
import { deriveShortDescriptionFromFullDescription } from '../../utils/researchEntityDescriptionQuality';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import {
  isLikelyPersonSpecificYaleEmail,
  netidFromEmail,
} from '../utils/scraperHelpers';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';

const PAGE_URL = 'https://medicine.yale.edu/about/a-to-z-index/lab-websites/';

interface RawLab {
  name: string;
  url: string;
  slug: string;
}

interface LabHomepageDescription {
  description: string;
  shortDescription: string;
}

interface ResearchFacultyProfile {
  name: string;
  profileUrl: string;
  title: string;
  email?: string;
}

interface PiNameHint {
  firstName: string;
  lastName: string;
}

function slugifyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/lab\/([^/]+)/i);
    if (m && m[1]) return `ysm-${m[1].toLowerCase()}`;
  } catch {
    /* ignore malformed URLs */
  }
  return null;
}

function slugifyFromName(name: string): string {
  return (
    'ysm-' +
    name
      .toLowerCase()
      .replace(/['']s\b/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
  );
}

function inferPiSurname(name: string): string | null {
  const trimmed = name.trim();
  const stripped = trimmed.replace(/['']s\b/g, '');
  const tokens = stripped.split(/\s+/);
  const labIdx = tokens.findIndex((t) => /^lab(oratory)?$/i.test(t));
  if (labIdx > 0) {
    const candidate = tokens[labIdx - 1];
    if (/^[A-Z][a-zA-Z-]+$/.test(candidate)) return candidate;
    return tokens.slice(0, labIdx).pop() || null;
  }
  if (tokens.length > 0 && /^[A-Z][a-zA-Z-]+$/.test(tokens[0])) {
    return tokens[0];
  }
  return null;
}

export function inferPiNameFromLabName(name: string): PiNameHint | null {
  const trimmed = name.trim().replace(/['']s\b/g, '');
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const labIdx = tokens.findIndex((t) => /^lab(oratory)?$/i.test(t));
  if (labIdx <= 0) {
    const surname = inferPiSurname(name);
    return surname ? { firstName: '', lastName: surname } : null;
  }

  const nameTokens = tokens.slice(0, labIdx);
  const lastName = nameTokens[nameTokens.length - 1] || '';
  if (!/^[A-Z][a-zA-Z-]+$/.test(lastName)) return null;
  return {
    firstName: nameTokens.slice(0, -1).join(' '),
    lastName,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchPage(useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(PAGE_URL);
  const agents = ssrfSafeAgents();
  if (useCache) {
    const cached = await getCached<string>('ysm-atoz-index', 'page');
    if (cached) return cached;
  }
  const res = await axios.get(safeUrl.toString(), {
    timeout: 30000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = res.data as string;
  if (useCache) await setCached('ysm-atoz-index', 'page', html);
  return html;
}

async function fetchLabHomepage(url: string, useCache: boolean): Promise<string | null> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `lab-homepage:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>('ysm-atoz-index', cacheKey);
    if (cached) return cached;
  }

  try {
    const agents = ssrfSafeAgents();
    const res = await axios.get(safeUrlText, {
      timeout: 30000,
      headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
      maxRedirects: 5,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    });
    const html = res.data as string;
    if (useCache) await setCached('ysm-atoz-index', cacheKey, html);
    return html;
  } catch {
    return null;
  }
}

function absoluteUrl(href: string, baseUrl: string): string {
  try {
    const url = new URL(href, baseUrl);
    const profileMatch = url.pathname.match(/\/profile\/([^/]+)\/?/i);
    if (profileMatch?.[1]) {
      return `${url.origin}/profile/${profileMatch[1]}/`;
    }
    return url.toString();
  } catch {
    return '';
  }
}

function decodeHtmlEntities(value: string): string {
  return cheerio.load(`<textarea>${value}</textarea>`)('textarea').text();
}

function plainTextFromHtml(value: string): string {
  return cheerio.load(value).text().replace(/\s+/g, ' ').trim();
}

function cleanDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  return plainTextFromHtml(value).replace(/\s+/g, ' ').trim();
}

function cleanProfileTitle(value: string): string {
  const normalized = value.replace(/View\s*Full\s*Profile/i, '').replace(/\s+/g, ' ').trim();
  const parts = normalized
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (unique.some((existing) => existing.toLowerCase() === part.toLowerCase())) continue;
    if (unique.some((existing) => existing.toLowerCase().includes(part.toLowerCase()))) continue;
    if (unique.some((existing) => part.toLowerCase().includes(existing.toLowerCase()))) {
      const index = unique.findIndex((existing) => part.toLowerCase().includes(existing.toLowerCase()));
      unique[index] = part;
      continue;
    }
    unique.push(part);
  }
  return unique.join('; ');
}

function parsePageDataPayloads(html: string): any[] {
  const $ = cheerio.load(html);
  const payloads: any[] = [];
  $('script').each((_i, el) => {
    const raw = $(el).html() || '';
    if (!raw.includes('ProfileContactWidget') && !raw.includes('mainComponents')) return;
    try {
      payloads.push(JSON.parse(decodeHtmlEntities(raw)));
    } catch {
      /* Ignore non-JSON scripts. */
    }
  });
  return payloads;
}

function clippedDescription(value: string, maxChars = 280): string {
  if (value.length <= maxChars) return value;
  const clipped = value.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
  return clipped || value.slice(0, maxChars).trim();
}

export function extractLabHomepageDescription(html: string): LabHomepageDescription | null {
  const $ = cheerio.load(html);
  const pageData = parsePageDataPayloads(html).find(
    (payload) => Array.isArray(payload?.mainComponents) && JSON.stringify(payload).includes('metaData'),
  );

  if (pageData) {
    try {
      const components = Array.isArray(pageData?.mainComponents) ? pageData.mainComponents : [];
      const descriptions = components
        .map((component: any) => cleanDescription(component?.model?.metaData?.description))
        .filter((description: string) => description.length >= 120);
      const firstParagraph = components
        .flatMap((component: any) =>
          Array.isArray(component?.model?.paragraphs) ? component.model.paragraphs : [],
        )
        .map((paragraph: any) => cleanDescription(paragraph?.text))
        .find((description: string) => description.length >= 120);

      const description = descriptions[0] || firstParagraph || '';
      if (description) {
        return {
          description,
          shortDescription: deriveShortDescriptionFromFullDescription(description) || clippedDescription(description),
        };
      }
    } catch {
      /* Fall back to meta tags below. */
    }
  }

  const metaDescription = cleanDescription(
    $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content'),
  );
  if (metaDescription.length >= 120) {
    return {
      description: metaDescription,
      shortDescription:
        deriveShortDescriptionFromFullDescription(metaDescription) || clippedDescription(metaDescription),
    };
  }

  return null;
}

export function extractResearchFacultyUrl(html: string, baseUrl: string): string {
  const $ = cheerio.load(html);
  const link = $('a')
    .toArray()
    .map((el) => ({
      label: $(el).text().replace(/\s+/g, ' ').trim(),
      href: $(el).attr('href') || '',
    }))
    .find((item) => /^Research Faculty$/i.test(item.label) && item.href);
  return link ? absoluteUrl(link.href, baseUrl) : '';
}

export function extractProfileContactWidgetProfile(
  html: string,
  baseUrl: string,
): ResearchFacultyProfile | null {
  const profiles = parsePageDataPayloads(html)
    .flatMap((pageData) => [
      ...(Array.isArray(pageData?.sidebarComponents) ? pageData.sidebarComponents : []),
      ...(Array.isArray(pageData?.mainComponents) ? pageData.mainComponents : []),
    ])
    .filter((component: any) => component?.key === 'ProfileContactWidget')
    .map((component: any) => {
      const profile = component?.model?.profile || {};
      const name = cleanDescription(profile.fullName || profile.name);
      const profileUrl = absoluteUrl(String(profile.profileUrl || ''), baseUrl);
      const title = cleanProfileTitle(cleanDescription(profile.title || component?.model?.title || ''));
      const email = profileContactWidgetEmail(profile);
      if (!name || !profileUrl) return null;
      return { name, profileUrl, title, ...(email ? { email } : {}) };
    })
    .filter(Boolean) as ResearchFacultyProfile[];

  const byUrl = new Map<string, ResearchFacultyProfile>();
  for (const profile of profiles) {
    byUrl.set(profile.profileUrl, profile);
  }
  const uniqueProfiles = Array.from(byUrl.values());
  return uniqueProfiles.length === 1 ? uniqueProfiles[0] : null;
}

function profileContactWidgetEmail(profile: any): string {
  const contact = profile?.generalContacts;
  const value =
    typeof contact?.email === 'string'
      ? contact.email
      : Array.isArray(contact)
        ? contact.find((item) => typeof item?.email === 'string')?.email
        : '';
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '');
}

function nameHintFromProfileName(name: string): PiNameHint | null {
  const cleaned = name
    .split(',')
    .at(0)
    ?.replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const lastName = tokens.at(-1) || '';
  if (!/^[A-Z][\p{L}'’-]+$/u.test(lastName)) return null;
  return {
    firstName: tokens.slice(0, -1).join(' '),
    lastName,
  };
}

export function extractSoleResearchFacultyProfile(
  html: string,
  baseUrl: string,
): ResearchFacultyProfile | null {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, string>();

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    if (!/(?:^|\/)profile\//i.test(href)) return;
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!label || /^View Full Profile$/i.test(label)) return;
    const profileUrl = absoluteUrl(href, baseUrl);
    if (!profileUrl) return;
    const containerText = $(el)
      .closest('li')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const title = containerText
      .replace(label, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cleanedTitle = cleanProfileTitle(title);
    byUrl.set(profileUrl, JSON.stringify({ name: label, title: cleanedTitle }));
  });

  const profiles = Array.from(byUrl.entries()).map(([profileUrl, payload]) => ({
    profileUrl,
    ...JSON.parse(payload),
  }));
  return profiles.length === 1 ? profiles[0] : null;
}

function parseLabs(html: string): RawLab[] {
  const $ = cheerio.load(html);
  const labs: RawLab[] = [];

  $('table tr').each((_i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 1) return;

    const linkEl = cells.eq(0).find('a').first();
    let name = linkEl.text().trim();
    let url = linkEl.attr('href') || '';

    if (!name) {
      name = cells.eq(0).text().trim();
    }
    if (!url && cells.length > 1) {
      const altLink = cells.eq(1).find('a').first();
      url = altLink.attr('href') || cells.eq(1).text().trim();
    }

    if (!name || !url) return;
    if (!/^https?:\/\//i.test(url)) return;

    const slug = slugifyFromUrl(url) || slugifyFromName(name);
    labs.push({ name, url, slug });
  });

  return labs;
}

async function findPiUserId(nameHint: PiNameHint | null): Promise<string | null> {
  if (!nameHint?.lastName) return null;
  const baseQuery: Record<string, unknown> = {
    lname: new RegExp(`^${escapeRegex(nameHint.lastName)}$`, 'i'),
    userType: { $in: ['professor', 'faculty'] },
  };
  const query =
    nameHint.firstName.trim().length > 0
      ? {
          ...baseQuery,
          fname: new RegExp(`^${escapeRegex(nameHint.firstName.trim())}$`, 'i'),
        }
      : baseQuery;
  const matches = await User.find(query, { _id: 1, fname: 1, lname: 1, primaryDepartment: 1 })
    .limit(5)
    .lean();
  if (matches.length === 0 && nameHint.firstName.trim().length > 0) {
    return findPiUserId({ firstName: '', lastName: nameHint.lastName });
  }
  if (matches.length !== 1) return null;
  const m: any = matches[0];
  if (m.primaryDepartment && /medicine|health|nursing|public health/i.test(m.primaryDepartment)) {
    return serializedDocumentId(m._id) || null;
  }
  return serializedDocumentId(m._id) || null;
}

export function labToObservations(lab: RawLab, sourceUrl: string): ObservationInput[] {
  const base = { entityType: 'researchEntity' as const, entityKey: lab.slug, sourceUrl };
  return [
    { ...base, field: 'slug', value: lab.slug },
    { ...base, field: 'name', value: lab.name },
    { ...base, field: 'kind', value: 'lab' },
    { ...base, field: 'school', value: 'Yale School of Medicine' },
    { ...base, field: 'websiteUrl', value: lab.url },
    { ...base, field: 'sourceUrls', value: [sourceUrl, lab.url] },
    { ...base, field: 'openness', value: 'open' },
  ];
}

function labDescriptionToObservations(
  lab: RawLab,
  description: LabHomepageDescription | null,
): ObservationInput[] {
  if (!description) return [];
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: lab.slug,
    sourceUrl: lab.url,
    confidenceOverride: 0.92,
  };
  return [
    { ...base, field: 'displayName', value: lab.name },
    { ...base, field: 'entityType', value: 'LAB' },
    { ...base, field: 'description', value: description.description },
    { ...base, field: 'fullDescription', value: description.description },
    { ...base, field: 'shortDescription', value: description.shortDescription },
  ];
}

export function labResearchFacultyToObservations(
  lab: RawLab,
  profile: ResearchFacultyProfile | null,
  sourceUrl: string,
): ObservationInput[] {
  if (!profile) return [];
  const nameHint = nameHintFromProfileName(profile.name);
  if (!nameHint) return [];
  const memberSlug = slugifyFromName(profile.name).replace(/^ysm-/, '');
  const base = {
    entityType: 'researchGroupMember' as const,
    entityKey: `${lab.slug}:research-faculty:${memberSlug}`,
    sourceUrl,
    confidenceOverride: 0.78,
  };
  const observations: ObservationInput[] = [
    { ...base, field: 'researchGroupKey', value: lab.slug },
    { ...base, field: 'role', value: 'director' },
    { ...base, field: 'name', value: profile.name },
    { ...base, field: 'inferredUserName', value: { fname: nameHint.firstName, lname: nameHint.lastName } },
    { ...base, field: 'profileUrl', value: profile.profileUrl },
  ];
  if (profile.title) observations.push({ ...base, field: 'title', value: profile.title });
  const userObservations = profileContactWidgetUserObservations(profile, nameHint);
  observations.push(...userObservations.observations);
  if (userObservations.entityKey) {
    const contactBase = {
      entityType: 'researchEntity' as const,
      entityKey: lab.slug,
      sourceUrl: profile.profileUrl || sourceUrl,
      confidenceOverride: 0.86,
    };
    observations.push(
      { ...contactBase, field: 'contactName', value: profile.name },
      { ...contactBase, field: 'contactRole', value: profile.title || 'Faculty PI or director' },
      { ...contactBase, field: 'contactEmail', value: profile.email },
    );
    observations.push({
      entityType: 'researchEntity',
      entityKey: lab.slug,
      sourceUrl: profile.profileUrl || sourceUrl,
      field: 'inferredPiUserKey',
      value: userObservations.entityKey,
      confidenceOverride: 0.86,
    });
  }
  return observations;
}

function profileContactWidgetUserObservations(
  profile: ResearchFacultyProfile,
  nameHint: PiNameHint,
): { entityKey?: string; observations: ObservationInput[] } {
  if (!profile.email || !isLikelyPersonSpecificYaleEmail(profile.email, profile.name)) {
    return { observations: [] };
  }
  if (!/^https:\/\/medicine\.yale\.edu\/profile\//i.test(profile.profileUrl)) {
    return { observations: [] };
  }
  const netid = netidFromEmail(profile.email);
  if (!netid || !nameHint.firstName || !nameHint.lastName) return { observations: [] };
  const entityKey = `netid:${netid}`;
  const base = {
    entityType: 'user' as const,
    entityKey,
    sourceUrl: profile.profileUrl,
    confidenceOverride: 0.9,
  };
  const observations: ObservationInput[] = [
    { ...base, field: 'netid', value: netid },
    { ...base, field: 'fname', value: nameHint.firstName },
    { ...base, field: 'lname', value: nameHint.lastName },
    { ...base, field: 'email', value: profile.email },
    { ...base, field: 'userType', value: 'faculty' },
    { ...base, field: 'profileVerified', value: true },
    {
      ...base,
      field: 'profileUrls',
      value: {
        medicine: profile.profileUrl,
        official: profile.profileUrl,
      },
    },
    { ...base, field: 'dataSources', value: ['ysm-atoz-index'] },
  ];
  if (profile.title) observations.push({ ...base, field: 'title', value: profile.title });
  return { entityKey, observations };
}

function matchesOnlyFilter(lab: RawLab, only: string[]): boolean {
  if (only.length === 0) return true;
  const normalized = new Set(
    [
      lab.slug,
      lab.slug.replace(/^ysm-/, ''),
      lab.name,
      lab.url,
      (() => {
        try {
          const url = new URL(lab.url);
          return url.pathname.replace(/^\/+|\/+$/g, '').split('/').pop() || '';
        } catch {
          return '';
        }
      })(),
    ]
      .map((value) => value.toLowerCase().trim())
      .filter(Boolean),
  );
  return only.some((value) => normalized.has(value.toLowerCase().trim()));
}

export class YsmAtoZScraper implements IScraper {
  readonly name = 'ysm-atoz-index';
  readonly displayName = 'YSM A-to-Z Lab Websites';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const offsetOption = ctx.options.offset;
    if (offsetOption !== undefined && (!Number.isSafeInteger(offsetOption) || offsetOption < 0)) {
      throw new Error('--offset must be a safe non-negative integer');
    }
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    ctx.log(`Fetching ${PAGE_URL}`);
    const html = await fetchPage(ctx.options.useCache);
    const labs = parseLabs(html);
    ctx.log(`Parsed ${labs.length} labs from index`);

    const only = ctx.options.only || [];
    const selected = labs.filter((lab) => matchesOnlyFilter(lab, only));
    const offset = offsetOption && offsetOption > 0 ? offsetOption : 0;
    const offsetLabs = offset > 0 ? selected.slice(offset) : selected;
    const limited =
      limitOption && limitOption > 0
        ? offsetLabs.slice(0, limitOption)
        : offsetLabs;

    // Direct-URL, PI-only mode: `--only <full lab URL>` values for labs that are
    // no longer in the A-Z index (but still live at medicine.yale.edu/lab/<slug>/)
    // are processed directly. These emit ONLY the PI/member observations so an
    // existing entity's name/description/website are never overwritten — the goal
    // is purely to attach the missing lead from the live page.
    const selectedSlugs = new Set(limited.map((lab) => lab.slug));
    const directLabs: RawLab[] = only
      .filter((value) => /^https?:\/\/[^\s]*\/lab\//i.test(value))
      .map((url) => {
        const slug = slugifyFromUrl(url);
        if (!slug || selectedSlugs.has(slug)) return null;
        const name = slug.replace(/^ysm-/, '').replace(/-/g, ' ').trim();
        return { slug, name, url } as RawLab;
      })
      .filter((lab): lab is RawLab => lab !== null);

    const work: Array<{ lab: RawLab; piOnly: boolean }> = [
      ...limited.map((lab) => ({ lab, piOnly: false })),
      ...directLabs.map((lab) => ({ lab, piOnly: true })),
    ];

    let totalObs = 0;
    let piMatched = 0;
    let descriptionsFound = 0;

    for (const { lab, piOnly } of work) {
      const observations = piOnly ? [] : labToObservations(lab, PAGE_URL);
      const homepageHtml = await fetchLabHomepage(lab.url, ctx.options.useCache);
      if (!piOnly) {
        const homepageDescription = homepageHtml ? extractLabHomepageDescription(homepageHtml) : null;
        observations.push(...labDescriptionToObservations(lab, homepageDescription));
        if (homepageDescription) descriptionsFound++;
      }
      let piSourceUrl = PAGE_URL;
      let piUserId = await findPiUserId(inferPiNameFromLabName(lab.name));
      if (!piUserId && homepageHtml) {
        const researchFacultyUrl = extractResearchFacultyUrl(homepageHtml, lab.url);
        const researchFacultyHtml = researchFacultyUrl
          ? await fetchLabHomepage(researchFacultyUrl, ctx.options.useCache)
          : null;
        const researchFacultyProfile = researchFacultyHtml
          ? extractSoleResearchFacultyProfile(researchFacultyHtml, researchFacultyUrl)
          : null;
        observations.push(
          ...labResearchFacultyToObservations(lab, researchFacultyProfile, researchFacultyUrl),
        );
        piUserId = await findPiUserId(nameHintFromProfileName(researchFacultyProfile?.name || ''));
        if (piUserId) piSourceUrl = researchFacultyProfile?.profileUrl || researchFacultyUrl || piSourceUrl;
      }
      if (!piUserId && homepageHtml) {
        const contactWidgetProfile = extractProfileContactWidgetProfile(homepageHtml, lab.url);
        observations.push(
          ...labResearchFacultyToObservations(lab, contactWidgetProfile, lab.url),
        );
        piUserId = await findPiUserId(nameHintFromProfileName(contactWidgetProfile?.name || ''));
        if (piUserId) piSourceUrl = contactWidgetProfile?.profileUrl || lab.url;
      }
      if (piUserId) {
        observations.push({
          entityType: 'researchEntity',
          entityKey: lab.slug,
          field: 'inferredPiUserId',
          value: piUserId,
          sourceUrl: piSourceUrl,
          confidenceOverride: piSourceUrl === PAGE_URL ? 0.5 : 0.78,
        });
        piMatched++;
      }
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    ctx.log(`Emitted ${totalObs} observations across ${work.length} labs`);
    ctx.log(`Inferred PI for ${piMatched}/${work.length} labs`);
    ctx.log(`Found official homepage descriptions for ${descriptionsFound}/${work.length} labs`);

    return {
      observationCount: totalObs,
      entitiesObserved: work.length,
      notes: `Discovered ${work.length} YSM labs (${piMatched} with inferred PI, ${descriptionsFound} with official descriptions)`,
    };
  }
}
