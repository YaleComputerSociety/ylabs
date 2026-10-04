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
 * A track listing proves a person's research area, never that a row should
 * exist, so a PI with no existing row, or with several, mints nothing and is
 * counted by reason (#3561).
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
import { retryOnRetryableStatus } from '../utils/httpFetch';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import {
  buildCenterRosterHealthSnapshot,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  type CenterRosterReadMember,
  type CenterRosterStopReason,
} from '../centerRosterRetirement';
import { SCHOOL_OF_MEDICINE_NAME } from '../orgUnitCanonicalization';
import { getCached, setCached } from '../snapshotCache';
import { fetchFailureStatusCode } from '../utils/fetchFailure';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../utils/mapWithConcurrency';
import { facultyNameMatchKey, normalizeYsmProfileUrl } from './ysmMeshKeywordScraper';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import type { BbsTrackHealthSnapshot } from '../bbsTrackRosterRetirement';

const SOURCE_KEY = 'bbs-research-track';

/**
 * The role a track listing claims about a PI, which is the same for every entry: it says the PI
 * belongs to this graduate track and nothing else. The retirement mechanism keys a claim by
 * member and role, so a single constant degrades that key to the PI, which is exactly the claim
 * this lane makes and later retires (#3852).
 */
const BBS_TRACK_PI_ROLE = 'track-pi';
const BBS_HOST = 'medicine.yale.edu';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const PROFILE_REFUSAL_STATUS_CODES: ReadonlySet<number> = new Set([403, 429]);
export const BBS_REFUSED_PROFILE_RETRY_PAUSE_MS = 60_000;
/**
 * The school name as the CORPUS stores it, which is not how the school brands itself.
 *
 * This read `'Yale School of Medicine'` and matched zero rows: every live row stores
 * `'School of Medicine'`, so both school arms of the candidate query below were dead and the
 * candidate set was exactly its slug-prefix arm. Measured on Development: `'Yale School of
 * Medicine'` 0 rows, `'School of Medicine'` 2,244, and the only school value containing
 * "Medicine" is the latter (#3834).
 *
 * That is why the lane could not re-reach rows it had grafted onto: a row whose slug is not
 * `ysm-` or `bbs-` prefixed had no other way into the candidate set, so a re-run reported it as
 * having no existing research row and left its previous observation live forever.
 *
 * Cross-checked against `schoolForDirectoryProfileHost`, which maps this school's hosts to the
 * same stored name, so the two agree rather than each carrying its own spelling.
 */
const SCHOOL_NAME = SCHOOL_OF_MEDICINE_NAME;
const RESEARCH_AREA_CONFIDENCE = 0.7;
const MAX_CANDIDATE_SCAN = 4000;

export interface BbsTrack {
  /** Track path segment under `/bbs/people/`, also used to filter with `--only`. */
  slug: string;
  url: string;
  /**
   * The research-area chips grafted for every PI in the track. A list rather than one
   * label because three of the nine tracks are named after several fields at once, and a
   * programme name is not a topic (#3806).
   */
  researchAreas: string[];
}

/**
 * The nine BBS research tracks and the research-area chips each maps to.
 *
 * Chips are the curated facet values, not the raw slug and not the programme name. Six
 * tracks are named after a single field and map to it directly. The other three are named
 * after the several fields they span, and each is listed as those fields rather than as its
 * programme name: a chip reading "Molecular Medicine, Pharmacology & Physiology" tells a
 * student they are a fit for one of three things without saying which, and for 38 served
 * rows it was the whole of "Best fit for" (#3806).
 *
 * Splitting them asserts no more than the single-field tracks already do. Membership of the
 * immunology track is grafted as `Immunology` on the same evidence and at the same 0.7
 * confidence, so membership of a track that spans pharmacology is grafted as
 * `Pharmacology`. What changes is that each chip now names a field a student can read.
 */
export const BBS_TRACKS: BbsTrack[] = [
  {
    slug: 'bbsb',
    url: 'https://medicine.yale.edu/bbs/people/bbsb/',
    researchAreas: ['Biochemistry', 'Quantitative Biology', 'Biophysics', 'Structural Biology'],
  },
  {
    slug: 'cbb',
    url: 'https://medicine.yale.edu/bbs/people/cbb/',
    researchAreas: ['Computational Biology & Bioinformatics'],
  },
  {
    slug: 'human-genome-sciences',
    url: 'https://medicine.yale.edu/bbs/people/human-genome-sciences/',
    researchAreas: ['Human Genome Sciences'],
  },
  {
    slug: 'immunology',
    url: 'https://medicine.yale.edu/bbs/people/immunology/',
    researchAreas: ['Immunology'],
  },
  {
    slug: 'm2p2',
    url: 'https://medicine.yale.edu/bbs/people/m2p2/',
    researchAreas: ['Molecular Medicine', 'Pharmacology', 'Physiology'],
  },
  {
    slug: 'mcbgd',
    url: 'https://medicine.yale.edu/bbs/people/mcbgd/',
    researchAreas: ['Molecular Cell Biology', 'Genetics', 'Developmental Biology'],
  },
  {
    slug: 'microbiology',
    url: 'https://medicine.yale.edu/bbs/people/microbiology/',
    researchAreas: ['Microbiology'],
  },
  {
    slug: 'neuroscience',
    url: 'https://medicine.yale.edu/bbs/people/neuroscience/',
    researchAreas: ['Neuroscience'],
  },
  {
    slug: 'plantmolbio',
    url: 'https://medicine.yale.edu/bbs/people/plantmolbio/',
    researchAreas: ['Plant Molecular Biology'],
  },
];

export const BBS_TRACK_RESEARCH_AREAS: Record<string, string[]> = Object.fromEntries(
  BBS_TRACKS.map((track) => [track.slug, track.researchAreas]),
);

/** The chips a track grafts, or an empty list when the slug names no track. */
export function bbsTrackResearchAreaLabels(slug: string): string[] {
  return BBS_TRACK_RESEARCH_AREAS[slug.trim().toLowerCase()] ?? [];
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
 * Parse a BBS track listing page into the faculty it lists, in either shape the CMS serves.
 *
 * Most tracks render the roster as `link-items-list__item` anchors linking each PI's
 * `/bbs/profile/<slug>` page, with the name as "Last, First". At least one track serves the same
 * roster as a plain two-column table instead, with no `link-items-list` wrapper and no
 * `hyperlink` class anywhere on the page, and the name as "First Last". The old selector required
 * all three of those, so that track parsed to zero faculty for three consecutive runs while the
 * run reported success (#3833).
 *
 * Both shapes are matched rather than the union of every `/bbs/profile/` link on the page,
 * because a track page also links profiles from navigation and related-content blocks and those
 * are not roster members. A link inside a roster list item or a table row is; anything else is
 * not. `nameFromLastCommaFirst` already passes an uncommaed "First Last" through unchanged, so
 * the name needs no second rule.
 *
 * The same data is duplicated in an escaped JSON blob, so dedupe by profile slug.
 */
const BBS_ROSTER_LINK_SELECTORS = [
  'li.link-items-list__item a[href*="/bbs/profile/"]',
  'table tr td a[href*="/bbs/profile/"]',
].join(', ');

export function parseBbsTrackFaculty(html: string, pageUrl: string): BbsFacultyRef[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const bySlug = new Map<string, BbsFacultyRef>();
  $(BBS_ROSTER_LINK_SELECTORS).each((_i, el) => {
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
  slugByEntityId: Map<string, string>;
  entityIdByNameKey: Map<string, Set<string>>;
  /** Identity tokens and netid per entity, for corroborating a non-person-key match. */
  identityByEntityId: Map<string, { tokens: Set<string>; netid: string }>;
}

/**
 * A netid embedded in an entity key or a profile slug ("hu-wh288", "wei-hu-wh447").
 * Two rows can share a surname and be different people, and then the netid is the
 * only thing that separates them.
 */
export function bbsIdentityNetid(value: unknown): string {
  const match = text(value)
    .toLowerCase()
    .match(/(?:^|[^a-z0-9])([a-z]{2,4}\d{1,5})$/);
  return match?.[1] ?? '';
}

const IDENTITY_STOPWORDS: ReadonlySet<string> = new Set([
  'ysm',
  'yse',
  'dept',
  'nih',
  'faculty',
  'research',
  'lab',
  'labs',
  'laboratory',
  'center',
  'centre',
  'program',
  'profile',
  'the',
]);

/** Identity words in a slug or a display name, with namespace furniture removed. */
export function bbsIdentityTokens(...values: unknown[]): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const word of text(value)
      .toLowerCase()
      .split(/[^a-z]+/)) {
      if (word.length < 2) continue;
      if (IDENTITY_STOPWORDS.has(word)) continue;
      if (/^[a-z]{2,4}\d/.test(word)) continue;
      tokens.add(word);
    }
  }
  return tokens;
}

/**
 * Whether a row's own identity names the person whose BBS profile was read.
 *
 * The lane's URL index is built from `websiteUrl` plus every entry of `sourceUrls`,
 * and its key set includes the PI's `/lab/` sites. Neither is a person key: a lab URL
 * identifies a laboratory, several people cite the same lab site, and `sourceUrls` is
 * the list of pages a record cites rather than a claim to be them. A single row
 * citing one of those URLs was therefore taken as the PI, which put a track on a row
 * belonging to someone else (#3342).
 *
 * The ambiguity fence does not cover this: it refuses when SEVERAL rows are
 * implicated, and this is the one-wrong-row case.
 *
 * Corroboration rather than refusal of the key, because the mirror risk is measured
 * and it runs the other way. Of 383 resolvable live grafts on Development
 * 2026-09-25, 26 matched only through a borrowed URL and 22 of those name the same
 * person in their own slug, so dropping the key outright would lose about 23 correct
 * grafts to remove 4 wrong ones.
 */
/**
 * Whether the row and the profile carry DIFFERENT netids, which means two different
 * people however well their surnames agree.
 *
 * Applied to the profile-URL arm as well as the borrowed-URL one, because a row can
 * cite another person's profile page among its `sourceUrls`, and there the lane's
 * strongest key points at the wrong person: one Development row keyed to one netid
 * served an Immunology track read from a different netid's profile, and the surnames
 * matched. Silent when either side has no netid, so it can only ever refuse on a
 * positive disagreement.
 */
export function bbsIdentityNetidConflicts(
  rowIdentity: { netid: string } | undefined,
  profileSlug: string,
): boolean {
  const profileNetid = bbsIdentityNetid(profileSlug);
  const rowNetid = rowIdentity?.netid ?? '';
  return Boolean(profileNetid && rowNetid && profileNetid !== rowNetid);
}

export function bbsRowIdentityNamesProfilePerson(
  rowIdentity: { tokens: Set<string>; netid: string } | undefined,
  profileSlug: string,
): boolean {
  if (!rowIdentity) return false;
  const profileNetid = bbsIdentityNetid(profileSlug);
  if (bbsIdentityNetidConflicts(rowIdentity, profileSlug)) return false;
  if (profileNetid && profileNetid === rowIdentity.netid) return true;
  const profileTokens = bbsIdentityTokens(profileSlug.replace(/-/g, ' '));
  if (profileTokens.size === 0) return false;
  for (const token of profileTokens) if (rowIdentity.tokens.has(token)) return true;
  return false;
}

export function buildBbsMatchIndex(candidates: BbsCandidateEntity[]): BbsMatchIndex {
  const entityIdByUrl = new Map<string, Set<string>>();
  const entityIdBySlug = new Map<string, string>();
  const slugByEntityId = new Map<string, string>();
  const entityIdByNameKey = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const entityId = serializedDocumentId(candidate._id);
    if (!entityId) continue;
    const slug = text(candidate.slug).toLowerCase();
    if (slug) {
      entityIdBySlug.set(slug, entityId);
      slugByEntityId.set(entityId, text(candidate.slug));
    }
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
  const identityByEntityId = new Map<string, { tokens: Set<string>; netid: string }>();
  for (const candidate of candidates) {
    const entityId = serializedDocumentId(candidate._id);
    if (!entityId) continue;
    identityByEntityId.set(entityId, {
      tokens: bbsIdentityTokens(candidate.slug, candidate.name),
      netid: bbsIdentityNetid(candidate.slug),
    });
  }
  return { entityIdByUrl, entityIdBySlug, slugByEntityId, entityIdByNameKey, identityByEntityId };
}

export type BbsHomeResolution =
  | { status: 'matched'; entityId: string }
  | { status: 'ambiguous' }
  | { status: 'refused' }
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
  bbsProfileSlug = '',
): BbsHomeResolution {
  const { urls, slugs } = bbsPiMatchKeys(links);
  const profileUrl = normalizeMatchUrl(links.canonicalProfileUrl);
  const profileSlug = links.canonicalProfileUrl
    ? links.canonicalProfileUrl.replace(/\/+$/, '').split('/').pop() || ''
    : '';
  // A person key names the PI: their own profile URL, or the entity-key namespace
  // their profile seeds. Every other match key is a URL the row merely cites, which
  // is where the graft came from, so those need the row's identity to agree (#3342).
  const matchedOnPersonKey = new Set<string>();
  const matchedOnCitedUrl = new Set<string>();
  for (const url of urls) {
    const target = url === profileUrl ? matchedOnPersonKey : matchedOnCitedUrl;
    for (const id of index.entityIdByUrl.get(url) || []) {
      if (bbsIdentityNetidConflicts(index.identityByEntityId.get(id), profileSlug)) continue;
      target.add(id);
    }
  }
  for (const slug of slugs) {
    const id = index.entityIdBySlug.get(slug);
    if (id) matchedOnPersonKey.add(id);
  }
  const corroborated = new Set(
    [...matchedOnCitedUrl].filter((id) =>
      bbsRowIdentityNamesProfilePerson(index.identityByEntityId.get(id), profileSlug),
    ),
  );
  const matched = new Set([...matchedOnPersonKey, ...corroborated]);
  if (matched.size === 1) return { status: 'matched', entityId: [...matched][0] };
  if (matched.size > 1) return { status: 'ambiguous' };
  // A borrowed URL that names nobody on this row is a refusal, not a fall-through to
  // the name fallback: the name key that would be tried next is the same PI's name,
  // and letting it through would re-admit the row the URL arm just declined.
  if (matchedOnCitedUrl.size > 0) return { status: 'refused' };

  // The key this lane minted rows under before #3561, derived from this same profile, so it names
  // the PI. A fallback rather than a person key: where the canonical row also exists, ranking the
  // two as equals would fail every such PI closed as ambiguous (#3834).
  const profileWasRead = Boolean(profileSlug);
  const lanesOwnRow =
    profileWasRead && bbsProfileSlug
      ? index.entityIdBySlug.get(`bbs-${bbsProfileSlug.trim().toLowerCase()}`)
      : undefined;
  if (lanesOwnRow) return { status: 'matched', entityId: lanesOwnRow };

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
  entityKey = '',
): ObservationInput[] {
  const areas = uniqueStrings(researchAreas);
  if (!entityId || areas.length === 0) return [];
  return [
    {
      entityType: 'researchEntity',
      entityId,
      ...(entityKey ? { entityKey } : {}),
      sourceUrl,
      field: 'researchAreas',
      value: areas,
      confidenceOverride: RESEARCH_AREA_CONFIDENCE,
    },
  ];
}

export type FetchBbsPageFn = (url: string, useCache: boolean) => Promise<string | null>;

export type BbsEntityFinderFn = () => Promise<BbsCandidateEntity[]>;

export type TrackEverListedPisFn = (track: BbsTrack, sourceId: string) => Promise<boolean>;

export interface BbsResearchTrackScraperDeps {
  fetchPage?: FetchBbsPageFn;
  entityFinder?: BbsEntityFinderFn;
  trackEverListedPis?: TrackEverListedPisFn;
  pause?: (ms: number) => Promise<void>;
}

type BbsProfileRead =
  | { status: 'read'; links: BbsProfileLinks }
  | { status: 'refused'; statusCode: number }
  | { status: 'failed' };

export interface BbsProfileFetchTally {
  concurrency: number;
  attempted: number;
  read: number;
  refused: number;
  recovered: number;
  lost: number;
  failed: number;
}

const EMPTY_PROFILE_LINKS: BbsProfileLinks = { canonicalProfileUrl: '', labUrls: [] };

const realPause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A per-track read snapshot on the #3781 contract, so absence can later be governed by the same
 * rule rather than a second one.
 *
 * Admissible only for a complete, off-the-wire read that listed at least one PI. A zero-PI parse,
 * a failed fetch and a cache-permitted read each produce a snapshot
 * `centerRosterReadAdmissibility` refuses, so none of them can retire anybody, and the emptiness
 * is recorded rather than lost. That is the protection the `plantmolbio` case needed: it listed
 * zero for three consecutive runs, and under a naive omission rule its whole membership would
 * have been retired three times over (#3852).
 *
 * `not-paginated` is the honest stop reason because a track listing is one page, and it counts as
 * having read the whole roster. A fetch that failed says so instead, which makes the read
 * incomplete and therefore inadmissible.
 */
export interface BbsTrackRead {
  track: BbsTrack;
  faculty: readonly BbsFacultyRef[];
  fetched: boolean;
}

function buildTrackRosterHealthObservation(input: {
  track: BbsTrack;
  faculty: readonly BbsFacultyRef[];
  fetched: boolean;
  /**
   * The row each listed PI resolved to THIS run, which is the identity space the claim lives in.
   *
   * A claim is a `researchAreas` value on a research entity, so a signal that governs it has to
   * name research entities. Naming only the PI cannot: the claim records the PI's canonical YSM
   * profile URL while a listing names the BBS one, and measured on Development only 409 of 1,036
   * live claims carry a recoverable BBS slug, so a slug-keyed join would govern 39% of them and
   * report success (#3852).
   *
   * A listed PI missing from this map did not resolve to a row this run, for any reason: a profile
   * fetch that failed, an ambiguous match, a refusal, or no existing row. That is unknown rather
   * than absent, and `bbsTrackReadBlocksRetirementOf` is what keeps it from retiring anybody.
   */
  claimEntityKeyByProfileSlug: ReadonlyMap<string, string>;
  citedProfileUrlByProfileSlug: ReadonlyMap<string, string>;
  cacheAllowed: boolean;
  readAt: Date;
}): ObservationInput {
  const members: Array<CenterRosterReadMember & { citedProfileUrl?: string }> = input.faculty.map(
    (ref) => {
      const claimEntityKey = input.claimEntityKeyByProfileSlug.get(ref.profileSlug);
      const citedProfileUrl = input.citedProfileUrlByProfileSlug.get(ref.profileSlug);
      return {
        memberKey: ref.profileSlug,
        role: BBS_TRACK_PI_ROLE,
        ...(claimEntityKey ? { claimEntityKey } : {}),
        ...(citedProfileUrl ? { citedProfileUrl } : {}),
      };
    },
  );
  const stopReason: CenterRosterStopReason = input.fetched ? 'not-paginated' : 'fetch-failed';
  return {
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    entityKey: input.track.slug,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceUrl: input.track.url,
    value: {
      ...buildCenterRosterHealthSnapshot({
        centerKey: input.track.slug,
        entityKey: input.track.slug,
        members,
        pagesRead: input.fetched ? 1 : 0,
        readMode: 'html',
        stopReason,
        cacheAllowed: input.cacheAllowed,
        readAt: input.readAt,
      }),
      claimEntityKeysRecorded: true,
    } satisfies BbsTrackHealthSnapshot,
  };
}

/**
 * Whether this lane has ever recorded a PI from this track page.
 *
 * A track that lists nobody is either a page that changed shape or a parser that broke on it, and
 * both are defects. Neither was visible: the lane logged `0 faculty listed` and carried on, so
 * `plantmolbio` parsed to zero for three consecutive runs while every run reported success
 * (#3833). The per-source barren-streak check cannot see it either, because the lane's other
 * tracks keep yielding and the source's own total never drops to zero.
 *
 * The distinction between a warning and a stage failure is this read: a track that never listed
 * anybody may simply be empty upstream, while a track that used to list PIs and now lists none is
 * unambiguously a defect. Fails open, returning false, because an unanswerable read must not
 * invent a failure.
 *
 * The read keys on a topic this track grafts rather than on the track URL, because a graft cites
 * the PI's profile page and never the track page, and no two tracks share a topic.
 */
async function defaultTrackEverListedPis(track: BbsTrack, sourceId: string): Promise<boolean> {
  if (mongoose.connection.readyState !== 1 || !mongoose.isValidObjectId(sourceId)) return false;
  const seen = await Observation.exists({
    sourceId,
    entityType: 'researchEntity',
    field: 'researchAreas',
    value: { $in: track.researchAreas },
  });
  return Boolean(seen);
}

async function defaultFetchPage(url: string, useCache: boolean): Promise<string | null> {
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, `page:${url}`);
    if (cached) return cached;
  }
  const safeUrl = await assertPublicHttpUrl(url);
  const agents = ssrfSafeAgents();
  const res = await retryOnRetryableStatus(() =>
    axios.get(safeUrl.toString(), {
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 5,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    }),
  );
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
  /** Selected only so the dead-arm check below can see whether the school arm matched. */
  school?: string;
  schools?: string[];
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
      school: 1,
      schools: 1,
    },
  )
    .sort({ _id: 1 })
    .limit(MAX_CANDIDATE_SCAN)
    .lean()) as BbsCandidateDoc[];
  // A predicate arm that matches nothing is how this lane lost reach silently for weeks, so it
  // is reported rather than left to be inferred from a shortfall in grafts (#3834).
  if (
    !docs.some((doc) => doc.school === SCHOOL_NAME || (doc.schools || []).includes(SCHOOL_NAME))
  ) {
    console.warn(
      `[bbs-research-track] no candidate row carries school ${JSON.stringify(SCHOOL_NAME)}, so only the slug-prefix arm is finding rows; the corpus may have renamed the school (#3834)`,
    );
  }
  return docs.map(candidateFromDoc);
}

export function profileFetchSummary(tally: BbsProfileFetchTally): string {
  return (
    `profiles at concurrency ${tally.concurrency}: ${tally.read} of ${tally.attempted} read, ` +
    `${tally.refused} refused with HTTP 403/429 (${tally.recovered} recovered on a retry, ${tally.lost} lost), ` +
    `${tally.failed} failed otherwise`
  );
}

export class BbsResearchTrackScraper implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'BBS research-track topical evidence for biomedical PIs';

  private readonly fetchPage: FetchBbsPageFn;
  private readonly entityFinder: BbsEntityFinderFn;
  private readonly trackEverListedPis: TrackEverListedPisFn;
  private readonly pause: (ms: number) => Promise<void>;

  constructor(deps: BbsResearchTrackScraperDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.entityFinder = deps.entityFinder || defaultEntityFinder;
    this.trackEverListedPis = deps.trackEverListedPis || defaultTrackEverListedPis;
    this.pause = deps.pause || realPause;
  }

  private async readProfile(pi: BbsTrackPi, ctx: ScraperContext): Promise<BbsProfileRead> {
    try {
      const html = await this.fetchPage(pi.profileUrl, ctx.options.useCache);
      return {
        status: 'read',
        links: html ? parseBbsProfileLinks(html, pi.profileUrl) : EMPTY_PROFILE_LINKS,
      };
    } catch (error) {
      const statusCode = fetchFailureStatusCode(error);
      if (statusCode !== undefined && PROFILE_REFUSAL_STATUS_CODES.has(statusCode)) {
        return { status: 'refused', statusCode };
      }
      ctx.log(`[${pi.profileSlug}] profile fetch failed: ${sanitizeLogValue(error)}`);
      return { status: 'failed' };
    }
  }

  private async readProfiles(
    targets: readonly BbsTrackPi[],
    ctx: ScraperContext,
  ): Promise<{ linksBySlug: Map<string, BbsProfileLinks>; tally: BbsProfileFetchTally }> {
    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );
    const tally: BbsProfileFetchTally = {
      concurrency,
      attempted: targets.length,
      read: 0,
      refused: 0,
      recovered: 0,
      lost: 0,
      failed: 0,
    };
    const linksBySlug = new Map<string, BbsProfileLinks>();
    const refused: BbsTrackPi[] = [];
    ctx.log(`Reading ${targets.length} PI profile(s) at source concurrency ${concurrency}`);
    await mapWithConcurrency(targets, concurrency, async (pi) => {
      const read = await this.readProfile(pi, ctx);
      if (read.status === 'read') {
        tally.read += 1;
        linksBySlug.set(pi.profileSlug, read.links);
      } else if (read.status === 'refused') {
        tally.refused += 1;
        refused.push(pi);
        ctx.log(`[${pi.profileSlug}] profile refused with HTTP ${read.statusCode}`);
      } else {
        tally.failed += 1;
      }
    });
    if (refused.length > 0) {
      ctx.log(
        `Retrying ${refused.length} refused profile(s) once after a ${BBS_REFUSED_PROFILE_RETRY_PAUSE_MS} ms pause`,
      );
      await this.pause(BBS_REFUSED_PROFILE_RETRY_PAUSE_MS);
      await mapWithConcurrency(refused, concurrency, async (pi) => {
        const read = await this.readProfile(pi, ctx);
        if (read.status === 'read') {
          tally.recovered += 1;
          tally.read += 1;
          linksBySlug.set(pi.profileSlug, read.links);
          return;
        }
        tally.lost += 1;
        if (read.status === 'refused') {
          ctx.log(`[${pi.profileSlug}] profile refused again with HTTP ${read.statusCode}`);
        }
      });
    }
    return { linksBySlug, tally };
  }

  private async collectTrackPis(ctx: ScraperContext): Promise<{
    pis: Map<string, BbsTrackPi>;
    emptyTrackFailures: string[];
    trackReads: BbsTrackRead[];
    unitYields: Record<string, number>;
  }> {
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()))
        : null;
    const byProfileSlug = new Map<string, BbsTrackPi>();
    const emptyTrackFailures: string[] = [];
    const trackReads: BbsTrackRead[] = [];
    const unitYields: Record<string, number> = {};
    for (const track of BBS_TRACKS) {
      if (onlyFilter && !onlyFilter.has(track.slug)) continue;
      let html: string | null;
      try {
        html = await this.fetchPage(track.url, ctx.options.useCache);
      } catch (error) {
        ctx.log(`[${track.slug}] track page fetch failed: ${sanitizeLogValue(error)}`);
        trackReads.push({ track, faculty: [], fetched: false });
        continue;
      }
      if (!html) {
        trackReads.push({ track, faculty: [], fetched: false });
        continue;
      }
      const faculty = parseBbsTrackFaculty(html, track.url);
      ctx.log(`[${track.slug}] ${faculty.length} faculty listed`);
      // Recorded only on the branch that actually read and parsed the page: a fetch
      // failure above leaves the track out, which the guard reads as inconclusive
      // rather than as a barren run for it (#3876).
      unitYields[track.slug] = faculty.length;
      trackReads.push({ track, faculty, fetched: true });
      if (faculty.length === 0) {
        // A warning whatever the history, so an empty track is never silent again.
        ctx.log(
          `[${track.slug}] WARNING: this track listed no faculty; the page shape or the parser changed (#3833)`,
        );
        if (await this.trackEverListedPis(track, ctx.sourceId)) {
          // An error only here, because this track has listed PIs before, so zero is a defect
          // rather than an empty programme. It names the track and reaches the run's errors, which
          // fails this lane's stage; every other source is its own subprocess and still runs.
          emptyTrackFailures.push(
            `${track.slug} listed no faculty but has listed PIs before, so the track page or the parser is broken (#3833)`,
          );
        }
      }
      for (const ref of faculty) {
        const existing = byProfileSlug.get(ref.profileSlug);
        if (existing) {
          for (const area of track.researchAreas) {
            if (!existing.researchAreas.includes(area)) existing.researchAreas.push(area);
          }
        } else {
          byProfileSlug.set(ref.profileSlug, {
            name: ref.name,
            profileSlug: ref.profileSlug,
            profileUrl: ref.profileUrl,
            researchAreas: [...track.researchAreas],
          });
        }
      }
    }
    return { pis: byProfileSlug, emptyTrackFailures, trackReads, unitYields };
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? Infinity;

    const { pis, emptyTrackFailures, trackReads, unitYields } = await this.collectTrackPis(ctx);
    const candidates = await this.entityFinder();
    const index = buildBbsMatchIndex(candidates);

    // Filled as the graft resolves each PI, so the snapshots below can name the row each listed PI
    // claims on. A listed PI absent from this map did not resolve to a row this run.
    const claimEntityKeyByProfileSlug = new Map<string, string>();
    const citedProfileUrlByProfileSlug = new Map<string, string>();
    let observationCount = 0;
    let grafted = 0;
    let noExistingRow = 0;
    let ambiguous = 0;
    let citedByAnotherPerson = 0;

    const targets = [...pis.values()].slice(0, Number.isFinite(limit) ? limit : undefined);
    const { linksBySlug, tally } = await this.readProfiles(targets, ctx);

    for (const pi of targets) {
      const links = linksBySlug.get(pi.profileSlug) ?? EMPTY_PROFILE_LINKS;
      citedProfileUrlByProfileSlug.set(pi.profileSlug, links.canonicalProfileUrl || pi.profileUrl);

      const resolution = resolveBbsResearchHome(
        links,
        facultyNameMatchKey(pi.name),
        index,
        pi.profileSlug,
      );

      if (resolution.status === 'ambiguous') {
        ambiguous += 1;
        continue;
      }

      if (resolution.status === 'refused') {
        citedByAnotherPerson += 1;
        continue;
      }

      if (resolution.status === 'unmatched') {
        noExistingRow += 1;
        continue;
      }

      claimEntityKeyByProfileSlug.set(pi.profileSlug, resolution.entityId);
      const observations = bbsGraftObservations(
        resolution.entityId,
        pi.researchAreas,
        links.canonicalProfileUrl || pi.profileUrl,
        index.slugByEntityId.get(resolution.entityId),
      );
      if (observations.length === 0) continue;
      await ctx.emit(observations);
      observationCount += observations.length;
      grafted += 1;
    }

    // Emitted after the graft, because a snapshot has to name the row each listed PI claims on and
    // that is only known once the PI has been resolved (#3852).
    const readAt = new Date();
    const rosterHealth = trackReads.map((read) =>
      buildTrackRosterHealthObservation({
        track: read.track,
        faculty: read.faculty,
        fetched: read.fetched,
        claimEntityKeyByProfileSlug,
        citedProfileUrlByProfileSlug,
        cacheAllowed: ctx.options.useCache,
        readAt,
      }),
    );
    if (rosterHealth.length > 0) {
      await ctx.emit(rosterHealth);
      observationCount += rosterHealth.length;
    }

    const partialFailures = [...emptyTrackFailures];
    if (tally.lost > 0) {
      partialFailures.push(
        `${tally.lost} BBS profile page(s) stayed refused or unreadable after a retry, so those PIs resolved on the name path alone (#3835)`,
      );
    }

    return {
      observationCount,
      entitiesObserved: grafted,
      // Per-track counts for the general per-unit barren-streak check (#3876). The
      // lane's own empty-track failure above stays: it fires on the first barren run
      // for a track that has listed PIs before, where the general rule waits for the
      // streak, so deferring to it would cost two runs of detection on the one unit
      // class known to have broken (#3833).
      metrics: { unitYields },
      ...(partialFailures.length > 0 ? { partialFailures } : {}),
      notes:
        `rows enriched: ${grafted} of ${pis.size} track PIs; not attached: ` +
        `${noExistingRow} have no existing research row (a track listing never mints one, #3561), ` +
        `${citedByAnotherPerson} cite a lab URL only on a row naming someone else, ` +
        `${ambiguous} ambiguous row; ${profileFetchSummary(tally)}.`,
    };
  }
}
