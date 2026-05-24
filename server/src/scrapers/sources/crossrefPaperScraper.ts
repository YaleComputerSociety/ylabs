/**
 * Crossref DOI metadata hydrator.
 *
 * Crossref is metadata-only in the trusted publication pipeline. It can improve
 * DOI/title/venue/date/author metadata, but it never creates Yale authorship
 * links unless a separate identity-backed evidence source does so.
 */
import axios from 'axios';
import { ResearchScholarlyLink } from '../../models/researchScholarlyLink';
import {
  isDisplayableResearchActivityLink,
  normalizeScholarlyLinkTitle,
} from '../../services/scholarlyLinkService';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const CROSSREF_BASE = 'https://api.crossref.org/works';
const ARXIV_DOI_RE = /^10\.48550\/arxiv\./i;
const DEFAULT_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RATE_LIMIT_RETRY_MS = 1000;
const DEFAULT_MAX_RETRY_AFTER_MS = 10000;
const DEFAULT_REQUEST_DELAY_MS = 50;

export type CrossrefFetcher = (doi: string) => Promise<unknown>;
type SleepFn = (ms: number) => Promise<void>;

export interface CrossrefPaperScraperOptions {
  paperModel?: { find: typeof ResearchScholarlyLink.find };
  scholarlyLinkModel?: { find: typeof ResearchScholarlyLink.find };
  fetcher?: CrossrefFetcher;
  sleep?: SleepFn;
  maxRateLimitRetries?: number;
  rateLimitRetryMs?: number;
  maxRetryAfterMs?: number;
  requestDelayMs?: number;
}

interface CrossrefMessage {
  DOI?: string;
  title?: string[];
  issued?: { 'date-parts'?: number[][] };
  published?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  URL?: string;
  author?: { given?: string; family?: string; ORCID?: string }[];
  type?: string;
  link?: { URL?: string; 'content-type'?: string; 'intended-application'?: string }[];
}

const defaultFetcher: CrossrefFetcher = async (doi) => {
  const res = await axios.get(`${CROSSREF_BASE}/${encodeURIComponent(doi)}`, {
    timeout: 30000,
    params: {
      mailto: process.env.CROSSREF_CONTACT_EMAIL || 'info@yalelabs.io',
    },
  });
  return res.data;
};

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeDoi(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
  return normalized || undefined;
}

function isCrossrefEligibleDoi(doi: string | undefined): doi is string {
  return Boolean(doi) && !ARXIV_DOI_RE.test(doi as string);
}

function doiFromScholarlyLink(link: Record<string, any>): string | undefined {
  const direct = normalizeDoi(link.externalIds?.doi || link.externalIds?.DOI);
  if (direct) return isCrossrefEligibleDoi(direct) ? direct : undefined;
  const url = String(link.url || '');
  const fromUrl = normalizeDoi(url.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i)?.[1]);
  return isCrossrefEligibleDoi(fromUrl) ? fromUrl : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function statusCodeFromError(error: any): number | undefined {
  return error?.response?.status;
}

function retryAfterMsFromError(error: any, now = Date.now()): number | undefined {
  const headers = error?.response?.headers || {};
  const raw =
    headers['retry-after'] ||
    headers['Retry-After'] ||
    (typeof headers.get === 'function' ? headers.get('retry-after') : undefined);
  if (raw === undefined || raw === null || raw === '') return undefined;

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return Math.max(0, asNumber * 1000);

  const asDate = Date.parse(String(raw));
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, asDate - now);
}

function dateFromParts(parts: number[][] | undefined): Date | undefined {
  const first = parts?.[0];
  if (!first?.[0]) return undefined;
  const date = new Date(Date.UTC(first[0], (first[1] || 1) - 1, first[2] || 1));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function crossrefFreeFullText(message: CrossrefMessage): string | undefined {
  return (message.link || [])
    .map((link) => String(link.URL || '').trim())
    .find((url) => /^https?:\/\//i.test(url) && /(?:\.pdf\b|\/pdf\b|pdf=)/i.test(url));
}

function crossrefMessageToObservations(
  message: CrossrefMessage,
  link: Record<string, any>,
): ObservationInput[] {
  const doi = normalizeDoi(message.DOI);
  if (!doi) return [];
  const title = normalizeScholarlyLinkTitle(message.title?.[0]);
  if (
    !isDisplayableResearchActivityLink({
      title,
      publicationTypes: message.type ? [message.type] : [],
    })
  ) {
    return [];
  }
  const publishedAt = dateFromParts(
    message.published?.['date-parts'] || message.issued?.['date-parts'],
  );
  const sourceUrl = `https://doi.org/${doi}`;
  const freeFullTextUrl = crossrefFreeFullText(message);
  const discoveredVia = ['OPENALEX', 'ORCID', 'OFFICIAL_PROFILE', 'MANUAL'].includes(
    String(link.discoveredVia || ''),
  )
    ? link.discoveredVia
    : 'MANUAL';
  const fields: Array<[string, unknown]> = [
    ['userId', link.userId],
    ['researchEntityId', link.researchEntityId],
    ['title', title],
    ['crossrefHydratedAt', new Date()],
    ['year', publishedAt?.getUTCFullYear()],
    ['venue', message['container-title']?.[0]],
    ['url', sourceUrl],
    ['destinationKind', 'DOI'],
    ['displaySource', 'DOI'],
    ['discoveredVia', discoveredVia],
    ['freeFullTextUrl', freeFullTextUrl],
    ['freeFullTextLabel', freeFullTextUrl ? 'Free PDF' : undefined],
    ['publicationTypes', message.type ? [message.type] : undefined],
    ['externalIds', { ...(link.externalIds || {}), doi }],
    ['confidence', 0.85],
    ['observedAt', new Date()],
  ];

  return fields
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([field, value]) => ({
      entityType: 'scholarlyLink' as const,
      entityId: String(link._id),
      entityKey: `doi:${doi}`,
      field,
      value,
      sourceUrl,
    }));
}

export class CrossrefPaperScraper implements IScraper {
  readonly name = 'crossref';
  readonly displayName = 'Crossref compact scholarly-link hydrator';

  private readonly scholarlyLinkModel: { find: typeof ResearchScholarlyLink.find };
  private readonly fetcher: CrossrefFetcher;
  private readonly sleep: SleepFn;
  private readonly maxRateLimitRetries: number;
  private readonly rateLimitRetryMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly requestDelayMs: number;

  constructor(options: CrossrefPaperScraperOptions = {}) {
    this.scholarlyLinkModel =
      options.scholarlyLinkModel || (options.paperModel as any) || ResearchScholarlyLink;
    this.fetcher = options.fetcher || defaultFetcher;
    this.sleep = options.sleep || defaultSleep;
    this.maxRateLimitRetries =
      options.maxRateLimitRetries ??
      Number(process.env.CROSSREF_RATE_LIMIT_RETRIES || DEFAULT_RATE_LIMIT_RETRIES);
    this.rateLimitRetryMs =
      options.rateLimitRetryMs ??
      Number(process.env.CROSSREF_RATE_LIMIT_RETRY_MS || DEFAULT_RATE_LIMIT_RETRY_MS);
    this.maxRetryAfterMs =
      options.maxRetryAfterMs ??
      Number(process.env.CROSSREF_MAX_RETRY_AFTER_MS || DEFAULT_MAX_RETRY_AFTER_MS);
    this.requestDelayMs =
      options.requestDelayMs ??
      Number(
        process.env.CROSSREF_REQUEST_DELAY_MS ||
          (options.fetcher ? 0 : DEFAULT_REQUEST_DELAY_MS),
      );
  }

  private async fetchWithRateLimitRetry(doi: string, ctx: ScraperContext): Promise<unknown> {
    let attempt = 0;
    while (true) {
      try {
        return await this.fetcher(doi);
      } catch (error: any) {
        const statusCode = statusCodeFromError(error);
        if (statusCode !== 429 || attempt >= this.maxRateLimitRetries) {
          throw error;
        }

        attempt++;
        const retryAfterMs = retryAfterMsFromError(error);
        const delayMs = Math.min(
          retryAfterMs ?? this.rateLimitRetryMs * attempt,
          this.maxRetryAfterMs,
        );
        ctx.log(`Crossref rate-limited ${doi}; retrying in ${delayMs}ms`);
        if (delayMs > 0) await this.sleep(delayMs);
      }
    }
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const filter: any = {
      archived: { $ne: true },
      $or: [
        { 'externalIds.doi': { $exists: true, $ne: '' } },
        { url: /^https?:\/\/(?:dx\.)?doi\.org\//i },
      ],
    };
    if (ctx.options.only?.length) {
      const dois = ctx.options.only
        .map(normalizeDoi)
        .filter(isCrossrefEligibleDoi);
      if (dois.length === 0) {
        return {
          observationCount: 0,
          entitiesObserved: 0,
          notes: 'Hydrated 0/0 DOI scholarly links from Crossref (0 failures; unsupported DOI filters skipped).',
        };
      }
      filter.$or = [
        { 'externalIds.doi': { $in: dois } },
        ...dois.map((doi) => ({
          url: new RegExp(`^https?://(?:dx\\.)?doi\\.org/${escapeRegExp(doi)}$`, 'i'),
        })),
      ];
    }
    let query = this.scholarlyLinkModel
      .find(filter, {
        userId: 1,
        researchEntityId: 1,
        title: 1,
        url: 1,
        discoveredVia: 1,
        externalIds: 1,
        crossrefHydratedAt: 1,
      })
      .sort({ crossrefHydratedAt: 1, observedAt: 1, _id: 1 });
    if (ctx.options.offset && ctx.options.offset > 0) query = query.skip(ctx.options.offset);
    if (ctx.options.limit && ctx.options.limit > 0) query = query.limit(ctx.options.limit);
    const links: any[] = await query.lean();
    let totalObs = 0;
    let hydrated = 0;
    let failures = 0;

    for (const link of links) {
      const doi = doiFromScholarlyLink(link);
      if (!doi) continue;
      try {
        const payload = (await this.fetchWithRateLimitRetry(doi, ctx)) as {
          message?: CrossrefMessage;
        };
        const observations = payload?.message
          ? crossrefMessageToObservations(payload.message, link)
          : [];
        if (observations.length > 0) {
          await ctx.emit(observations);
          totalObs += observations.length;
          hydrated++;
        }
      } catch (error: any) {
        failures++;
        ctx.log(`Crossref fetch failed for ${doi}: ${error?.message || error}`);
      }
      if (this.requestDelayMs > 0) await this.sleep(this.requestDelayMs);
    }

    return {
      observationCount: totalObs,
      entitiesObserved: hydrated,
      notes: `Hydrated ${hydrated}/${links.length} DOI scholarly links from Crossref (${failures} failures).`,
    };
  }
}
