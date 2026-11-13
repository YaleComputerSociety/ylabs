import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
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
import { HttpStatusError, fetchPageWithPolicy } from '../utils/httpFetch';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../utils/mapWithConcurrency';
import { isLikelyOfficialPersonProfileUrl } from '../../services/leadProfileIdentity';
import {
  leadingPersonNameTokensFromEntityTitle,
  personPageLeafNameTokens,
  personProfileSourceMatchesEntity,
} from '../utils/personProfileEntityMatch';
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
import { isTransientFetchFailure } from '../utils/transientFetchFailure';
import { describeHostPauses, hostPauseInErrorChain, type HostPause } from '../utils/hostPause';
import {
  HostCompletionTracker,
  orderRowsBySmallestSharedHost,
  plannedHosts,
  type ReleaseFinishedHost,
} from '../utils/hostCompletion';

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
  storedReadingLoader?: StoredReadingLoaderFn;
  releaseFinishedHost?: ReleaseFinishedHost;
  previousThrottledRowsLoader?: PreviousThrottledRowsLoaderFn;
  sleep?: (ms: number) => Promise<void>;
}

export interface StoredReading {
  hosts: ReadonlySet<string>;
}

export type StoredReadingLoaderFn = (entity: ContentHashEntityRef) => Promise<StoredReading>;

/**
 * The rows the latest earlier run found throttled, by host, so this run can say how many are
 * throttled again. A refusing host keeps its rows' readings at any age and is only ever paused,
 * never dropped (owner decision, #6166), so this repeat count is what makes a host that keeps
 * refusing visible (#6195).
 */
export type PreviousThrottledRowsLoaderFn = () => Promise<Record<string, readonly string[]>>;

/** When only paused rows remain, the run waits for the earliest pause if it ends this soon. */
export const IN_RUN_PAUSE_WAIT_MS = 5 * 60_000;
const MAX_PAUSE_ROUNDS = 12;

interface TransientPageFailure {
  url: string;
  throttled: boolean;
  pause?: HostPause;
}

interface RowOutcome {
  observations: ObservationInput[];
  pauses?: HostPause[];
}

/** A row that met a paused host: left untouched now and read again once the pause ends. */
interface DeferredRow<T> {
  entry: T;
  pauses: HostPause[];
}

const pageHost = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const NO_STORED_READING: StoredReading = { hosts: new Set() };

/**
 * The hosts of the pages the row's current stored reading was built from, and when it was read.
 * Fails open like the content-hash gate: with no connection, or no stored reading, there is
 * nothing to keep.
 */
async function loadStoredReading(entity: ContentHashEntityRef): Promise<StoredReading> {
  if (!entity.entityId && !entity.entityKey) return NO_STORED_READING;
  if (!mongooseConnectionWasOpened()) return NO_STORED_READING;
  const filter: Record<string, unknown> = {
    entityType: entity.entityType,
    sourceName: RESEARCH_PAGE_TEXT_SOURCE,
    field: RESEARCH_PAGE_TEXT_FIELD,
    superseded: false,
  };
  if (entity.entityId) filter.entityId = entity.entityId;
  else filter.entityKey = entity.entityKey;
  const stored = await Observation.findOne(filter).sort({ observedAt: -1 }).select('value').lean();
  const value = (stored as { value?: unknown } | null)?.value;
  if (!Array.isArray(value)) return NO_STORED_READING;
  return {
    hosts: new Set(
      value
        .map((entry) => pageHost(String((entry as { url?: unknown })?.url ?? '')))
        .filter(Boolean),
    ),
  };
}

async function loadPreviousThrottledRows(): Promise<Record<string, readonly string[]>> {
  if (!mongooseConnectionWasOpened()) return {};
  const previous = await ScrapeRun.findOne(
    {
      sourceName: RESEARCH_PAGE_TEXT_SOURCE,
      status: 'success',
      'metrics.throttledRowsByHost': { $exists: true },
    },
    { 'metrics.throttledRowsByHost': 1 },
  )
    .sort({ startedAt: -1 })
    .lean();
  const byHost = (previous as { metrics?: { throttledRowsByHost?: unknown } } | null)?.metrics
    ?.throttledRowsByHost;
  return byHost && typeof byHost === 'object' ? (byHost as Record<string, string[]>) : {};
}

const THROTTLE_STATUSES: ReadonlySet<number> = new Set([403, 429, 503]);

const isThrottle = (error: unknown): boolean =>
  hostPauseInErrorChain(error) !== undefined ||
  THROTTLE_STATUSES.has((error as { status?: unknown } | null)?.status as number);

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

const HEADING_SELECTORS = 'title, h1, h2, meta[property="og:title"]';

function foldedTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2);
}

function urlPathKey(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return null;
  }
}

function canonicalLinkUrl($: cheerio.CheerioAPI, pageUrl: string): string | null {
  const href = $('link[rel="canonical"]').attr('href')?.trim();
  if (!href) return null;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

function urlPathLeaf(value: string): string {
  try {
    return new URL(value).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    return '';
  }
}

function subjectSurnameTokens(requestedUrl: string, row: CandidateDescriptionLab): Set<string> {
  const nameTokens =
    personPageLeafNameTokens(urlPathLeaf(requestedUrl)) ??
    leadingPersonNameTokensFromEntityTitle(row.name) ??
    [];
  const surname = nameTokens[nameTokens.length - 1];
  return new Set(surname ? foldedTokens(surname) : []);
}

/**
 * A requested person profile that answered with a page outside any person-profile path,
 * whose headings do not name the subject's surname, is a department, program or region
 * root a retired profile redirected to, so its text is not the row's research (#5947). A
 * redirect to the same person's own other page names them in a heading and is kept.
 */
export function capturedPageLeftTheRequestedPersonProfile(
  requestedUrl: string,
  page: FetchedDescriptionPage,
  row: CandidateDescriptionLab,
): boolean {
  if (!isLikelyOfficialPersonProfileUrl(requestedUrl)) return false;
  const requestedKey = urlPathKey(requestedUrl);
  const $ = cheerio.load(page.html);
  const landedUrls = [page.url, canonicalLinkUrl($, page.url)].filter(
    (url): url is string => Boolean(url) && urlPathKey(url as string) !== requestedKey,
  );
  const landing = landedUrls.find((url) => !isLikelyOfficialPersonProfileUrl(url));
  if (!landing) return false;
  const subject = subjectSurnameTokens(requestedUrl, row);
  if (subject.size === 0) return true;
  const headingText = $(HEADING_SELECTORS)
    .map((_, element) => $(element).attr('content') ?? $(element).text())
    .get()
    .join(' ');
  return !foldedTokens(headingText).some((token) => subject.has(token));
}

const uniqueStrings = (values: readonly (string | undefined)[]): string[] =>
  Array.from(new Set(values.map((value) => (value ?? '').trim()).filter(Boolean)));

export function citedResearchPageUrls(
  row: CandidateDescriptionLab,
  citerCounts: ReadonlyMap<string, number>,
): string[] {
  return uniqueStrings([
    row.websiteUrl,
    ...(row.sourceUrls ?? []),
    row.fullDescriptionSourceUrl,
  ]).filter(
    (url) =>
      !isRefusedDescriptionLaneSourceUrl(url) && !isSharedListingCitation(url, row, citerCounts),
  );
}

export function researchPageTextContentHash(value: readonly ResearchPageTextEntry[]): string {
  return computeVersionedContentHash(JSON.stringify(value), RESEARCH_PAGE_TEXT_CONTRACT, NO_MODEL);
}

interface LaneCounts {
  rowsWithText: number;
  rowsWithoutText: number;
  noReadablePage: number;
  keptAfterTransientFailure: number;
  throttledRowsByHost: Map<string, Set<string>>;
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
  private readonly storedReadingLoader: StoredReadingLoaderFn;
  private readonly previousThrottledRowsLoader: PreviousThrottledRowsLoaderFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly releaseFinishedHost?: ReleaseFinishedHost;

  constructor(deps: ResearchPageTextScraperDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.rowFinder = deps.rowFinder || defaultRowFinder;
    this.storedHashLoader = deps.storedHashLoader || loadStoredContentHash;
    this.citerCountsLoader = deps.citerCountsLoader || loadConnectedEvidenceUrlCiterCounts;
    this.storedReadingLoader = deps.storedReadingLoader || loadStoredReading;
    this.previousThrottledRowsLoader =
      deps.previousThrottledRowsLoader || loadPreviousThrottledRows;
    this.sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.releaseFinishedHost = deps.releaseFinishedHost;
  }

  private async tryFetch(
    url: string,
    row: CandidateDescriptionLab,
    ctx: ScraperContext,
    transientFailures: TransientPageFailure[],
  ) {
    try {
      const page = await this.fetchPage(url);
      if (!page?.html) return null;
      if (capturedPageLeftTheRequestedPersonProfile(url, page, row)) {
        ctx.log(
          `[${row.slug || 'candidate'}] research page refused: profile landed off the subject`,
        );
        return null;
      }
      return personProfileSourceMatchesEntity(page.url, row) ? page : null;
    } catch (error) {
      if (isTransientFetchFailure(error)) {
        const throttled = isThrottle(error);
        const pause = hostPauseInErrorChain(error)?.pause;
        transientFailures.push({ url, throttled, ...(pause ? { pause } : {}) });
        if (error instanceof HttpStatusError && error.finalUrl) {
          transientFailures.push({ url: error.finalUrl, throttled });
        }
      }
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
    transientFailures: TransientPageFailure[] = [],
  ): Promise<FetchedDescriptionPage[]> {
    const cited = citedResearchPageUrls(row, citerCounts);
    const labSiteUrl = cited.find((url) => !isPersonProfileUrl(url));
    const pages: FetchedDescriptionPage[] = [];
    const read = async (url: string): Promise<FetchedDescriptionPage | null> => {
      if (pages.length >= MAX_PAGES_PER_ROW) return null;
      if (pages.some((page) => page.url === url)) return null;
      const page = await this.tryFetch(url, row, ctx, transientFailures);
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
  ): Promise<RowOutcome> {
    const transientFailures: TransientPageFailure[] = [];
    const fetched = await this.readCitedResearchPages(row, ctx, citerCounts, transientFailures);
    const entityRef: ContentHashEntityRef = {
      entityType: 'researchEntity',
      entityId: serializedDocumentId(row._id) || undefined,
      entityKey: row.slug,
    };
    const rowKey = entityRef.entityId ?? entityRef.entityKey ?? '';
    for (const failure of transientFailures) {
      if (!failure.throttled || !rowKey) continue;
      const host = failure.pause?.host ?? pageHost(failure.url);
      const throttled = counts.throttledRowsByHost.get(host) ?? new Set<string>();
      throttled.add(rowKey);
      counts.throttledRowsByHost.set(host, throttled);
    }
    const pauses = transientFailures.flatMap((failure) => (failure.pause ? [failure.pause] : []));
    if (pauses.length > 0) {
      ctx.log(
        `[${row.slug || 'candidate'}] research page text deferred: a cited host is pausing this run's requests, so the row is read again once the pause ends`,
      );
      return { observations: [], pauses };
    }
    if (transientFailures.length > 0) {
      const stored = await this.storedReadingLoader(entityRef);
      const fedTheStoredReading = transientFailures.filter((failure) =>
        stored.hosts.has(pageHost(failure.url)),
      );
      if (fedTheStoredReading.length > 0) {
        counts.keptAfterTransientFailure += 1;
        ctx.log(
          `[${row.slug || 'candidate'}] research page text kept: a cited page its stored reading drew on failed transiently, so this run leaves that reading for the next one`,
        );
        return { observations: [] };
      }
    }
    if (fetched.length === 0) {
      counts.noReadablePage += 1;
      return { observations: [] };
    }
    const value = researchPageTextValue(fetched);
    const contentHash = researchPageTextContentHash(value);
    const storedHash = await this.storedHashLoader(this.name, entityRef);
    if (contentUnchanged(storedHash, contentHash, false)) {
      counts.contentUnchanged += 1;
      return { observations: [] };
    }
    const sourceUrl = value[0]?.url ?? fetched[0].url;
    if (value.length === 0) counts.rowsWithoutText += 1;
    else counts.rowsWithText += 1;
    counts.charsStored += value.reduce((sum, entry) => sum + entry.text.length, 0);
    return {
      observations: [
        {
          ...entityRef,
          field: RESEARCH_PAGE_TEXT_FIELD,
          value,
          sourceUrl,
          ...(value.length === 0 ? { assertsNoValueFor: [RESEARCH_PAGE_TEXT_FIELD] } : {}),
        },
        contentHashObservation(entityRef, sourceUrl, contentHash),
      ],
    };
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
      keptAfterTransientFailure: 0,
      throttledRowsByHost: new Map(),
      contentUnchanged: 0,
      charsStored: 0,
    };
    let observationCount = 0;
    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );
    const citerCounts = await this.citerCountsLoader();
    const planned = orderRowsBySmallestSharedHost(
      rows.map((row) => ({ row, hosts: plannedHosts(citedResearchPageUrls(row, citerCounts)) })),
    );
    const hostCompletion = new HostCompletionTracker(planned, this.releaseFinishedHost);
    let deferred: DeferredRow<(typeof planned)[number]>[] = [];
    const readPlanned = async (entry: (typeof planned)[number]): Promise<void> => {
      const outcome = await this.readRow(entry.row, ctx, counts, citerCounts);
      if (outcome.pauses?.length) {
        deferred.push({ entry, pauses: outcome.pauses });
        return;
      }
      if (outcome.observations.length === 0) return;
      await ctx.emit(outcome.observations);
      observationCount += outcome.observations.length;
    };
    await mapWithConcurrency(planned, concurrency, async (entry) => {
      try {
        await readPlanned(entry);
      } finally {
        hostCompletion.rowFinished(entry.hosts);
      }
    });
    await hostCompletion.settled();

    for (let round = 0; round < MAX_PAUSE_ROUNDS && deferred.length > 0; round += 1) {
      const resumesAt = (row: DeferredRow<unknown>) =>
        Math.max(...row.pauses.map((pause) => pause.until.getTime()));
      const now = Date.now();
      let ready = deferred.filter((row) => resumesAt(row) <= now);
      if (ready.length === 0) {
        const earliest = Math.min(...deferred.map(resumesAt));
        if (earliest - now > IN_RUN_PAUSE_WAIT_MS) break;
        await this.sleep(Math.max(0, earliest - now));
        ready = deferred.filter((row) => resumesAt(row) <= Date.now());
      }
      deferred = deferred.filter((row) => !ready.includes(row));
      await mapWithConcurrency(ready, concurrency, async ({ entry }) => readPlanned(entry));
    }

    const throttledRowsByHost = Object.fromEntries(
      [...counts.throttledRowsByHost]
        .sort(([hostA], [hostB]) => hostA.localeCompare(hostB))
        .map(([host, rowKeys]) => [host, [...rowKeys].sort()]),
    );
    const previousThrottled = await this.previousThrottledRowsLoader();
    const throttledNote = Object.entries(throttledRowsByHost)
      .map(([host, rowKeys]) => {
        const before = new Set(previousThrottled[host] ?? []);
        const again = rowKeys.filter((rowKey) => before.has(rowKey)).length;
        return `${host} ${rowKeys.length} (${again} also throttled last run)`;
      })
      .join(', ');
    const deferredByHost = new Map<string, { rows: number; resumesAt: Date }>();
    for (const row of deferred) {
      for (const pause of row.pauses) {
        const known = deferredByHost.get(pause.host);
        deferredByHost.set(pause.host, {
          rows: (known?.rows ?? 0) + 1,
          resumesAt: known && known.resumesAt > pause.until ? known.resumesAt : pause.until,
        });
      }
    }
    const deferredRowsByHost = Object.fromEntries(
      [...deferredByHost]
        .sort(([hostA], [hostB]) => hostA.localeCompare(hostB))
        .map(([host, { rows, resumesAt }]) => [host, { rows, resumesAt: resumesAt.toISOString() }]),
    );
    const deferredNote = Object.entries(deferredRowsByHost)
      .map(([host, { rows, resumesAt }]) => `${host} ${rows} rows, resumes at ${resumesAt}`)
      .join(', ');
    const pausesMet = describeHostPauses(
      [...deferredByHost].map(([host, { resumesAt }]) => ({ host, until: resumesAt })),
    );

    return {
      observationCount,
      entitiesObserved: counts.rowsWithText + counts.rowsWithoutText,
      notes:
        `Research page text for ${counts.rowsWithText} of ${rows.length} rows: ` +
        `${counts.rowsWithoutText} read with no research text, ${counts.noReadablePage} with no readable page, ` +
        `${counts.keptAfterTransientFailure} kept after a transient fetch failure, ` +
        `${deferred.length} deferred to a later run, ` +
        `${counts.contentUnchanged} content unchanged, ${counts.charsStored} characters stored.` +
        (throttledNote ? ` Throttled rows, by host: ${throttledNote}.` : '') +
        (deferredNote ? ` Deferred, by host: ${deferredNote}.` : '') +
        (pausesMet ? ` Paused hosts: ${pausesMet}.` : ''),
      metrics: { throttledRowsByHost, deferredRowsByHost },
    };
  }
}
