import axios from 'axios';
import { User } from '../../models/user';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { getCached, setCached } from '../snapshotCache';
import {
  profileEnrichmentFromHtml,
  type FacultyEntry,
} from './departmentRosterScraper';
import {
  isMaterializableUserBioCandidate,
  isWeakUserBioCandidate,
} from '../../utils/profileBioQuality';
import { sanitizeProfileResearchTerms } from '../../utils/profileResearchTerms';

const SOURCE_NAME = 'official-profile-enrichment';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_LIMIT = 250;

export interface OfficialProfileUser {
  _id?: unknown;
  netid: string;
  fname?: string | null;
  lname?: string | null;
  userType?: string | null;
  profileUrls?: Record<string, unknown> | null;
  website?: string | null;
  bio?: string | null;
  imageUrl?: string | null;
  title?: string | null;
  email?: string | null;
  orcid?: string | null;
  researchInterests?: string[] | null;
  topics?: string[] | null;
  manuallyLockedFields?: string[] | null;
}

export type OfficialProfileUserFinder = () => Promise<OfficialProfileUser[]>;
export type OfficialProfileFetchPage = (
  url: string,
  useCache: boolean,
  sourceName: string,
) => Promise<string>;

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrlForDedupe(value: unknown): string {
  const url = cleanText(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

function sameOrSubdomain(hostname: string, rootHostname: string): boolean {
  return hostname === rootHostname || hostname.endsWith(`.${rootHostname}`);
}

export function isOfficialYaleProfileUrl(value: unknown): value is string {
  const url = cleanText(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    if (!sameOrSubdomain(parsed.hostname.toLowerCase(), 'yale.edu')) return false;
    return /\/(profile|people|person|faculty|directory|faculty-directory)(?:\/|$|-)/i.test(
      parsed.pathname,
    );
  } catch {
    return false;
  }
}

export function officialProfileUrlsForUser(
  user: Pick<OfficialProfileUser, 'profileUrls' | 'website'>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...Object.values(user.profileUrls || {}), user.website]) {
    if (!isOfficialYaleProfileUrl(value)) continue;
    const normalized = value.trim();
    const key = normalizeUrlForDedupe(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function fieldLocked(user: OfficialProfileUser, field: string): boolean {
  return (user.manuallyLockedFields || []).includes(field);
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function looksLikeRoleOnlyBio(value: unknown): boolean {
  const text = cleanText(value);
  if (!text) return false;
  if (wordCount(text) > 10 || text.length > 90) return false;
  if (/[.!?]\s*$/.test(text)) return false;
  if (/\b(?:research|studies|study|works?|focus(?:es|ed)?|interests?|born|earned|obtained|received)\b/i.test(text)) {
    return false;
  }
  return /\b(?:director|chair|coordinator|manager|professor|lecturer|instructor|scientist|fellow|associate|assistant|track|program)\b/i.test(
    text,
  );
}

function hasTrailingWebsiteChrome(value: unknown): boolean {
  return /\s*(?:Website|Web site):\s*\S+(?:\s+\S+)?\s*$/i.test(cleanText(value));
}

function hasMissingSentenceSpacing(value: unknown): boolean {
  return /[a-z0-9]\.(?=[A-Z][a-z])/.test(cleanText(value));
}

function looksLikeUsableBioCandidate(value: unknown): boolean {
  const text = cleanText(value);
  if (!text) return false;
  return !looksLikeRoleOnlyBio(text) && isMaterializableUserBioCandidate(text);
}

function looksLikeShortBioCandidate(value: unknown): boolean {
  const text = cleanText(value);
  return looksLikeUsableBioCandidate(text) && wordCount(text) < 35;
}

function isMeaningfullyRicherBio(existingValue: unknown, candidateValue: unknown): boolean {
  const existing = cleanText(existingValue);
  const candidate = cleanText(candidateValue);
  if (!looksLikeUsableBioCandidate(candidate)) return false;
  if (!existing) return true;

  const existingWords = wordCount(existing);
  const candidateWords = wordCount(candidate);
  return candidateWords >= existingWords + 25 && candidateWords >= existingWords * 1.6;
}

function hasStringGap(user: OfficialProfileUser, field: keyof OfficialProfileUser): boolean {
  if (fieldLocked(user, field)) return false;
  const existing = cleanText(user[field]);
  if (!existing) return true;
  return (
    field === 'bio' &&
    (looksLikeRoleOnlyBio(existing) ||
      isWeakUserBioCandidate(existing) ||
      hasTrailingWebsiteChrome(existing) ||
      hasMissingSentenceSpacing(existing) ||
      looksLikeShortBioCandidate(existing))
  );
}

function hasArrayGap(user: OfficialProfileUser, field: keyof OfficialProfileUser): boolean {
  const value = user[field];
  return !fieldLocked(user, field) && (!Array.isArray(value) || value.length === 0);
}

export function selectOfficialProfileTargets(
  users: OfficialProfileUser[],
  options: { only?: string[]; limit?: number; offset?: number },
): OfficialProfileUser[] {
  const only =
    options.only && options.only.length > 0
      ? new Set(options.only.map((value) => value.trim().toLowerCase()))
      : null;
  const offset =
    options.offset && Number.isFinite(options.offset) && options.offset > 0
      ? Math.floor(options.offset)
      : 0;
  const limit =
    options.limit && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : DEFAULT_LIMIT;

  return users
    .filter((user) => {
      const netid = cleanText(user.netid).toLowerCase();
      if (!netid) return false;
      if (only && !only.has(netid)) return false;
      if (officialProfileUrlsForUser(user).length === 0) return false;
      return (
        hasStringGap(user, 'bio') ||
        hasStringGap(user, 'imageUrl') ||
        hasStringGap(user, 'title') ||
        hasStringGap(user, 'orcid') ||
        hasArrayGap(user, 'researchInterests') ||
        hasArrayGap(user, 'topics')
      );
    })
    .slice(offset, offset + limit);
}

function shouldEmitString(
  user: OfficialProfileUser,
  field: keyof OfficialProfileUser,
  value: unknown,
): value is string {
  if (field === 'bio') {
    return (
      !fieldLocked(user, field) &&
      looksLikeUsableBioCandidate(value) &&
      (hasStringGap(user, field) || isMeaningfullyRicherBio(user.bio, value))
    );
  }
  if (!hasStringGap(user, field)) return false;
  return !!cleanText(value);
}

function shouldEmitArray(
  user: OfficialProfileUser,
  field: keyof OfficialProfileUser,
  value: unknown,
): value is string[] {
  return hasArrayGap(user, field) && Array.isArray(value) && value.length > 0;
}

export function officialProfileObservationsFromEnrichment(
  user: OfficialProfileUser,
  sourceUrl: string,
  enrichment: Partial<FacultyEntry>,
): ObservationInput[] {
  const base = {
    entityType: 'user' as const,
    entityKey: `netid:${user.netid}`,
    sourceUrl,
  };
  const out: ObservationInput[] = [];

  if (shouldEmitString(user, 'bio', enrichment.bio)) {
    out.push({ ...base, field: 'bio', value: enrichment.bio });
  }
  if (shouldEmitString(user, 'title', enrichment.title)) {
    out.push({ ...base, field: 'title', value: enrichment.title });
  }
  if (shouldEmitString(user, 'email', enrichment.email)) {
    out.push({ ...base, field: 'email', value: enrichment.email });
  }
  if (shouldEmitString(user, 'imageUrl', enrichment.imageUrl)) {
    out.push({ ...base, field: 'imageUrl', value: enrichment.imageUrl });
  }
  if (shouldEmitString(user, 'orcid', enrichment.orcid)) {
    out.push({ ...base, field: 'orcid', value: enrichment.orcid });
  }
  const researchInterests = sanitizeProfileResearchTerms(enrichment.researchInterests || []);
  const topics = sanitizeProfileResearchTerms(enrichment.topics || []);

  if (shouldEmitArray(user, 'researchInterests', researchInterests)) {
    out.push({ ...base, field: 'researchInterests', value: researchInterests });
  }
  if (shouldEmitArray(user, 'topics', topics)) {
    out.push({ ...base, field: 'topics', value: topics });
  }
  if (
    isOfficialYaleProfileUrl(enrichment.profileUrl) &&
    !Object.values(user.profileUrls || {}).some(
      (url) => normalizeUrlForDedupe(url) === normalizeUrlForDedupe(enrichment.profileUrl),
    )
  ) {
    out.push({
      ...base,
      field: 'profileUrls',
      value: {
        ...(user.profileUrls || {}),
        official: enrichment.profileUrl,
      },
    });
  }
  if (user._id && enrichment.selectedPublicationLinks?.length) {
    enrichment.selectedPublicationLinks.slice(0, 8).forEach((link) => {
      const entityKey = `official-profile:${String(user._id)}:${normalizeUrlForDedupe(link.url)}`;
      const linkBase = {
        entityType: 'scholarlyLink' as const,
        entityKey,
        sourceUrl,
      };
      out.push(
        { ...linkBase, field: 'userId', value: String(user._id), confidenceOverride: 0.8 },
        { ...linkBase, field: 'title', value: link.title },
        { ...linkBase, field: 'url', value: link.url },
        { ...linkBase, field: 'destinationKind', value: link.destinationKind },
        { ...linkBase, field: 'displaySource', value: link.displaySource },
        { ...linkBase, field: 'discoveredVia', value: 'OFFICIAL_PROFILE' },
        { ...linkBase, field: 'confidence', value: 0.8 },
      );
      if (link.doi) out.push({ ...linkBase, field: 'externalIds', value: { doi: link.doi } });
      if (link.year) out.push({ ...linkBase, field: 'year', value: link.year });
      if (link.venue) out.push({ ...linkBase, field: 'venue', value: link.venue });
    });
  }

  return out;
}

async function defaultFetchPage(
  url: string,
  useCache: boolean,
  sourceName: string,
): Promise<string> {
  const cacheKey = `page:${url}`;
  if (useCache) {
    const cached = await getCached<string>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
  });
  const html = res.data as string;
  if (useCache) await setCached(sourceName, cacheKey, html);
  return html;
}

async function defaultUserFinder(): Promise<OfficialProfileUser[]> {
  const docs = await User.find(
    {
      userType: { $in: ['professor', 'faculty'] },
      $or: [
        { profileUrls: { $exists: true, $ne: {} } },
        { website: { $exists: true, $nin: ['', null] } },
      ],
    },
    {
      _id: 1,
      netid: 1,
      fname: 1,
      lname: 1,
      userType: 1,
      profileUrls: 1,
      website: 1,
      bio: 1,
      imageUrl: 1,
      title: 1,
      email: 1,
      orcid: 1,
      researchInterests: 1,
      topics: 1,
      manuallyLockedFields: 1,
    },
  ).lean();
  return docs as OfficialProfileUser[];
}

export class OfficialProfileEnrichmentScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Official Yale profile enrichment';

  constructor(
    private readonly deps: {
      userFinder?: OfficialProfileUserFinder;
      fetchPage?: OfficialProfileFetchPage;
    } = {},
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const userFinder = this.deps.userFinder || defaultUserFinder;
    const fetchPage = this.deps.fetchPage || defaultFetchPage;
    const users = await userFinder();
    const targets = selectOfficialProfileTargets(users, {
      only: ctx.options.only,
      limit: ctx.options.limit,
      offset: ctx.options.offset,
    });

    let observationCount = 0;
    let entitiesObserved = 0;
    let fetchFailed = 0;

    for (const user of targets) {
      const profileUrls = officialProfileUrlsForUser(user);
      let userObservationCount = 0;

      for (const profileUrl of profileUrls) {
        let html = '';
        try {
          html = await fetchPage(profileUrl, ctx.options.useCache, SOURCE_NAME);
        } catch (err: any) {
          fetchFailed++;
          ctx.log(`[${user.netid}] official profile fetch failed: ${err?.message || err}`);
          continue;
        }

        const enrichment = profileEnrichmentFromHtml(html, profileUrl);
        const sourceUrl = enrichment.profileSourceUrl || enrichment.profileUrl || profileUrl;
        const observations = officialProfileObservationsFromEnrichment(
          user,
          sourceUrl,
          enrichment,
        );
        if (observations.length === 0) continue;
        await ctx.emit(observations);
        observationCount += observations.length;
        userObservationCount += observations.length;
      }

      if (userObservationCount > 0) entitiesObserved++;
    }

    return {
      observationCount,
      entitiesObserved,
      notes: `Official profile-enriched ${entitiesObserved}/${targets.length} users (${fetchFailed} fetch-failed)`,
    };
  }
}
