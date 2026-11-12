import mongoose from 'mongoose';
import { ResearchEntity } from '../../models/researchEntity';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  computeVersionedContentHash,
  contentHashObservation,
  contentUnchanged,
  loadStoredContentHash,
  type ContentHashEntityRef,
} from '../contentHashGate';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../utils/mapWithConcurrency';
import { personProfileSourceMatchesEntity } from '../utils/personProfileEntityMatch';
import {
  RESEARCH_PAGE_TEXT_CONTRACT,
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
  researchPageTextValue,
  type ResearchPageTextEntry,
} from '../utils/researchPageText';
import { normalizeEvidenceUrl } from '../utils/sharedEvidenceUrls';
import { DEFAULT_DEPT_CONFIGS } from './departmentRosterScraper';
import {
  isSharedAreaFilteredDirectoryUrl,
  loadEvidenceUrlCiterCounts,
} from './researchAreaSourceExtractor';
import {
  candidateDescriptionLabsFromDocs,
  fetchDescriptionPageWithTlsFallback,
  isRefusedDescriptionLaneSourceUrl,
  researchSubPageCrawlUrls,
  type CandidateDescriptionLab,
  type CandidateDescriptionLabDoc,
  type FetchedDescriptionPage,
} from './labMicrositeDescriptionLLMExtractor';
import { mongooseConnectionWasOpened } from '../../utils/mongooseConnectionWasOpened';

const MAX_PAGES_PER_ROW = 6;
const MAX_RESEARCH_SUBPAGES = 2;
const DEFAULT_ROW_LIMIT = 100;
const RESEARCH_PAGE_TEXT_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const NO_MODEL = 'no-model';

const CONFIGURED_DEPARTMENT_LISTING_PAGES: ReadonlySet<string> = new Set(
  DEFAULT_DEPT_CONFIGS.flatMap((config) => [config.url, config.dataUrl])
    .map((url) => normalizeEvidenceUrl(url))
    .filter(Boolean),
);

/**
 * A page that lists many people is nobody's research page, so a row citing one would store a
 * department's research areas as its own (#5707): the roster lane's configured department
 * listing pages, and the shared area-filtered directory pages the research-areas lane already
 * refuses (#4030).
 */
export function isSharedListingCitation(
  url: string,
  row: Pick<CandidateDescriptionLab, 'slug' | 'name'> & { displayName?: string },
  citerCounts: ReadonlyMap<string, number>,
): boolean {
  if (CONFIGURED_DEPARTMENT_LISTING_PAGES.has(normalizeEvidenceUrl(url))) return true;
  return isSharedAreaFilteredDirectoryUrl(
    url,
    { slug: row.slug, name: row.name, displayName: row.displayName },
    citerCounts,
  );
}

export async function loadConnectedEvidenceUrlCiterCounts(): Promise<ReadonlyMap<string, number>> {
  if (!mongooseConnectionWasOpened()) return new Map();
  return loadEvidenceUrlCiterCounts();
}

const HOME_PAGE_LEAF = /^(?:home|welcome|index|default)(?:\.(?:s?html?|php|aspx?))?$/i;

/**
 * Whether a research subpage sits inside the home page's own subtree, so a shared host's section
 * or school "Research" link in the navigation is never read as the row's research (#5707), as
 * the about-page crawl already requires (#2957). A home path ending in a home, welcome or index
 * leaf is rooted at its folder, and the home URL is the one read after redirects.
 */
export function researchSubPageIsWithinHome(candidateUrl: string, homeUrl: string): boolean {
  let candidate: URL;
  let home: URL;
  try {
    candidate = new URL(candidateUrl);
    home = new URL(homeUrl);
  } catch {
    return false;
  }
  const host = (url: URL) => url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host(candidate) !== host(home)) return false;
  const segments = home.pathname.split('/').filter(Boolean);
  if (segments.length > 0 && HOME_PAGE_LEAF.test(segments[segments.length - 1])) segments.pop();
  const root = `/${segments.join('/')}${segments.length > 0 ? '/' : ''}`.toLowerCase();
  return candidate.pathname.toLowerCase().startsWith(root);
}

export function normalizeResearchPageTextObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return RESEARCH_PAGE_TEXT_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

export type FetchResearchPageFn = (url: string) => Promise<FetchedDescriptionPage | null>;
export type ResearchPageTextRowFinderFn = (options: {
  only: string[];
  exhaustive?: boolean;
}) => Promise<CandidateDescriptionLab[]>;
export type StoredContentHashLoaderFn = (
  sourceName: string,
  entity: ContentHashEntityRef,
) => Promise<string | undefined>;

export interface ResearchPageTextScraperDeps {
  fetchPage?: FetchResearchPageFn;
  rowFinder?: ResearchPageTextRowFinderFn;
  storedHashLoader?: StoredContentHashLoaderFn;
  citerCountsLoader?: () => Promise<ReadonlyMap<string, number>>;
}

async function fetchPageOnce(url: string): Promise<FetchedDescriptionPage | null> {
  const page = await fetchPageWithPolicy(url, {
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    timeoutMs: 10_000,
  });
  return { url: page.url, html: page.html };
}

function defaultFetchPage(url: string): Promise<FetchedDescriptionPage | null> {
  return fetchDescriptionPageWithTlsFallback(url, fetchPageOnce);
}

async function defaultRowFinder(options: {
  only: string[];
  exhaustive?: boolean;
}): Promise<CandidateDescriptionLab[]> {
  const onlyObjectIds = options.only
    .map((value) => normalizeResearchPageTextObjectId(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const identityFilter = options.only.length
    ? {
        $or: [
          ...(onlyObjectIds.length ? [{ _id: { $in: onlyObjectIds } }] : []),
          { slug: { $in: options.only } },
          { name: { $in: options.only } },
        ],
      }
    : {};
  const docs = await ResearchEntity.find(
    {
      $and: [
        { archived: { $ne: true } },
        {
          $or: [
            { websiteUrl: /^https?:\/\//i },
            { website: /^https?:\/\//i },
            { sourceUrls: /^https?:\/\//i },
          ],
        },
        identityFilter,
      ],
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      entityType: 1,
      kind: 1,
      'fieldProvenance.fullDescription.sourceUrl': 1,
    },
  ).lean();
  return candidateDescriptionLabsFromDocs(docs as CandidateDescriptionLabDoc[], {
    only: options.only,
  });
}

function isPersonProfileUrl(url: string): boolean {
  try {
    return /\/(?:profile|people)\//i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const uniqueStrings = (values: readonly (string | undefined)[]): string[] =>
  Array.from(new Set(values.map((value) => (value ?? '').trim()).filter(Boolean)));

export function researchPageTextContentHash(value: readonly ResearchPageTextEntry[]): string {
  return computeVersionedContentHash(JSON.stringify(value), RESEARCH_PAGE_TEXT_CONTRACT, NO_MODEL);
}

interface LaneCounts {
  rowsWithText: number;
  rowsWithoutText: number;
  noReadablePage: number;
  contentUnchanged: number;
  charsStored: number;
}

/**
 * Reads a research entity's own cited research pages with code and stores what they say
 * about its research as one `researchPageText` observation: the research statement of each
 * page, contact details redacted, capped near 16 KB per row (#5296, #5396). No model reads
 * the pages here; a model may read the stored text later, at materialization, through
 * `research-topics:derive`.
 *
 * The same pages always yield the same observation, and an unchanged reading is skipped by
 * the content-hash gate. A row whose home page was read but states no research gets an
 * empty reading that asserts the field has no value, so text an earlier run stored, and
 * any derivation made from it, stop applying.
 */
export class ResearchPageTextScraper implements IScraper {
  readonly name = RESEARCH_PAGE_TEXT_SOURCE;
  readonly displayName = 'Research page text (deterministic)';

  private readonly fetchPage: FetchResearchPageFn;
  private readonly rowFinder: ResearchPageTextRowFinderFn;
  private readonly storedHashLoader: StoredContentHashLoaderFn;
  private readonly citerCountsLoader: () => Promise<ReadonlyMap<string, number>>;

  constructor(deps: ResearchPageTextScraperDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.rowFinder = deps.rowFinder || defaultRowFinder;
    this.storedHashLoader = deps.storedHashLoader || loadStoredContentHash;
    this.citerCountsLoader = deps.citerCountsLoader || loadConnectedEvidenceUrlCiterCounts;
  }

  private async tryFetch(url: string, row: CandidateDescriptionLab, ctx: ScraperContext) {
    try {
      const page = await this.fetchPage(url);
      if (!page?.html) return null;
      return personProfileSourceMatchesEntity(page.url, row) ? page : null;
    } catch (error) {
      ctx.log(`[${row.slug || 'candidate'}] research page skipped: ${sanitizeLogValue(error)}`);
      return null;
    }
  }

  /**
   * Every page the row cites, read in a fixed order: the lab site, up to two research
   * subpages it links, the official profile(s), then the rest, the description-credited
   * page included, at most six. Stopping at the first readable citation skipped the
   * official profile on rows that also have a lab site, which held a median row to 4.0 KB
   * of the 12.4 KB its pages carry (#5396).
   */
  async readCitedResearchPages(
    row: CandidateDescriptionLab,
    ctx: ScraperContext,
    citerCounts: ReadonlyMap<string, number> = new Map(),
  ): Promise<FetchedDescriptionPage[]> {
    const cited = uniqueStrings([
      row.websiteUrl,
      ...(row.sourceUrls ?? []),
      row.fullDescriptionSourceUrl,
    ]).filter(
      (url) =>
        !isRefusedDescriptionLaneSourceUrl(url) && !isSharedListingCitation(url, row, citerCounts),
    );
    const labSiteUrl = cited.find((url) => !isPersonProfileUrl(url));
    const pages: FetchedDescriptionPage[] = [];
    const read = async (url: string): Promise<FetchedDescriptionPage | null> => {
      if (pages.length >= MAX_PAGES_PER_ROW) return null;
      if (pages.some((page) => page.url === url)) return null;
      const page = await this.tryFetch(url, row, ctx);
      if (!page || pages.some((fetched) => fetched.url === page.url)) return null;
      pages.push(page);
      return page;
    };

    const labSite = labSiteUrl ? await read(labSiteUrl) : null;
    if (labSite) {
      const subpages = researchSubPageCrawlUrls(labSite.html, labSite.url, Number.POSITIVE_INFINITY)
        .filter((candidate) => researchSubPageIsWithinHome(candidate, labSite.url))
        .slice(0, MAX_RESEARCH_SUBPAGES);
      for (const url of subpages) {
        await read(url);
      }
    }
    const remaining = cited.filter((url) => url !== labSiteUrl);
    for (const url of [
      ...remaining.filter(isPersonProfileUrl),
      ...remaining.filter((url) => !isPersonProfileUrl(url)),
    ]) {
      await read(url);
    }
    return pages;
  }

  private async readRow(
    row: CandidateDescriptionLab,
    ctx: ScraperContext,
    counts: LaneCounts,
    citerCounts: ReadonlyMap<string, number>,
  ): Promise<ObservationInput[]> {
    const fetched = await this.readCitedResearchPages(row, ctx, citerCounts);
    if (fetched.length === 0) {
      counts.noReadablePage += 1;
      return [];
    }
    const value = researchPageTextValue(fetched);
    const entityRef: ContentHashEntityRef = {
      entityType: 'researchEntity',
      entityId: serializedDocumentId(row._id) || undefined,
      entityKey: row.slug,
    };
    const contentHash = researchPageTextContentHash(value);
    const storedHash = await this.storedHashLoader(this.name, entityRef);
    if (contentUnchanged(storedHash, contentHash, false)) {
      counts.contentUnchanged += 1;
      return [];
    }
    const sourceUrl = value[0]?.url ?? fetched[0].url;
    if (value.length === 0) counts.rowsWithoutText += 1;
    else counts.rowsWithText += 1;
    counts.charsStored += value.reduce((sum, entry) => sum + entry.text.length, 0);
    return [
      {
        ...entityRef,
        field: RESEARCH_PAGE_TEXT_FIELD,
        value,
        sourceUrl,
        ...(value.length === 0 ? { assertsNoValueFor: [RESEARCH_PAGE_TEXT_FIELD] } : {}),
      },
      contentHashObservation(entityRef, sourceUrl, contentHash),
    ];
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = uniqueStrings(ctx.options.only ?? []);
    const offset = Math.max(0, Number(ctx.options.offset) || 0);
    const limit =
      ctx.options.exhaustive && ctx.options.limit === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Number(ctx.options.limit) || DEFAULT_ROW_LIMIT);
    const rows = (await this.rowFinder({ only, exhaustive: ctx.options.exhaustive })).slice(
      offset,
      offset + limit,
    );

    const counts: LaneCounts = {
      rowsWithText: 0,
      rowsWithoutText: 0,
      noReadablePage: 0,
      contentUnchanged: 0,
      charsStored: 0,
    };
    let observationCount = 0;
    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );
    const citerCounts = await this.citerCountsLoader();
    await mapWithConcurrency(rows, concurrency, async (row) => {
      const observations = await this.readRow(row, ctx, counts, citerCounts);
      if (observations.length === 0) return;
      await ctx.emit(observations);
      observationCount += observations.length;
    });

    return {
      observationCount,
      entitiesObserved: counts.rowsWithText + counts.rowsWithoutText,
      notes:
        `Research page text for ${counts.rowsWithText} of ${rows.length} rows: ` +
        `${counts.rowsWithoutText} read with no research text, ${counts.noReadablePage} with no readable page, ` +
        `${counts.contentUnchanged} content unchanged, ${counts.charsStored} characters stored.`,
    };
  }
}
