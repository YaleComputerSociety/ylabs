/**
 * OpenAlexPaperScraper
 *
 * Pulls papers authored by Yale faculty from OpenAlex (https://api.openalex.org/).
 * Yale's OpenAlex institution ID is I32971472 (ROR 03v76x132).
 *
 * Lookup precedence (per faculty member, first hit wins):
 *   1. ORCID — query `?filter=author.orcid:<orcid>`. Most reliable; ORCID is the
 *      canonical author identifier, so it wins whenever present even if we already
 *      have an openAlexId (the ORCID may pick up co-author works the OpenAlex
 *      profile is missing for humanities/social-sci faculty whose institutional
 *      affiliation tagging is patchy).
 *   2. openAlexId — query `?filter=author.id:<openAlexId>` (legacy fast path).
 *   3. Name + Yale-affiliation search — query the `/authors` endpoint scoped to
 *      Yale (institution I32971472) and accept ONLY when there is exactly one
 *      result whose display_name matches `<fname> <lname>` exactly (case-
 *      insensitive, ignoring middle names). When this succeeds we also emit a
 *      `openAlexId` observation against the User so the next run takes the fast
 *      path. Otherwise the candidate is skipped (we will not guess on ambiguous
 *      name matches).
 *
 * Faculty selection: any User with userType in ['professor', 'faculty'] AND at
 * least one of {orcid, openAlexId} OR fname + lname (so the name-search fallback
 * can run). Users with no usable signals are filtered out.
 *
 * For each work, emit Observations on a Paper entity keyed by openAlexId. The
 * materializer upserts the Paper and links to yaleAuthorIds.
 *
 * Uses the polite pool by passing a contact email via the `mailto` query parameter
 * (configured by OPENALEX_CONTACT_EMAIL env var, defaults to info@yalelabs.io).
 *
 * Honors --use-cache (memoizes per-author page fetches and per-author lookups),
 * --only (netid allowlist), --offset, and --limit. Name-only author discovery is
 * opt-in through --discover-openalex-authors because it can fan out into many
 * slow sequential OpenAlex calls.
 */
import axios from 'axios';
import { User } from '../../models/user';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';
import {
  PAPER_AUTHORSHIP_EVIDENCE_FIELD,
  type PaperAuthorshipEvidence,
} from '../paperAuthorshipPolicy';

const OPENALEX_BASE = 'https://api.openalex.org';
const PAGE_SIZE = 200;
const YALE_INSTITUTION_ID = 'I32971472';
const OBSERVATION_EMIT_BATCH_SIZE = 1000;

interface OpenAlexAuthorship {
  author?: { id?: string; display_name?: string; orcid?: string };
  institutions?: { id?: string; display_name?: string; ror?: string }[];
  raw_affiliation_strings?: string[];
}

interface OpenAlexWork {
  id: string;
  ids?: Record<string, string | undefined>;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  cited_by_count?: number;
  authorships?: OpenAlexAuthorship[];
  primary_location?: {
    source?: { display_name?: string };
    landing_page_url?: string;
    pdf_url?: string;
  };
  locations?: {
    landing_page_url?: string;
    pdf_url?: string;
    source?: { display_name?: string };
  }[];
  open_access?: { is_oa?: boolean; oa_status?: string; oa_url?: string };
  abstract_inverted_index?: Record<string, number[]>;
  topics?: { display_name?: string; field?: { display_name?: string } }[];
  concepts?: { display_name?: string; level?: number }[];
}

interface OpenAlexAuthorRecord {
  id?: string;
  display_name?: string;
  orcid?: string;
  affiliations?: {
    institution?: { id?: string; display_name?: string };
  }[];
  last_known_institutions?: { id?: string; display_name?: string }[];
}

/** Minimal HTTP fetcher contract — accepts (url, params) returns body. Lets tests inject. */
export type HttpFetcher = (url: string, params: Record<string, string>) => Promise<unknown>;

const defaultFetcher: HttpFetcher = async (url, params) => {
  const res = await axios.get(url, { params, timeout: 30000 });
  return res.data;
};

function reconstructAbstract(inverted?: Record<string, number[]>): string | undefined {
  if (!inverted) return undefined;
  const positions: { word: string; pos: number }[] = [];
  for (const [word, posList] of Object.entries(inverted)) {
    for (const pos of posList) positions.push({ word, pos });
  }
  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(' ') || undefined;
}

function normalizeDoi(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const normalized = String(raw)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .toLowerCase();
  return normalized || undefined;
}

function normalizeOpenAlexWorkId(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const id = String(raw).trim();
  return id || undefined;
}

function normalizeArxivId(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const normalized = String(raw)
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, '')
    .replace(/^arxiv:/i, '')
    .replace(/v\d+$/i, '');
  return normalized || undefined;
}

function arxivIdFromUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const match = String(raw).match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s.]+(?:\.\d+)?)/i);
  return normalizeArxivId(match?.[1]);
}

function extractArxivId(work: OpenAlexWork): string | undefined {
  const ids = work.ids || {};
  const fromIds =
    normalizeArxivId(ids.arxiv) ||
    normalizeArxivId(ids.arxiv_id) ||
    normalizeArxivId(ids.arxivId);
  if (fromIds) return fromIds;

  const urls = [
    work.primary_location?.landing_page_url,
    work.primary_location?.pdf_url,
    ...(work.locations || []).flatMap((location) => [
      location.landing_page_url,
      location.pdf_url,
    ]),
  ];
  return urls.map(arxivIdFromUrl).find(Boolean);
}

function buildExternalIds(work: OpenAlexWork): Record<string, string> {
  const ids: Record<string, string> = {};
  const openAlex = normalizeOpenAlexWorkId(work.id);
  const doi = normalizeDoi(work.doi || work.ids?.doi);
  const arxiv = extractArxivId(work);
  if (openAlex) ids.openalex = openAlex;
  if (doi) ids.DOI = doi;
  if (arxiv) ids.arxiv = arxiv;
  if (work.ids?.pmid) ids.PMID = work.ids.pmid;
  if (work.ids?.pmcid) ids.PMCID = work.ids.pmcid;
  return ids;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable in isolation)
// ---------------------------------------------------------------------------

/** Strip the canonical OpenAlex URL form down to a bare ID like "A1234". */
export function normalizeOpenAlexId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\/openalex\.org\//i, '').trim() || null;
}

/** Normalize ORCIDs to the bare 16-digit form (no URL prefix). */
export function normalizeOrcid(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\/orcid\.org\//i, '').trim() || null;
}

/** Lower-case + collapse whitespace name — used for exact comparisons. */
export function normalizeNameForCompare(s: string | undefined | null): string {
  if (!s) return '';
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Given a Yale faculty's first + last name, return all reasonable case-
 * insensitive forms an OpenAlex author display_name might take. We tolerate
 * middle names/initials in the OpenAlex record but require first + last to
 * match exactly.
 */
export function isExactNameMatch(
  candidateDisplayName: string | undefined,
  fname: string,
  lname: string,
): boolean {
  const cand = normalizeNameForCompare(candidateDisplayName);
  const f = normalizeNameForCompare(fname);
  const l = normalizeNameForCompare(lname);
  if (!cand || !f || !l) return false;
  // Tokens of the candidate's display_name.
  const tokens = cand.split(' ').filter(Boolean);
  if (tokens.length < 2) return false;
  // First token == fname, last token == lname (allow middle names/initials between).
  return tokens[0] === f && tokens[tokens.length - 1] === l;
}

// ---------------------------------------------------------------------------
// Author-id lookups (each pure, with injectable fetcher)
// ---------------------------------------------------------------------------

/**
 * Look up the OpenAlex author id given an ORCID. Returns the full OpenAlex
 * id (URL form, e.g. "https://openalex.org/A123") or null when no match.
 *
 * Uses the `/works` endpoint with `author.orcid` filter and inspects the first
 * result's authorships to find the Yale-side author id; falls back to the
 * `/authors` endpoint if needed.
 */
export async function lookupAuthorIdByOrcid(
  orcid: string,
  email: string,
  fetcher: HttpFetcher = defaultFetcher,
): Promise<string | null> {
  const cleanOrcid = normalizeOrcid(orcid);
  if (!cleanOrcid) return null;
  try {
    const data = (await fetcher(`${OPENALEX_BASE}/authors`, {
      filter: `orcid:${cleanOrcid}`,
      'per-page': '5',
      mailto: email,
    })) as { results?: OpenAlexAuthorRecord[] };
    const results = data?.results || [];
    if (results.length === 0) return null;
    // ORCID is unique; take the first result.
    const id = results[0]?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/**
 * Look up the OpenAlex author id given a Yale faculty's first + last name.
 * Restricts the search to Yale-affiliated authors and returns an id ONLY when
 * exactly one candidate's display_name matches the expected name exactly
 * (case-insensitive, middle-name-tolerant). Returns null on ambiguity, no
 * matches, or non-exact display_name.
 */
export async function lookupAuthorIdByName(
  fname: string,
  lname: string,
  email: string,
  fetcher: HttpFetcher = defaultFetcher,
): Promise<string | null> {
  const f = (fname || '').trim();
  const l = (lname || '').trim();
  if (!f || !l) return null;
  const search = `${f} ${l}`;
  try {
    const data = (await fetcher(`${OPENALEX_BASE}/authors`, {
      search,
      filter: `affiliations.institution.id:${YALE_INSTITUTION_ID}`,
      'per-page': '5',
      mailto: email,
    })) as { results?: OpenAlexAuthorRecord[] };
    const results = data?.results || [];
    if (results.length === 0) return null;
    const exact = results.filter((r) => isExactNameMatch(r.display_name, f, l));
    if (exact.length !== 1) return null; // require exactly one exact match
    const id = exact[0]?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Works fetching
// ---------------------------------------------------------------------------

async function fetchPage(
  authorId: string,
  cursor: string,
  email: string,
  ctx: ScraperContext,
  fetcher: HttpFetcher = defaultFetcher,
): Promise<{ results: OpenAlexWork[]; nextCursor: string | null }> {
  const cacheKey = `author:${authorId}:cursor:${cursor}`;
  if (ctx.options.useCache) {
    const cached = await getCached<{ results: OpenAlexWork[]; nextCursor: string | null }>(
      'openalex',
      cacheKey,
    );
    if (cached) return cached;
  }
  const params: Record<string, string> = {
    filter: `author.id:${authorId}`,
    'per-page': String(PAGE_SIZE),
    cursor,
    mailto: email,
  };
  const data = (await fetcher(`${OPENALEX_BASE}/works`, params)) as {
    results?: OpenAlexWork[];
    meta?: { next_cursor?: string | null };
  };
  const payload = {
    results: (data?.results as OpenAlexWork[]) || [],
    nextCursor: data?.meta?.next_cursor || null,
  };
  if (ctx.options.useCache) {
    await setCached('openalex', cacheKey, payload);
  }
  return payload;
}

function workToObservations(
  work: OpenAlexWork,
  sourceUrl: string,
  authorshipEvidence?: PaperAuthorshipEvidence,
): ObservationInput[] {
  const openAlexId = work.id;
  const out: ObservationInput[] = [];
  const baseId = { entityType: 'paper' as const, entityKey: openAlexId, sourceUrl };
  const doi = normalizeDoi(work.doi || work.ids?.doi);
  const arxivId = extractArxivId(work);
  const externalIds = buildExternalIds(work);

  const fields: Array<[string, unknown]> = [
    ['openAlexId', openAlexId],
    ['arxivId', arxivId],
    ['title', work.title || work.display_name],
    ['doi', doi],
    ['year', work.publication_year],
    ['publishedAt', work.publication_date ? new Date(work.publication_date) : undefined],
    ['venue', work.primary_location?.source?.display_name],
    ['citationCount', work.cited_by_count ?? 0],
    ['abstract', reconstructAbstract(work.abstract_inverted_index)],
    ['url', `https://openalex.org/${(openAlexId || '').replace(/^https?:\/\/openalex\.org\//, '')}`],
    ['isOpenAccess', work.open_access?.is_oa],
    ['openAccessStatus', work.open_access?.oa_status],
    ['openAccessUrl', work.open_access?.oa_url],
    [
      'authors',
      (work.authorships || [])
        .map((a) => a.author?.display_name)
        .filter(Boolean) as string[],
    ],
    [
      'fieldsOfStudy',
      Array.from(
        new Set(
          [
            ...(work.topics || []).map((t) => t.field?.display_name).filter(Boolean),
            ...(work.concepts || [])
              .filter((c) => (c.level ?? 99) <= 1)
              .map((c) => c.display_name)
              .filter(Boolean),
          ] as string[],
        ),
      ),
    ],
    ['externalIds', externalIds],
  ];

  for (const [field, value] of fields) {
    if (value === undefined || value === null || value === '') continue;
    out.push({ ...baseId, field, value });
  }

  if (authorshipEvidence) {
    out.push({
      ...baseId,
      field: PAPER_AUTHORSHIP_EVIDENCE_FIELD,
      value: authorshipEvidence,
      confidenceOverride: authorshipEvidence.confidence,
    });
  }
  out.push({ ...baseId, field: 'sources', value: ['openalex'] });

  return out;
}

// ---------------------------------------------------------------------------
// Lookup-precedence resolver — encapsulates the 3-tier strategy and reports
// which tier won. Pure with respect to its injected fetcher; reads cache via
// snapshotCache when ctx.options.useCache is set.
// ---------------------------------------------------------------------------

export type LookupMethod = 'orcid' | 'openAlexId' | 'name' | 'none';

export interface ResolvedAuthor {
  authorId: string | null;
  method: LookupMethod;
}

function buildOpenAlexAuthorshipEvidence(
  fac: any,
  resolved: ResolvedAuthor,
  sourceUrl: string,
): PaperAuthorshipEvidence | undefined {
  if (!resolved.authorId) return undefined;
  if (resolved.method !== 'orcid' && resolved.method !== 'openAlexId') return undefined;

  const displayName = `${String(fac.fname || '').trim()} ${String(fac.lname || '').trim()}`.trim();
  if (!displayName) return undefined;
  return {
    userId: String(fac._id),
    netid: fac.netid ? String(fac.netid) : undefined,
    displayName,
    sourceName: 'openalex',
    method: resolved.method === 'orcid' ? 'openalex-orcid' : 'openalex-author-id',
    externalAuthorIds: {
      openAlex: resolved.authorId,
      ...(normalizeOrcid(fac.orcid) ? { orcid: normalizeOrcid(fac.orcid)! } : {}),
    },
    confidence: resolved.method === 'orcid' ? 0.95 : 0.9,
    sourceUrl,
    observedAt: new Date(),
  };
}

interface FacultyRecord {
  fname?: string;
  lname?: string;
  orcid?: string;
  openAlexId?: string;
}

export async function resolveAuthorIdForFaculty(
  fac: FacultyRecord,
  email: string,
  ctx: ScraperContext,
  fetcher: HttpFetcher = defaultFetcher,
  allowNameSearch = true,
): Promise<ResolvedAuthor> {
  // Tier 1: ORCID (most reliable when present).
  const orcid = normalizeOrcid(fac.orcid);
  if (orcid) {
    const cacheKey = `orcid:${orcid}:cursor:*`;
    let id: string | null = null;
    if (ctx.options.useCache) {
      const cached = await getCached<{ authorId: string | null }>('openalex', cacheKey);
      if (cached) id = cached.authorId;
    }
    if (!id) {
      id = await lookupAuthorIdByOrcid(orcid, email, fetcher);
      if (ctx.options.useCache) {
        await setCached('openalex', cacheKey, { authorId: id });
      }
    }
    if (id) return { authorId: id, method: 'orcid' };
  }

  // Tier 2: existing openAlexId.
  const existingId = normalizeOpenAlexId(fac.openAlexId);
  if (existingId) {
    return { authorId: `https://openalex.org/${existingId}`, method: 'openAlexId' };
  }

  // Tier 3: name + Yale affiliation search.
  const f = (fac.fname || '').trim();
  const l = (fac.lname || '').trim();
  if (allowNameSearch && f && l) {
    const cacheKey = `name-author:${l}-${f}`;
    let id: string | null = null;
    if (ctx.options.useCache) {
      const cached = await getCached<{ authorId: string | null }>('openalex', cacheKey);
      if (cached) id = cached.authorId;
    }
    if (!id) {
      id = await lookupAuthorIdByName(f, l, email, fetcher);
      if (ctx.options.useCache) {
        await setCached('openalex', cacheKey, { authorId: id });
      }
    }
    if (id) return { authorId: id, method: 'name' };
  }

  return { authorId: null, method: 'none' };
}

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export interface OpenAlexPaperScraperOptions {
  /** Inject a custom User model (used by tests to mock the DB). */
  userModel?: { find: typeof User.find };
  /** Inject the HTTP fetcher (used by tests to mock axios). */
  fetcher?: HttpFetcher;
}

function parseRunIntegerOption(
  value: number | undefined,
  flag: string,
  options: { min: number; label: 'positive' | 'non-negative' },
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < options.min) {
    throw new Error(`${flag} must be a safe ${options.label} integer`);
  }
  return value;
}

export class OpenAlexPaperScraper implements IScraper {
  readonly name = 'openalex';
  readonly displayName = 'OpenAlex paper sync';

  constructor(private readonly opts: OpenAlexPaperScraperOptions = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const offsetOption = parseRunIntegerOption(ctx.options.offset, '--offset', {
      min: 0,
      label: 'non-negative',
    });
    const limitOption = parseRunIntegerOption(ctx.options.limit, '--limit', {
      min: 1,
      label: 'positive',
    });
    const maxPagesOption = parseRunIntegerOption(
      ctx.options.maxOpenAlexPagesPerAuthor,
      '--max-openalex-pages-per-author',
      { min: 1, label: 'positive' },
    );
    const email = process.env.OPENALEX_CONTACT_EMAIL || 'info@yalelabs.io';
    const fetcher = this.opts.fetcher || defaultFetcher;
    const userModel = this.opts.userModel || User;

    // Faculty filter: include anyone with userType in [professor, faculty]
    // and at least one of {orcid, openAlexId, fname+lname}. Mongo can't do
    // the fname+lname conjunction cleanly here without {} matching everything,
    // so we filter in JS after the broad fetch — fname/lname are required on
    // the User schema anyway.
    const identifierBackedFilters = [
      { orcid: { $exists: true, $ne: null, $nin: [''] } },
      { openAlexId: { $exists: true, $ne: null, $nin: [''] } },
    ];
    const facultyFilter: any = {
      userType: { $in: ['professor', 'faculty'] },
      $or: ctx.options.discoverOpenAlexAuthors
        ? [
            ...identifierBackedFilters,
            // Anyone with userType professor/faculty is name-eligible (fname+lname required by schema).
            { fname: { $exists: true, $nin: [null, ''] } },
          ]
        : identifierBackedFilters,
    };
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((s) => s.trim().toLowerCase()).filter(Boolean))
        : null;
    if (onlyFilter) {
      facultyFilter.netid = { $in: Array.from(onlyFilter) };
    }
    const facultyQuery = userModel
      .find(facultyFilter, {
        _id: 1,
        netid: 1,
        fname: 1,
        lname: 1,
        orcid: 1,
        openAlexId: 1,
      })
      .lean();
    let faculty: any[] = await facultyQuery;
    if (!ctx.options.discoverOpenAlexAuthors) {
      faculty = faculty.filter(
        (fac) => normalizeOrcid(fac.orcid) || normalizeOpenAlexId(fac.openAlexId),
      );
    }
    if (onlyFilter) {
      faculty = faculty.filter((fac) => onlyFilter.has(String(fac.netid || '').toLowerCase()));
    }
    faculty = faculty.sort((a, b) => {
      const aKey = `${String(a.netid || '').toLowerCase()}\u0000${String(a._id || '')}`;
      const bKey = `${String(b.netid || '').toLowerCase()}\u0000${String(b._id || '')}`;
      return aKey.localeCompare(bKey);
    });
    const totalEligibleFaculty = faculty.length;
    const offset = offsetOption && offsetOption > 0 ? offsetOption : 0;
    const limit = limitOption;
    faculty = faculty.slice(offset, limit ? offset + limit : undefined);
    ctx.log(
      `Faculty candidates for OpenAlex sync: ${faculty.length} (eligible ${totalEligibleFaculty}, offset ${offset}${limit ? `, limit ${limit}` : ''})`,
    );
    if (!ctx.options.discoverOpenAlexAuthors) {
      ctx.log(
        'Name-only OpenAlex author discovery disabled; pass --discover-openalex-authors to opt in.',
      );
    }

    let totalObs = 0;
    let totalWorks = 0;
    let processed = 0;
    const pendingObservations: ObservationInput[] = [];
    const flushObservations = async () => {
      if (pendingObservations.length === 0) return;
      const batch = pendingObservations.splice(0, pendingObservations.length);
      await ctx.emit(batch);
    };
    const queueObservations = async (observations: ObservationInput | ObservationInput[]) => {
      const batch = Array.isArray(observations) ? observations : [observations];
      if (batch.length === 0) return;
      pendingObservations.push(...batch);
      totalObs += batch.length;
      if (pendingObservations.length >= OBSERVATION_EMIT_BATCH_SIZE) {
        await flushObservations();
      }
    };
    const tierCounts: Record<LookupMethod, number> = {
      orcid: 0,
      openAlexId: 0,
      name: 0,
      none: 0,
    };

    for (const fac of faculty) {
      const yaleNetId = fac.netid;

      const resolved = await resolveAuthorIdForFaculty(
        {
          fname: fac.fname,
          lname: fac.lname,
          orcid: fac.orcid,
          openAlexId: fac.openAlexId,
        },
        email,
        ctx,
        fetcher,
        !!ctx.options.discoverOpenAlexAuthors,
      );
      tierCounts[resolved.method]++;

      if (!resolved.authorId) {
        processed++;
        if (processed % 25 === 0 || processed === faculty.length) {
          ctx.log(
            `progress: ${processed}/${faculty.length} faculty | ${totalWorks} works | ${totalObs} observations`,
          );
        }
        continue;
      }

      if (resolved.method === 'name') {
        ctx.log(
          `review-only OpenAlex author candidate for ${yaleNetId || fac.fname}: ${resolved.authorId}; not writing openAlexId or paper authorship`,
        );
        processed++;
        if (processed % 25 === 0 || processed === faculty.length) {
          ctx.log(
            `progress: ${processed}/${faculty.length} faculty | ${totalWorks} works | ${totalObs} observations`,
          );
        }
        continue;
      }

      const authorId = resolved.authorId;
      let cursor = '*';
      let pages = 0;
      let worksForAuthor = 0;
      const seenCursors = new Set<string>();
      const maxPages = maxPagesOption;

      while (cursor) {
        if (seenCursors.has(cursor)) {
          ctx.log(`stopping ${yaleNetId}: repeated OpenAlex cursor "${cursor}"`);
          break;
        }
        seenCursors.add(cursor);
        if (maxPages && pages >= maxPages) {
          ctx.log(`stopping ${yaleNetId}: reached ${maxPages} OpenAlex page(s)`);
          break;
        }
        try {
          const sourceUrl = `${OPENALEX_BASE}/works?filter=author.id:${authorId}&cursor=${cursor}`;
          const { results, nextCursor } = await fetchPage(authorId, cursor, email, ctx, fetcher);
          pages++;
          for (const work of results) {
            const obs = workToObservations(
              work,
              sourceUrl,
              buildOpenAlexAuthorshipEvidence(fac, resolved, sourceUrl),
            );
            await queueObservations(obs);
            worksForAuthor++;
          }
          cursor = nextCursor || '';
          if (!nextCursor) break;
        } catch (err: any) {
          ctx.log(`error fetching for ${yaleNetId}: ${err?.message || err}`);
          break;
        }
      }
      totalWorks += worksForAuthor;
      if (yaleNetId) {
        await queueObservations({
          entityType: 'user',
          entityKey: String(yaleNetId),
          field: 'openAlexWorksSyncedAt',
          value: new Date(),
          sourceUrl: `${OPENALEX_BASE}/authors/${normalizeOpenAlexId(authorId) || authorId}`,
        });
      }
      processed++;
      if (processed % 25 === 0 || processed === faculty.length) {
        ctx.log(
          `progress: ${processed}/${faculty.length} faculty | ${totalWorks} works | ${totalObs} observations`,
        );
      }
    }
    await flushObservations();

    ctx.log(
      `lookup methods — orcid: ${tierCounts.orcid}, openAlexId: ${tierCounts.openAlexId}, name: ${tierCounts.name}, skipped (no signals): ${tierCounts.none}`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: totalWorks,
      notes: `Synced papers for ${processed} faculty (${totalWorks} works total). Lookup tiers — orcid:${tierCounts.orcid}, openAlexId:${tierCounts.openAlexId}, name:${tierCounts.name}, skipped:${tierCounts.none}`,
    };
  }
}
