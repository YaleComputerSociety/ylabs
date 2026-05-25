/**
 * YsmAtoZScraper
 *
 * Scrapes Yale School of Medicine's centralized A-to-Z lab websites index:
 * https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/
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
import { isGenericResearchWebsiteIndexUrl } from '../../utils/researchWebsiteUrl';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';

const PAGE_URL = 'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/';

interface RawLab {
  name: string;
  url: string;
  slug: string;
  departments?: string[];
  principalInvestigators?: PrincipalInvestigatorProfile[];
}

export type FacultyUserCandidate = {
  _id?: unknown;
  netid?: string | null;
  fname?: string | null;
  lname?: string | null;
  primaryDepartment?: string | null;
  email?: string | null;
  profileUrls?: Record<string, string> | null;
};

export type PrincipalInvestigatorProfile = {
  fullName: string;
  profileUrl?: string;
  email?: string;
};

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

function isClearlyContentPageLabIndexRow(name: string, url: string): boolean {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();

  if (path === '/about/a-to-z-index/atoz/lab-websites/') return true;
  if (/\b(blog|news|event|events|calendar|newsletter|article|story|press release|podcast|video|webinar)\b/.test(normalizedName)) {
    return true;
  }
  return /(^|[-/])(blog|blogs|news|events|calendar|newsletter|article|stories|press|podcast|video|webinar)([-/]|$)/.test(path);
}

function inferPiSurname(name: string): string | null {
  const trimmed = name.trim();
  const stripped = trimmed.replace(/['']s\b/g, '');
  const tokens = stripped.split(/\s+/);
  const labIdx = tokens.findIndex((t) => /^lab(oratory)?$/i.test(t));
  if (labIdx > 0) {
    const candidate = tokens[labIdx - 1];
    if (/^[A-Z][a-zA-Z\-]+$/.test(candidate)) return candidate;
    return tokens.slice(0, labIdx).pop() || null;
  }
  if (tokens.length > 0 && /^[A-Z][a-zA-Z\-]+$/.test(tokens[0])) {
    return tokens[0];
  }
  return null;
}

function compactNameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function profileUrlValues(candidate: FacultyUserCandidate): string[] {
  const values = candidate.profileUrls ? Object.values(candidate.profileUrls) : [];
  return values.map((value) => String(value || '')).filter(Boolean);
}

function normalizeUrlForDedupe(value: string | undefined): string {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

function profilePathKey(value: string | undefined): string {
  if (!value) return '';
  try {
    const u = new URL(value, 'https://medicine.yale.edu');
    const match = u.pathname.match(/\/profile\/([^/]+)/i);
    return match?.[1] ? compactNameKey(match[1]) : '';
  } catch {
    return '';
  }
}

function initialSurnameKey(candidate: FacultyUserCandidate): string {
  const firstInitial = (candidate.fname || '').trim().charAt(0).toLowerCase();
  const last = compactNameKey(candidate.lname || '');
  return firstInitial && last ? `${firstInitial}${last}` : '';
}

function findPiUserIdFromProfiles(
  profiles: PrincipalInvestigatorProfile[] | undefined,
  candidates: FacultyUserCandidate[],
): string | null {
  return findPiUserIdsFromProfiles(profiles, candidates)[0] || null;
}

function findPiUserIdsFromProfiles(
  profiles: PrincipalInvestigatorProfile[] | undefined,
  candidates: FacultyUserCandidate[],
): string[] {
  if (!profiles || profiles.length === 0) return [];

  const userIds: string[] = [];
  const seenUserIds = new Set<string>();
  for (const profile of profiles) {
    let userId: string | null = null;
    const email = (profile.email || '').trim().toLowerCase();
    if (email) {
      const matches = candidates.filter((candidate) => (candidate.email || '').toLowerCase() === email);
      if (matches.length === 1) userId = String(matches[0]._id);
    }

    const profileKey = profilePathKey(profile.profileUrl);
    if (!userId && profileKey) {
      const matches = candidates.filter((candidate) =>
        profileUrlValues(candidate).some((url) => profilePathKey(url) === profileKey),
      );
      if (matches.length === 1) userId = String(matches[0]._id);
    }

    const fullNameKey = compactNameKey(profile.fullName);
    if (!userId && fullNameKey) {
      const matches = candidates.filter(
        (candidate) => compactNameKey(`${candidate.fname || ''}${candidate.lname || ''}`) === fullNameKey,
      );
      if (matches.length === 1) userId = String(matches[0]._id);
    }

    if (userId && !seenUserIds.has(userId)) {
      seenUserIds.add(userId);
      userIds.push(userId);
    }
  }

  return userIds;
}

function findPiUserFromProfile(
  profile: PrincipalInvestigatorProfile,
  candidates: FacultyUserCandidate[],
): FacultyUserCandidate | null {
  const email = (profile.email || '').trim().toLowerCase();
  if (email) {
    const matches = candidates.filter((candidate) => (candidate.email || '').toLowerCase() === email);
    if (matches.length === 1) return matches[0];
  }

  const profileKey = profilePathKey(profile.profileUrl);
  if (profileKey) {
    const matches = candidates.filter((candidate) =>
      profileUrlValues(candidate).some((url) => profilePathKey(url) === profileKey),
    );
    if (matches.length === 1) return matches[0];
  }

  const fullNameKey = compactNameKey(profile.fullName);
  if (fullNameKey) {
    const matches = candidates.filter(
      (candidate) => compactNameKey(`${candidate.fname || ''}${candidate.lname || ''}`) === fullNameKey,
    );
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function nextProfileUrlKey(profileUrls: Record<string, string>): string {
  if (!profileUrls.official) return 'official';
  if (!profileUrls.ysmOfficial) return 'ysmOfficial';
  let index = 2;
  while (profileUrls[`ysmOfficial${index}`]) index++;
  return `ysmOfficial${index}`;
}

export function piProfileUserObservationsFromProfiles(
  profiles: PrincipalInvestigatorProfile[] | undefined,
  candidates: FacultyUserCandidate[],
  sourceUrl: string,
): ObservationInput[] {
  if (!profiles || profiles.length === 0) return [];

  const out: ObservationInput[] = [];
  const seenUserProfilePairs = new Set<string>();
  for (const profile of profiles) {
    const profileUrl = absolutizeUrl(profile.profileUrl, sourceUrl);
    if (!profileUrl || !/medicine\.yale\.edu\/(?:lab\/[^/]+\/)?profile\//i.test(profileUrl)) {
      continue;
    }

    const candidate = findPiUserFromProfile(profile, candidates);
    const netid = String(candidate?.netid || '').trim();
    if (!candidate || !netid) continue;

    const profileUrls = Object.fromEntries(
      Object.entries(candidate.profileUrls || {}).map(([key, value]) => [key, String(value || '')]),
    );
    const normalizedProfileUrl = normalizeUrlForDedupe(profileUrl);
    if (Object.values(profileUrls).some((url) => normalizeUrlForDedupe(url) === normalizedProfileUrl)) {
      continue;
    }

    const pairKey = `${netid}:${normalizedProfileUrl}`;
    if (seenUserProfilePairs.has(pairKey)) continue;
    seenUserProfilePairs.add(pairKey);

    out.push({
      entityType: 'user',
      entityKey: `netid:${netid}`,
      field: 'profileUrls',
      value: {
        ...profileUrls,
        [nextProfileUrlKey(profileUrls)]: profileUrl,
      },
      sourceUrl,
      confidenceOverride: 0.75,
    });
  }

  return out;
}

function addProfileUrlValue(profileUrls: Record<string, string>, preferredKey: string, rawUrl: unknown): void {
  const url = String(rawUrl || '').trim();
  if (!url) return;
  if (Object.values(profileUrls).some((existing) => normalizeUrlForDedupe(existing) === normalizeUrlForDedupe(url))) {
    return;
  }

  if (!profileUrls[preferredKey]) {
    profileUrls[preferredKey] = url;
    return;
  }
  profileUrls[nextProfileUrlKey(profileUrls)] = url;
}

export function mergeUserProfileUrlObservations(observations: ObservationInput[]): ObservationInput[] {
  const grouped = new Map<
    string,
    {
      base: ObservationInput;
      profileUrls: Record<string, string>;
    }
  >();

  for (const observation of observations) {
    if (observation.entityType !== 'user' || observation.field !== 'profileUrls' || !observation.entityKey) {
      continue;
    }
    if (!observation.value || typeof observation.value !== 'object' || Array.isArray(observation.value)) {
      continue;
    }

    const entityKey = String(observation.entityKey);
    let entry = grouped.get(entityKey);
    if (!entry) {
      entry = { base: observation, profileUrls: {} };
      grouped.set(entityKey, entry);
    }

    for (const [key, url] of Object.entries(observation.value as Record<string, unknown>)) {
      addProfileUrlValue(entry.profileUrls, key, url);
    }
  }

  return Array.from(grouped.values()).map(({ base, profileUrls }) => ({
    ...base,
    value: profileUrls,
  }));
}

export function piNameKeyFromLabUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/lab\/([^/]+)/i);
    const segment = match?.[1]?.toLowerCase();
    if (!segment) return null;
    if (/\d/.test(segment)) return null;
    if (/\b(lab|laboratory|center|centre|program|project|research|group|core)\b/i.test(segment)) {
      return null;
    }
    const key = compactNameKey(segment);
    return key.length >= 5 ? key : null;
  } catch {
    return null;
  }
}

export function findPiUserIdForLabFromCandidates(
  lab: RawLab,
  candidates: FacultyUserCandidate[],
): string | null {
  return findPiUserIdsForLabFromCandidates(lab, candidates)[0] || null;
}

export function findPiUserIdsForLabFromCandidates(
  lab: RawLab,
  candidates: FacultyUserCandidate[],
): string[] {
  const profileMatches = findPiUserIdsFromProfiles(lab.principalInvestigators, candidates);
  if (lab.principalInvestigators && lab.principalInvestigators.length > 0) {
    return profileMatches;
  }
  if (profileMatches.length > 0) return profileMatches;

  const urlNameKey = piNameKeyFromLabUrl(lab.url);
  if (urlNameKey) {
    const matches = candidates.filter(
      (candidate) => compactNameKey(`${candidate.fname || ''}${candidate.lname || ''}`) === urlNameKey,
    );
    if (matches.length === 1) return [String(matches[0]._id)];

    const initialSurnameMatches = candidates.filter(
      (candidate) => initialSurnameKey(candidate) === urlNameKey,
    );
    if (initialSurnameMatches.length === 1) return [String(initialSurnameMatches[0]._id)];
  }

  const surname = inferPiSurname(lab.name);
  if (!surname) return [];
  const surnameMatches = candidates.filter(
    (candidate) => (candidate.lname || '').toLowerCase() === surname.toLowerCase(),
  );
  if (surnameMatches.length !== 1) return [];
  return [String(surnameMatches[0]._id)];
}

async function fetchPage(useCache: boolean): Promise<string> {
  if (useCache) {
    const cached = await getCached<string>('ysm-atoz-index', 'page');
    if (cached) return cached;
  }
  const res = await axios.get(PAGE_URL, {
    timeout: 30000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
  });
  const html = res.data as string;
  if (useCache) await setCached('ysm-atoz-index', 'page', html);
  return html;
}

async function fetchLabPage(lab: RawLab, useCache: boolean): Promise<string | null> {
  if (useCache) {
    const cached = await getCached<string>('ysm-atoz-index', `lab-page:${lab.slug}`);
    if (cached) return cached;
  }
  try {
    const res = await axios.get(lab.url, {
      timeout: 30000,
      headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    });
    const html = res.data as string;
    if (useCache) await setCached('ysm-atoz-index', `lab-page:${lab.slug}`, html);
    return html;
  } catch {
    return null;
  }
}

async function fetchLabTeamPage(lab: RawLab, useCache: boolean): Promise<string | null> {
  let teamUrl: string;
  try {
    teamUrl = new URL('team/', lab.url.endsWith('/') ? lab.url : `${lab.url}/`).toString();
  } catch {
    return null;
  }
  if (useCache) {
    const cached = await getCached<string>('ysm-atoz-index', `lab-team-page:${lab.slug}`);
    if (cached) return cached;
  }
  try {
    const res = await axios.get(teamUrl, {
      timeout: 30000,
      headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    });
    const html = res.data as string;
    if (useCache) await setCached('ysm-atoz-index', `lab-team-page:${lab.slug}`, html);
    return html;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#xA0;/gi, ' ');
}

function absolutizeUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function cleanProfileGridName(value: string): string {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/['’]s\s+Profile$/i, '')
    .replace(/\s+Profile$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLeadershipProfilesFromHtmlSections(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): PrincipalInvestigatorProfile[] {
  const profiles: PrincipalInvestigatorProfile[] = [];
  const seen = new Set<string>();
  $('.organization-member-listing').each((_i, section) => {
    const label = [
      $(section).attr('aria-label') || '',
      $(section).find('h2,h3').first().text() || '',
    ].join(' ');
    if (!/\b(princip(?:al|le)\s+investigator|leadership|director|co-director)\b/i.test(label)) {
      return;
    }

    $(section)
      .find('.profile-grid-item, article')
      .each((_j, item) => {
        const fullName = cleanProfileGridName(
          $(item).attr('aria-label') ||
            $(item).find('[class*="name"], h3, h4, a').first().text() ||
            '',
        );
        const href = $(item).find('a[href*="/profile/"]').first().attr('href');
        const profileUrl = absolutizeUrl(href, baseUrl);
        const key = `${fullName.toLowerCase()}|${profileUrl || ''}`;
        if (!fullName || seen.has(key)) return;
        seen.add(key);
        profiles.push({
          fullName,
          profileUrl,
        });
      });
  });
  return profiles;
}

function walkObjects(value: unknown, visit: (node: Record<string, any>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walkObjects(item, visit));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, any>;
  visit(node);
  Object.values(node).forEach((child) => walkObjects(child, visit));
}

export function parsePrincipalInvestigatorProfilesFromLabHtml(
  html: string,
  baseUrl: string,
): PrincipalInvestigatorProfile[] {
  const $ = cheerio.load(html);
  const rawPageData = $('#page-data').html() || $('#page-data').text();
  if (!rawPageData) return parseLeadershipProfilesFromHtmlSections($, baseUrl);

  let pageData: unknown;
  try {
    pageData = JSON.parse(decodeHtmlEntities(rawPageData.trim()));
  } catch {
    return [];
  }

  const explicitPiProfiles: PrincipalInvestigatorProfile[] = [];
  const leadershipProfiles: PrincipalInvestigatorProfile[] = [];
  const allProfileWidgets: PrincipalInvestigatorProfile[] = [];
  const seen = new Set<string>();
  walkObjects(pageData, (node) => {
    if (node.isLeadership === true && node.name && node.profileUrl) {
      const fullName = String(node.name || '').replace(/\s+/g, ' ').trim();
      const profileUrl = absolutizeUrl(String(node.profileUrl || ''), baseUrl);
      const email = String((node.contacts as any)?.email || '').trim().toLowerCase();
      const dedupeKey = `${fullName.toLowerCase()}|${profileUrl || ''}|${email}`;
      if (fullName && !seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        leadershipProfiles.push({
          fullName,
          profileUrl,
          email: email || undefined,
        });
      }
      return;
    }

    if (node.key !== 'ProfileContactWidget') return;
    const model = node.model || {};
    const profile = model.profile || {};
    const fullName = String(profile.fullName || '').replace(/\s+/g, ' ').trim();
    const profileUrl = absolutizeUrl(String(profile.profileUrl || ''), baseUrl);
    const email = String(profile.generalContacts?.email || '').trim().toLowerCase();
    const dedupeKey = `${fullName.toLowerCase()}|${profileUrl || ''}|${email}`;
    if (!fullName || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const parsedProfile = {
      fullName,
      profileUrl,
      email: email || undefined,
    };
    allProfileWidgets.push(parsedProfile);
    const title = String(model.title || '');
    if (/\bprincip(?:al|le)\s+investigator\b/i.test(title)) {
      explicitPiProfiles.push(parsedProfile);
    } else if (/\b(co-)?director\b/i.test(title)) {
      leadershipProfiles.push(parsedProfile);
    }
  });
  if (explicitPiProfiles.length > 0) return explicitPiProfiles;
  if (leadershipProfiles.length > 0) return leadershipProfiles.filter((profile) => {
    return (
      Boolean(profile.email?.endsWith('@yale.edu')) ||
      Boolean(profile.profileUrl && /medicine\.yale\.edu\/(?:lab\/[^/]+\/)?profile\//i.test(profile.profileUrl))
    );
  });
  const sectionProfiles = parseLeadershipProfilesFromHtmlSections($, baseUrl);
  if (sectionProfiles.length > 0) return sectionProfiles;
  if (allProfileWidgets.length !== 1) return [];
  const [singleProfile] = allProfileWidgets;
  const hasOfficialYaleEvidence =
    Boolean(singleProfile.email?.endsWith('@yale.edu')) ||
    Boolean(singleProfile.profileUrl && /medicine\.yale\.edu\/profile\//i.test(singleProfile.profileUrl));
  return hasOfficialYaleEvidence ? [singleProfile] : [];
}

export function parseDepartmentsFromLabHtml(html: string, labName: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];
  $('.department-header__breadcrumbs li').each((_i, li) => {
    const value = $(li)
      .text()
      .replace(/\s*\/\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!value) return;
    if (value === 'Yale School of Medicine') return;
    if (value.toLowerCase() === labName.toLowerCase()) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  if (out.length > 0 && !seen.has('yale school of medicine')) {
    out.push('Yale School of Medicine');
  }
  return out;
}

export function parseLabs(html: string): RawLab[] {
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
    if (isGenericResearchWebsiteIndexUrl(url)) return;
    if (isClearlyContentPageLabIndexRow(name, url)) return;

    const slug = slugifyFromUrl(url) || slugifyFromName(name);
    labs.push({ name, url, slug });
  });

  return labs;
}

export function labToObservations(lab: RawLab, sourceUrl: string): ObservationInput[] {
  const base = { entityType: 'researchEntity' as const, entityKey: lab.slug, sourceUrl };
  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: lab.slug },
    { ...base, field: 'name', value: lab.name },
    { ...base, field: 'kind', value: 'lab' },
    { ...base, field: 'school', value: 'Yale School of Medicine' },
    { ...base, field: 'websiteUrl', value: lab.url },
    { ...base, field: 'sourceUrls', value: [sourceUrl, lab.url] },
    { ...base, field: 'openness', value: 'open' },
  ];
  if (lab.departments && lab.departments.length > 0) {
    observations.push({ ...base, field: 'departments', value: lab.departments });
  }
  return observations;
}

export class YsmAtoZScraper implements IScraper {
  readonly name = 'ysm-atoz-index';
  readonly displayName = 'YSM A-to-Z Lab Websites';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    ctx.log(`Fetching ${PAGE_URL}`);
    const html = await fetchPage(ctx.options.useCache);
    const labs = parseLabs(html);
    ctx.log(`Parsed ${labs.length} labs from index`);

    const limited =
      ctx.options.limit && ctx.options.limit > 0 ? labs.slice(0, ctx.options.limit) : labs;
    const facultyUsers = await User.find(
      { userType: { $in: ['professor', 'faculty'] } },
      { _id: 1, netid: 1, fname: 1, lname: 1, primaryDepartment: 1, email: 1, profileUrls: 1 },
    ).lean();
    const profileCandidates = await User.find(
      {
        $or: [
          { userType: { $in: ['professor', 'faculty'] } },
          { email: /@yale\.edu$/i },
          { profileUrls: { $exists: true, $ne: null } },
        ],
      },
      { _id: 1, netid: 1, fname: 1, lname: 1, primaryDepartment: 1, email: 1, profileUrls: 1 },
    ).lean();

    let totalObs = 0;
    let piMatched = 0;
    const userProfileObservations: ObservationInput[] = [];

    for (const lab of limited) {
      let piUserIds = findPiUserIdsForLabFromCandidates(lab, facultyUsers);
      let labHtml: string | null = null;
      const labUserProfileObservations: ObservationInput[] = [];
      if (piUserIds.length === 0 || !lab.departments?.length) {
        labHtml = await fetchLabPage(lab, ctx.options.useCache);
      }
      if (labHtml) {
        lab.departments = parseDepartmentsFromLabHtml(labHtml, lab.name);
        const principalInvestigators = labHtml
          ? parsePrincipalInvestigatorProfilesFromLabHtml(labHtml, lab.url)
          : [];
        const profilePiUserIds = findPiUserIdsForLabFromCandidates(
          { ...lab, principalInvestigators },
          profileCandidates,
        );
        if (principalInvestigators.length > 0) {
          piUserIds = profilePiUserIds;
        }
        labUserProfileObservations.push(
          ...piProfileUserObservationsFromProfiles(principalInvestigators, profileCandidates, lab.url),
        );

        if (principalInvestigators.length === 0) {
          const teamHtml = await fetchLabTeamPage(lab, ctx.options.useCache);
          const teamPrincipalInvestigators = teamHtml
            ? parsePrincipalInvestigatorProfilesFromLabHtml(teamHtml, `${lab.url.replace(/\/?$/, '/') }team/`)
            : [];
          const teamProfilePiUserIds = findPiUserIdsForLabFromCandidates(
            { ...lab, principalInvestigators: teamPrincipalInvestigators },
            profileCandidates,
          );
          if (teamPrincipalInvestigators.length > 0) {
            piUserIds = teamProfilePiUserIds;
          }
          labUserProfileObservations.push(
            ...piProfileUserObservationsFromProfiles(teamPrincipalInvestigators, profileCandidates, lab.url),
          );
        }
      }
      const observations = labToObservations(lab, PAGE_URL);
      userProfileObservations.push(...labUserProfileObservations);
      for (const piUserId of piUserIds) {
        observations.push({
          entityType: 'researchEntity',
          entityKey: lab.slug,
          field: 'inferredPiUserId',
          value: piUserId,
          sourceUrl: PAGE_URL,
          confidenceOverride: 0.5,
        });
      }
      if (piUserIds.length > 0) piMatched++;
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    const mergedUserProfileObservations = mergeUserProfileUrlObservations(userProfileObservations);
    if (mergedUserProfileObservations.length > 0) {
      await ctx.emit(mergedUserProfileObservations);
      totalObs += mergedUserProfileObservations.length;
    }

    ctx.log(`Emitted ${totalObs} observations across ${limited.length} labs`);
    ctx.log(`Inferred PI for ${piMatched}/${limited.length} labs`);

    return {
      observationCount: totalObs,
      entitiesObserved: limited.length + mergedUserProfileObservations.length,
      notes: `Discovered ${limited.length} YSM labs (${piMatched} with inferred PI)`,
    };
  }
}
