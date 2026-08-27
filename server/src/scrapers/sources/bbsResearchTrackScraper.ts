/**
 * BbsResearchTrackScraper
 *
 * Yale's Combined Program in Biological and Biomedical Sciences (BBS) publishes
 * the canonical, research-track-categorized directory of biomedical PIs at
 * `medicine.yale.edu/bbs/people/<track>`, organized into nine curated tracks
 * (Immunology, Neuroscience, Microbiology, ...). Each track is a human-curated
 * topical grouping that maps directly onto a research-area browse facet - the
 * class of evidence #1699/#1700 flag as missing on much of the biomedical corpus.
 *
 * This source enriches, it does not roster. Following the affiliate-enrichment
 * pattern (the YIBS field-collection extractor, #1396), it grafts the track
 * label onto each PI's existing canonical research home rather than minting a
 * duplicate identity shell: BBS PIs are YSM/basic-science faculty already
 * covered by `ysm-faculty-directory` / `ysm-atoz-index` / department rosters.
 * A conservative FACULTY_RESEARCH_AREA home is minted only when no existing
 * entity resolves for the PI, keyed on the same `ysm-faculty-<slug>` namespace
 * `ysm-faculty-directory` uses so the two sources converge on one entity
 * instead of forking a shell (#1390).
 *
 * Crawl shape (mirrors `ysm-mesh-keyword` / `ysm-faculty-directory`):
 *   - Each `/bbs/people/<track>` page is a SEED listing, never cited as a source.
 *   - Each PI's own `/bbs/profile/<slug>` page is the individual source cited for
 *     the track research-area evidence; it carries the canonical YSM profile and
 *     lab links used to resolve the PI's existing research home.
 *   - Contact is fail-closed: no emails are read or emitted; identity resolves
 *     from the person's own official profile URL and name, never a surname search.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ResearchEntity } from '../../models/researchEntity';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import { splitName } from '../utils/scraperHelpers';
import {
  facultyNameMatchKey,
  normalizeYsmProfileUrl,
} from './ysmMeshKeywordScraper';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const SOURCE_KEY = 'bbs-research-track';
const BBS_HOST = 'medicine.yale.edu';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const SCHOOL_NAME = 'Yale School of Medicine';
const RESEARCH_AREA_CONFIDENCE = 0.7;
const INFERRED_PI_CONFIDENCE = 0.7;
const MAX_CANDIDATE_SCAN = 4000;

export interface BbsTrack {
  /** Track path segment under `/bbs/people/`, also used to filter with `--only`. */
  slug: string;
  url: string;
  /** Human-readable research-area facet label grafted for every PI in the track. */
  researchArea: string;
}

/**
 * The nine BBS research tracks and the concise research-area label each maps to.
 * Labels are the curated facet chip, not the raw slug or the full program name,
 * kept short enough to survive research-area label hygiene and read as a topic.
 */
export const BBS_TRACKS: BbsTrack[] = [
  {
    slug: 'bbsb',
    url: 'https://medicine.yale.edu/bbs/people/bbsb/',
    researchArea: 'Biochemistry, Quantitative Biology, Biophysics & Structural Biology',
  },
  {
    slug: 'cbb',
    url: 'https://medicine.yale.edu/bbs/people/cbb/',
    researchArea: 'Computational Biology & Bioinformatics',
  },
  {
    slug: 'human-genome-sciences',
    url: 'https://medicine.yale.edu/bbs/people/human-genome-sciences/',
    researchArea: 'Human Genome Sciences',
  },
  {
    slug: 'immunology',
    url: 'https://medicine.yale.edu/bbs/people/immunology/',
    researchArea: 'Immunology',
  },
  {
    slug: 'm2p2',
    url: 'https://medicine.yale.edu/bbs/people/m2p2/',
    researchArea: 'Molecular Medicine, Pharmacology & Physiology',
  },
  {
    slug: 'mcbgd',
    url: 'https://medicine.yale.edu/bbs/people/mcbgd/',
    researchArea: 'Molecular Cell Biology, Genetics & Development',
  },
  {
    slug: 'microbiology',
    url: 'https://medicine.yale.edu/bbs/people/microbiology/',
    researchArea: 'Microbiology',
  },
  {
    slug: 'neuroscience',
    url: 'https://medicine.yale.edu/bbs/people/neuroscience/',
    researchArea: 'Neuroscience',
  },
  {
    slug: 'plantmolbio',
    url: 'https://medicine.yale.edu/bbs/people/plantmolbio/',
    researchArea: 'Plant Molecular Biology',
  },
];

export const BBS_TRACK_RESEARCH_AREAS: Record<string, string> = Object.fromEntries(
  BBS_TRACKS.map((track) => [track.slug, track.researchArea]),
);

export function bbsTrackResearchAreaLabel(slug: string): string | undefined {
  return BBS_TRACK_RESEARCH_AREAS[slug.trim().toLowerCase()];
}

export interface BbsFacultyRef {
  name: string;
  profileSlug: string;
  profileUrl: string;
}

export interface BbsTrackPi {
  name: string;
  profileSlug: string;
  profileUrl: string;
  researchAreas: string[];
}

export interface BbsProfileLinks {
  canonicalProfileUrl: string;
  labUrls: string[];
}

export interface BbsCandidateEntity {
  _id?: unknown;
  slug?: string;
  name: string;
  matchUrls: string[];
  nameKey: string;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const uniqueStrings = (values: Array<string | undefined | null>): string[] =>
  Array.from(new Set(values.map((value) => text(value)).filter(Boolean)));

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Normalize a Yale URL for equality matching: lowercased host, no hash, no trailing slash, no query. */
export function normalizeMatchUrl(value: unknown): string {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return '';
  }
}

export function bbsProfileSlugFromUrl(url: string): string {
  const match = text(url).match(/\/bbs\/profile\/([^/?#]+)/i);
  return match?.[1]?.toLowerCase() || '';
}

function nameFromLastCommaFirst(raw: string): string {
  const cleaned = text(raw);
  const [last, first] = cleaned.split(',').map((part) => text(part));
  if (!first || !last) return cleaned;
  return `${first} ${last}`;
}

/**
 * Parse a BBS track listing page into the faculty it lists. The roster renders
 * as `link-items-list__item` anchors linking each PI's `/bbs/profile/<slug>`
 * page (name is "Last, First"); the same data is duplicated in an escaped JSON
 * blob, so dedupe by profile slug.
 */
export function parseBbsTrackFaculty(html: string, pageUrl: string): BbsFacultyRef[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const bySlug = new Map<string, BbsFacultyRef>();
  $('li.link-items-list__item a.hyperlink[href*="/bbs/profile/"]').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') || '';
    const profileSlug = bbsProfileSlugFromUrl(href);
    if (!profileSlug || bySlug.has(profileSlug)) return;
    const name = nameFromLastCommaFirst(link.text());
    if (!name) return;
    bySlug.set(profileSlug, {
      name,
      profileSlug,
      profileUrl: absolutize(href, pageUrl),
    });
  });
  return Array.from(bySlug.values());
}

function isYsmLabUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== BBS_HOST) return false;
    return /^\/lab\/[^/]+/i.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Read the PI's canonical YSM profile URL and any YSM lab-site links from their
 * own `/bbs/profile/<slug>` page. These are the durable identifiers used to
 * resolve the PI's existing research home.
 */
export function parseBbsProfileLinks(html: string, profileUrl: string): BbsProfileLinks {
  const $ = cheerio.load(html);
  const canonicalHref =
    $('link[rel="canonical"]').first().attr('href') ||
    $('meta[property="og:url"]').first().attr('content') ||
    '';
  const canonicalProfileUrl = normalizeYsmProfileUrl(
    canonicalHref ? absolutize(canonicalHref, profileUrl) : '',
  );
  const labUrls: string[] = [];
  $('a[href]').each((_i, el) => {
    const absolute = absolutize($(el).attr('href') || '', profileUrl);
    if (isYsmLabUrl(absolute)) labUrls.push(absolute);
  });
  return { canonicalProfileUrl, labUrls: uniqueStrings(labUrls) };
}

/**
 * The research-home identifiers we match an existing entity against for a PI:
 * the canonical YSM profile URL, its `/lab/` sites, and the `ysm-faculty-<slug>`
 * / `ysm-<slug>` entity-key namespaces those profiles seed.
 */
export function bbsPiMatchKeys(links: BbsProfileLinks): { urls: string[]; slugs: string[] } {
  const urls = uniqueStrings([links.canonicalProfileUrl, ...links.labUrls])
    .map(normalizeMatchUrl)
    .filter(Boolean);
  const profileSlug = links.canonicalProfileUrl
    ? links.canonicalProfileUrl.replace(/\/+$/, '').split('/').pop() || ''
    : '';
  const slugs = profileSlug ? [`ysm-faculty-${profileSlug}`, `ysm-${profileSlug}`] : [];
  return { urls, slugs };
}

export interface BbsMatchIndex {
  entityIdByUrl: Map<string, Set<string>>;
  entityIdBySlug: Map<string, string>;
  entityIdByNameKey: Map<string, Set<string>>;
}

export function buildBbsMatchIndex(candidates: BbsCandidateEntity[]): BbsMatchIndex {
  const entityIdByUrl = new Map<string, Set<string>>();
  const entityIdBySlug = new Map<string, string>();
  const entityIdByNameKey = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const entityId = serializedDocumentId(candidate._id);
    if (!entityId) continue;
    const slug = text(candidate.slug).toLowerCase();
    if (slug) entityIdBySlug.set(slug, entityId);
    for (const rawUrl of candidate.matchUrls) {
      const url = normalizeMatchUrl(rawUrl);
      if (!url) continue;
      if (!entityIdByUrl.has(url)) entityIdByUrl.set(url, new Set());
      entityIdByUrl.get(url)!.add(entityId);
    }
    if (candidate.nameKey) {
      if (!entityIdByNameKey.has(candidate.nameKey)) {
        entityIdByNameKey.set(candidate.nameKey, new Set());
      }
      entityIdByNameKey.get(candidate.nameKey)!.add(entityId);
    }
  }
  return { entityIdByUrl, entityIdBySlug, entityIdByNameKey };
}

export type BbsHomeResolution =
  | { status: 'matched'; entityId: string }
  | { status: 'ambiguous' }
  | { status: 'unmatched' };

/**
 * Resolve a BBS PI to a single existing research home. URL and entity-key
 * matches are exact and preferred; a name-key match is a last-resort fallback
 * and is used only when it is unambiguous. Fails closed (ambiguous) whenever
 * more than one distinct entity is implicated so no track label is ever grafted
 * onto the wrong home.
 */
export function resolveBbsResearchHome(
  links: BbsProfileLinks,
  nameKey: string,
  index: BbsMatchIndex,
): BbsHomeResolution {
  const { urls, slugs } = bbsPiMatchKeys(links);
  const matched = new Set<string>();
  for (const url of urls) {
    for (const id of index.entityIdByUrl.get(url) || []) matched.add(id);
  }
  for (const slug of slugs) {
    const id = index.entityIdBySlug.get(slug);
    if (id) matched.add(id);
  }
  if (matched.size === 1) return { status: 'matched', entityId: [...matched][0] };
  if (matched.size > 1) return { status: 'ambiguous' };

  if (nameKey) {
    const byName = index.entityIdByNameKey.get(nameKey);
    if (byName && byName.size === 1) return { status: 'matched', entityId: [...byName][0] };
    if (byName && byName.size > 1) return { status: 'ambiguous' };
  }
  return { status: 'unmatched' };
}

export function bbsGraftObservations(
  entityId: string,
  researchAreas: string[],
  sourceUrl: string,
): ObservationInput[] {
  const areas = uniqueStrings(researchAreas);
  if (!entityId || areas.length === 0) return [];
  return [
    {
      entityType: 'researchEntity',
      entityId,
      sourceUrl,
      field: 'researchAreas',
      value: areas,
      confidenceOverride: RESEARCH_AREA_CONFIDENCE,
    },
  ];
}

/**
 * Conservative FACULTY_RESEARCH_AREA home minted only when no existing home
 * resolves. Keyed on the `ysm-faculty-<slug>` namespace so it converges with
 * `ysm-faculty-directory` rather than forking a duplicate shell (#1390). The
 * lead is keyed to a synthetic BBS user observation; the materializer resolves
 * the actual canonical Researcher from the name under the existing person-match guards.
 */
export function bbsMintObservations(
  pi: BbsTrackPi,
  links: BbsProfileLinks,
): ObservationInput[] {
  const ysmProfileUrl = links.canonicalProfileUrl;
  const identitySourceUrl = ysmProfileUrl || pi.profileUrl;
  const profileSlug = ysmProfileUrl
    ? ysmProfileUrl.replace(/\/+$/, '').split('/').pop() || pi.profileSlug
    : pi.profileSlug;
  const entityKey = ysmProfileUrl
    ? `ysm-faculty-${profileSlug}`.slice(0, 100)
    : `bbs-${pi.profileSlug}`.slice(0, 100);
  const areas = uniqueStrings(pi.researchAreas);
  if (areas.length === 0) return [];

  const userKey = `bbs:${profileSlug}`;
  const { first, last } = splitName(pi.name);
  const userBase = { entityType: 'user' as const, entityKey: userKey, sourceUrl: identitySourceUrl };
  const userObs: ObservationInput[] = [{ ...userBase, field: 'userType', value: 'faculty' }];
  if (first) userObs.push({ ...userBase, field: 'fname', value: first });
  if (last) userObs.push({ ...userBase, field: 'lname', value: last });
  if (ysmProfileUrl) {
    userObs.push({ ...userBase, field: 'profileUrls', value: { departmental: ysmProfileUrl } });
  }

  const entityBase = {
    entityType: 'researchEntity' as const,
    entityKey,
    sourceUrl: identitySourceUrl,
  };
  const entityObs: ObservationInput[] = [
    { ...entityBase, field: 'slug', value: entityKey },
    { ...entityBase, field: 'name', value: `${pi.name} Faculty Research` },
    { ...entityBase, field: 'kind', value: 'individual' },
    { ...entityBase, field: 'entityType', value: 'FACULTY_RESEARCH_AREA' },
    { ...entityBase, field: 'school', value: SCHOOL_NAME },
    { ...entityBase, field: 'sourceUrls', value: [identitySourceUrl] },
    { ...entityBase, field: 'researchAreas', value: areas },
    {
      ...entityBase,
      field: 'inferredPiUserKey',
      value: userKey,
      confidenceOverride: INFERRED_PI_CONFIDENCE,
    },
  ];

  return [...userObs, ...entityObs];
}

export type FetchBbsPageFn = (url: string, useCache: boolean) => Promise<string | null>;

export type BbsEntityFinderFn = () => Promise<BbsCandidateEntity[]>;

export interface BbsResearchTrackScraperDeps {
  fetchPage?: FetchBbsPageFn;
  entityFinder?: BbsEntityFinderFn;
}

async function defaultFetchPage(url: string, useCache: boolean): Promise<string | null> {
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, `page:${url}`);
    if (cached) return cached;
  }
  const safeUrl = await assertPublicHttpUrl(url);
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrl.toString(), {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = String(res.data || '');
  if (useCache) await setCached(SOURCE_KEY, `page:${url}`, html);
  return html;
}

interface BbsCandidateDoc {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  contactName?: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: unknown;
}

function candidateFromDoc(doc: BbsCandidateDoc): BbsCandidateEntity {
  const matchUrls = uniqueStrings([
    doc.websiteUrl,
    doc.website,
    ...(Array.isArray(doc.sourceUrls) ? (doc.sourceUrls as unknown[]).map(text) : []),
  ]);
  const name = text(doc.displayName || doc.name || doc.slug);
  return {
    _id: doc._id,
    slug: doc.slug,
    name,
    matchUrls,
    nameKey: facultyNameMatchKey(doc.contactName || name),
  };
}

async function defaultEntityFinder(): Promise<BbsCandidateEntity[]> {
  const docs = (await ResearchEntity.find(
    {
      archived: { $ne: true },
      $or: [
        { school: SCHOOL_NAME },
        { schools: SCHOOL_NAME },
        { slug: /^ysm-/i },
        { slug: /^bbs-/i },
      ],
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      contactName: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
    },
  )
    .sort({ _id: 1 })
    .limit(MAX_CANDIDATE_SCAN)
    .lean()) as BbsCandidateDoc[];
  return docs.map(candidateFromDoc);
}

export class BbsResearchTrackScraper implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'BBS research-track topical evidence for biomedical PIs';

  private readonly fetchPage: FetchBbsPageFn;
  private readonly entityFinder: BbsEntityFinderFn;

  constructor(deps: BbsResearchTrackScraperDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.entityFinder = deps.entityFinder || defaultEntityFinder;
  }

  private async collectTrackPis(ctx: ScraperContext): Promise<Map<string, BbsTrackPi>> {
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()))
        : null;
    const byProfileSlug = new Map<string, BbsTrackPi>();
    for (const track of BBS_TRACKS) {
      if (onlyFilter && !onlyFilter.has(track.slug)) continue;
      let html: string | null = null;
      try {
        html = await this.fetchPage(track.url, ctx.options.useCache);
      } catch (error) {
        ctx.log(`[${track.slug}] track page fetch failed: ${sanitizeLogValue(error)}`);
        continue;
      }
      if (!html) continue;
      const faculty = parseBbsTrackFaculty(html, track.url);
      ctx.log(`[${track.slug}] ${faculty.length} faculty listed`);
      for (const ref of faculty) {
        const existing = byProfileSlug.get(ref.profileSlug);
        if (existing) {
          if (!existing.researchAreas.includes(track.researchArea)) {
            existing.researchAreas.push(track.researchArea);
          }
        } else {
          byProfileSlug.set(ref.profileSlug, {
            name: ref.name,
            profileSlug: ref.profileSlug,
            profileUrl: ref.profileUrl,
            researchAreas: [track.researchArea],
          });
        }
      }
    }
    return byProfileSlug;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? Infinity;

    const pis = await this.collectTrackPis(ctx);
    const candidates = await this.entityFinder();
    const index = buildBbsMatchIndex(candidates);

    let observationCount = 0;
    let grafted = 0;
    let minted = 0;
    let ambiguous = 0;
    let processed = 0;

    for (const pi of pis.values()) {
      if (processed >= limit) break;
      processed += 1;

      let links: BbsProfileLinks = { canonicalProfileUrl: '', labUrls: [] };
      try {
        const html = await this.fetchPage(pi.profileUrl, ctx.options.useCache);
        if (html) links = parseBbsProfileLinks(html, pi.profileUrl);
      } catch (error) {
        ctx.log(`[${pi.profileSlug}] profile fetch failed: ${sanitizeLogValue(error)}`);
      }

      const resolution = resolveBbsResearchHome(
        links,
        facultyNameMatchKey(pi.name),
        index,
      );

      if (resolution.status === 'ambiguous') {
        ambiguous += 1;
        continue;
      }

      if (resolution.status === 'matched') {
        const observations = bbsGraftObservations(
          resolution.entityId,
          pi.researchAreas,
          links.canonicalProfileUrl || pi.profileUrl,
        );
        if (observations.length === 0) continue;
        await ctx.emit(observations);
        observationCount += observations.length;
        grafted += 1;
        continue;
      }

      const observations = bbsMintObservations(pi, links);
      if (observations.length === 0) continue;
      await ctx.emit(observations);
      observationCount += observations.length;
      minted += 1;
    }

    return {
      observationCount,
      entitiesObserved: grafted + minted,
      notes:
        `Grafted BBS track research areas onto ${grafted} existing homes; ` +
        `minted ${minted} net-new FACULTY_RESEARCH_AREA homes; ` +
        `${ambiguous} PIs held (ambiguous home) of ${pis.size} track PIs.`,
    };
  }
}
