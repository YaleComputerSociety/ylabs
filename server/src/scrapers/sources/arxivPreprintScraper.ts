/**
 * ArxivPreprintScraper
 *
 * Pulls recent arXiv preprints by Yale faculty name and emits Paper observations.
 * arXiv's Atom API does not prove institutional identity for author-name search
 * results, so this source must not attach `yaleAuthorIds` from name-only matches.
 * Identity-backed sources such as OpenAlex can add faculty authorship later.
 * These observations are publication/topic enrichment, not undergraduate-access
 * evidence.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { User } from '../../models/user';
import { summarizeFetchMetrics } from '../renderedFetch';
import { getCached, setCached } from '../snapshotCache';
import type {
  IScraper,
  ObservationInput,
  ScraperContext,
  ScraperFetchAttemptMetrics,
  ScraperResult,
} from '../types';
import { isExactNameMatch } from './openAlexPaperScraper';

const ARXIV_BASE = 'https://export.arxiv.org/api/query';
const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_REQUEST_DELAY_MS = 3000;
const DEFAULT_RATE_LIMIT_RETRY_MS = 30000;

export type ArxivFetcher = (params: Record<string, string>) => Promise<string>;
export type SleepFn = (ms: number) => Promise<void>;

const defaultFetcher: ArxivFetcher = async (params) => {
  const res = await axios.get(ARXIV_BASE, {
    params,
    timeout: 30000,
    headers: {
      'User-Agent': 'yalelabs.io arxiv preprint sync (mailto:info@yalelabs.io)',
    },
  });
  return String(res.data || '');
};

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface ArxivPreprintScraperOptions {
  userModel?: { find: typeof User.find };
  fetcher?: ArxivFetcher;
  sleep?: SleepFn;
  maxResultsPerAuthor?: number;
  requestDelayMs?: number;
  rateLimitRetryMs?: number;
}

export interface ParsedArxivEntry {
  arxivId: string;
  versionedArxivId?: string;
  title: string;
  authors: string[];
  summary?: string;
  publishedAt?: Date;
  updatedAt?: Date;
  doi?: string;
  journalRef?: string;
  categories: string[];
  absUrl: string;
  pdfUrl?: string;
}

export function normalizeArxivId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const withoutUrl = trimmed
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, '')
    .replace(/^arxiv:/i, '');
  const withoutVersion = withoutUrl.replace(/v\d+$/i, '');
  return withoutVersion || null;
}

export function normalizeArxivText(raw: string | undefined | null): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAuthorSearchQuery(fname: string, lname: string): string {
  const name = `${fname} ${lname}`.replace(/"/g, '').replace(/\s+/g, ' ').trim();
  return `au:"${name}"`;
}

export function shouldProcessFaculty(
  fac: { netid?: string; fname?: string; lname?: string },
  only?: string[],
): boolean {
  if (!only || only.length === 0) return true;
  const allowed = new Set(only.map((value) => value.toLowerCase()));
  const netid = String(fac.netid || '').toLowerCase();
  const fname = String(fac.fname || '').toLowerCase();
  const lname = String(fac.lname || '').toLowerCase();
  const fullName = `${fname} ${lname}`.trim();
  return allowed.has(netid) || allowed.has(lname) || allowed.has(fullName);
}

export function parseArxivFeed(xml: string): ParsedArxivEntry[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const entries: ParsedArxivEntry[] = [];

  $('entry').each((_, entryEl) => {
    const entry = $(entryEl);
    const idUrl = normalizeArxivText(entry.children('id').first().text());
    const arxivId = normalizeArxivId(idUrl);
    const versionedArxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//i, '') || undefined;
    const title = normalizeArxivText(entry.children('title').first().text());
    if (!arxivId || !title) return;

    const authors = entry
      .children('author')
      .map((__, authorEl) => normalizeArxivText($(authorEl).children('name').first().text()))
      .get()
      .filter(Boolean);

    const categories = entry
      .children('category')
      .map((__, categoryEl) => normalizeArxivText($(categoryEl).attr('term')))
      .get()
      .filter(Boolean);

    let pdfUrl: string | undefined;
    entry.children('link').each((__, linkEl) => {
      const link = $(linkEl);
      if (link.attr('title') === 'pdf' || link.attr('type') === 'application/pdf') {
        pdfUrl = link.attr('href') || undefined;
      }
    });

    const publishedText = normalizeArxivText(entry.children('published').first().text());
    const updatedText = normalizeArxivText(entry.children('updated').first().text());
    const doi = normalizeArxivText(entry.children('arxiv\\:doi').first().text());
    const journalRef = normalizeArxivText(entry.children('arxiv\\:journal_ref').first().text());

    entries.push({
      arxivId,
      versionedArxivId,
      title,
      authors,
      summary: normalizeArxivText(entry.children('summary').first().text()) || undefined,
      publishedAt: publishedText ? new Date(publishedText) : undefined,
      updatedAt: updatedText ? new Date(updatedText) : undefined,
      doi: doi
        ? doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase()
        : undefined,
      journalRef: journalRef || undefined,
      categories,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl,
    });
  });

  return entries;
}

export function arxivEntryToObservations(entry: ParsedArxivEntry): ObservationInput[] {
  const base = {
    entityType: 'paper' as const,
    entityKey: entry.arxivId,
    sourceUrl: entry.absUrl,
  };

  const externalIds: Record<string, string> = {
    arxiv: entry.arxivId,
  };
  if (entry.versionedArxivId) externalIds.arxivVersion = entry.versionedArxivId;
  if (entry.doi) externalIds.DOI = entry.doi;

  const fields: Array<[string, unknown]> = [
    ['arxivId', entry.arxivId],
    ['doi', entry.doi],
    ['title', entry.title],
    ['authors', entry.authors],
    ['year', entry.publishedAt?.getUTCFullYear()],
    ['venue', entry.journalRef || 'arXiv'],
    ['abstract', entry.summary],
    ['url', entry.absUrl],
    ['landingPageUrl', entry.absUrl],
    ['pdfUrl', entry.pdfUrl],
    ['isOpenAccess', true],
    ['publishedAt', entry.publishedAt],
    ['postedAt', entry.publishedAt],
    ['versionDate', entry.updatedAt],
    ['fieldsOfStudy', entry.categories],
    ['publicationTypes', ['preprint']],
    ['publicationStage', 'PREPRINT'],
    ['preprintServer', 'arxiv'],
    ['externalIds', externalIds],
    ['sources', ['arxiv']],
  ];

  return fields
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([field, value]) => ({ ...base, field, value }));
}

export class ArxivPreprintScraper implements IScraper {
  readonly name = 'arxiv';
  readonly displayName = 'arXiv preprint sync';

  private readonly userModel: { find: typeof User.find };
  private readonly fetcher: ArxivFetcher;
  private readonly sleep: SleepFn;
  private readonly maxResultsPerAuthor: number;
  private readonly requestDelayMs: number;
  private readonly rateLimitRetryMs: number;

  constructor(opts: ArxivPreprintScraperOptions = {}) {
    this.userModel = opts.userModel || User;
    this.fetcher = opts.fetcher || defaultFetcher;
    this.sleep = opts.sleep || defaultSleep;
    this.maxResultsPerAuthor = opts.maxResultsPerAuthor || DEFAULT_MAX_RESULTS;
    this.requestDelayMs =
      opts.requestDelayMs ??
      Number(process.env.ARXIV_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS);
    this.rateLimitRetryMs =
      opts.rateLimitRetryMs ??
      Number(process.env.ARXIV_RATE_LIMIT_RETRY_MS || DEFAULT_RATE_LIMIT_RETRY_MS);
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    const facultyFilter: any = {
      userType: { $in: ['professor', 'faculty'] },
      fname: { $exists: true, $nin: [null, ''] },
      lname: { $exists: true, $nin: [null, ''] },
    };
    let facultyQuery = this.userModel
      .find(facultyFilter, {
        _id: 1,
        netid: 1,
        fname: 1,
        lname: 1,
      })
      .lean();
    if (limitOption) {
      facultyQuery = facultyQuery.limit(limitOption);
    }

    const faculty: any[] = await facultyQuery;
    const selectedFaculty = faculty.filter((fac) =>
      shouldProcessFaculty(
        { netid: fac.netid, fname: fac.fname, lname: fac.lname },
        ctx.options.only,
      ),
    );
    ctx.log(`Faculty candidates for arXiv sync: ${selectedFaculty.length}`);

    let totalObs = 0;
    let totalEntries = 0;
    let matchedEntries = 0;
    let fetchFailures = 0;
    const fetchAttempts: ScraperFetchAttemptMetrics[] = [];

    for (let i = 0; i < selectedFaculty.length; i++) {
      const fac = selectedFaculty[i];
      const fname = String(fac.fname || '').trim();
      const lname = String(fac.lname || '').trim();
      const netid = String(fac.netid || '').trim();
      if (!fname || !lname || !netid) continue;

      const searchQuery = buildAuthorSearchQuery(fname, lname);
      const cacheKey = `author:${lname}-${fname}:max:${this.maxResultsPerAuthor}`;
      let xml: string | null = null;
      if (ctx.options.useCache) {
        const cached = await getCached<{ xml: string }>('arxiv', cacheKey);
        if (cached?.xml) xml = cached.xml;
      }

      if (!xml) {
        const params = {
          search_query: searchQuery,
          start: '0',
          max_results: String(this.maxResultsPerAuthor),
          sortBy: 'lastUpdatedDate',
          sortOrder: 'descending',
        };
        const startedAt = Date.now();
        try {
          xml = await this.fetcher(params);
          fetchAttempts.push({
            target: searchQuery,
            success: true,
            latencyMs: Date.now() - startedAt,
            fetchMode: 'api',
            blocked: false,
            selectorBreakage: false,
            statusCode: 200,
          });
        } catch (err: any) {
          const statusCode = err?.response?.status;
          if (statusCode === 429 && this.rateLimitRetryMs > 0) {
            ctx.log(
              `arXiv rate-limited ${searchQuery}; retrying after ${this.rateLimitRetryMs}ms`,
            );
            await this.sleep(this.rateLimitRetryMs);
            const retryStartedAt = Date.now();
            try {
              xml = await this.fetcher(params);
              fetchAttempts.push({
                target: searchQuery,
                success: true,
                latencyMs: Date.now() - retryStartedAt,
                fetchMode: 'api',
                blocked: false,
                selectorBreakage: false,
                statusCode: 200,
              });
            } catch (retryErr: any) {
              fetchFailures++;
              fetchAttempts.push({
                target: searchQuery,
                success: false,
                latencyMs: Date.now() - retryStartedAt,
                fetchMode: 'api',
                blocked: retryErr?.response?.status === 429,
                blockedReason:
                  retryErr?.response?.status === 429 ? 'rate-limited' : undefined,
                selectorBreakage: false,
                statusCode: retryErr?.response?.status,
                errorMessage: retryErr?.message,
              });
              ctx.log(`Skipping ${searchQuery}: ${retryErr?.message || retryErr}`);
              continue;
            }
          } else {
            fetchFailures++;
            fetchAttempts.push({
              target: searchQuery,
              success: false,
              latencyMs: Date.now() - startedAt,
              fetchMode: 'api',
              blocked: statusCode === 429,
              blockedReason: statusCode === 429 ? 'rate-limited' : undefined,
              selectorBreakage: false,
              statusCode,
              errorMessage: err?.message,
            });
            ctx.log(`Skipping ${searchQuery}: ${err?.message || err}`);
            continue;
          }
        }
        if (ctx.options.useCache) {
          await setCached('arxiv', cacheKey, { xml });
        }
        if (this.requestDelayMs > 0 && i < selectedFaculty.length - 1) {
          await this.sleep(this.requestDelayMs);
        }
      }

      const entries = parseArxivFeed(xml);
      totalEntries += entries.length;
      for (const entry of entries) {
        if (!entry.authors.some((author) => isExactNameMatch(author, fname, lname))) {
          continue;
        }
        if (ctx.options.since && entry.updatedAt && entry.updatedAt < ctx.options.since) {
          continue;
        }

        const observations = arxivEntryToObservations(entry);
        await ctx.emit(observations);
        totalObs += observations.length;
        matchedEntries++;
      }
    }

    return {
      observationCount: totalObs,
      entitiesObserved: matchedEntries,
      notes: `Faculty processed: ${selectedFaculty.length}; arXiv entries fetched: ${totalEntries}; exact-author matches: ${matchedEntries}; fetch failures: ${fetchFailures}`,
      fetchMetrics: summarizeFetchMetrics(fetchAttempts),
    };
  }
}
