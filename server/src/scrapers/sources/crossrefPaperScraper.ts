/**
 * Crossref DOI metadata hydrator.
 *
 * Crossref is metadata-only in the trusted publication pipeline. It can improve
 * DOI/title/venue/date/author metadata, but it never creates Yale authorship
 * links unless a separate identity-backed evidence source does so.
 */
import axios from 'axios';
import { Paper } from '../../models/paper';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const CROSSREF_BASE = 'https://api.crossref.org/works';

export type CrossrefFetcher = (doi: string) => Promise<unknown>;

export interface CrossrefPaperScraperOptions {
  paperModel?: { find: typeof Paper.find };
  fetcher?: CrossrefFetcher;
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

function normalizeDoi(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .toLowerCase();
  return normalized || undefined;
}

function dateFromParts(parts: number[][] | undefined): Date | undefined {
  const first = parts?.[0];
  if (!first?.[0]) return undefined;
  const date = new Date(Date.UTC(first[0], (first[1] || 1) - 1, first[2] || 1));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function crossrefMessageToObservations(message: CrossrefMessage): ObservationInput[] {
  const doi = normalizeDoi(message.DOI);
  if (!doi) return [];
  const publishedAt = dateFromParts(
    message.published?.['date-parts'] || message.issued?.['date-parts'],
  );
  const authorNames = (message.author || [])
    .map((author) => `${author.given || ''} ${author.family || ''}`.trim())
    .filter(Boolean);
  const authorOrcids = (message.author || [])
    .map((author) => author.ORCID?.replace(/^https?:\/\/orcid\.org\//i, ''))
    .filter(Boolean);
  const sourceUrl = message.URL || `https://doi.org/${doi}`;
  const fields: Array<[string, unknown]> = [
    ['doi', doi],
    ['title', message.title?.[0]],
    ['crossrefHydratedAt', new Date()],
    ['year', publishedAt?.getUTCFullYear()],
    ['publishedAt', publishedAt],
    ['venue', message['container-title']?.[0]],
    ['url', sourceUrl],
    ['authors', authorNames],
    ['publicationTypes', message.type ? [message.type] : undefined],
    ['externalIds', { DOI: doi, ...(authorOrcids.length ? { authorOrcids } : {}) }],
    ['sources', ['crossref']],
  ];

  return fields
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([field, value]) => ({
      entityType: 'paper' as const,
      entityKey: `doi:${doi}`,
      field,
      value,
      sourceUrl,
    }));
}

export class CrossrefPaperScraper implements IScraper {
  readonly name = 'crossref';
  readonly displayName = 'Crossref DOI metadata hydrator';

  private readonly paperModel: { find: typeof Paper.find };
  private readonly fetcher: CrossrefFetcher;

  constructor(options: CrossrefPaperScraperOptions = {}) {
    this.paperModel = options.paperModel || Paper;
    this.fetcher = options.fetcher || defaultFetcher;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const offsetOption = ctx.options.offset;
    if (offsetOption !== undefined && (!Number.isSafeInteger(offsetOption) || offsetOption < 0)) {
      throw new Error('--offset must be a safe non-negative integer');
    }
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption <= 0)) {
      throw new Error('--limit must be a safe positive integer');
    }

    const filter: any = {
      doi: { $exists: true, $ne: null, $nin: [''] },
    };
    if (ctx.options.only?.length) {
      filter.doi = { $in: ctx.options.only.map(normalizeDoi).filter(Boolean) };
    }
    let query = this.paperModel
      .find(filter, { doi: 1 })
      .sort({ lastObservedAt: 1, _id: 1 });
    if (offsetOption && offsetOption > 0) query = query.skip(offsetOption);
    if (limitOption && limitOption > 0) query = query.limit(limitOption);
    const papers: any[] = await query.lean();
    let totalObs = 0;
    let hydrated = 0;
    let failures = 0;

    for (const paper of papers) {
      const doi = normalizeDoi(paper.doi);
      if (!doi) continue;
      try {
        const payload = (await this.fetcher(doi)) as { message?: CrossrefMessage };
        const observations = payload?.message
          ? crossrefMessageToObservations(payload.message)
          : [];
        if (observations.length === 0) continue;
        await ctx.emit(observations);
        totalObs += observations.length;
        hydrated++;
      } catch (error: any) {
        failures++;
        ctx.log(`Crossref fetch failed for ${doi}: ${error?.message || error}`);
      }
    }

    return {
      observationCount: totalObs,
      entitiesObserved: hydrated,
      notes: `Hydrated ${hydrated}/${papers.length} DOI papers from Crossref (${failures} failures).`,
    };
  }
}
