/**
 * Europe PMC ORCID-backed paper scraper.
 *
 * Querying Europe PMC by AUTHORID:<ORCID> is treated as authorship evidence for
 * the accepted Yale user who owns that ORCID. Name search is intentionally not
 * implemented here.
 */
import axios from 'axios';
import { User } from '../../models/user';
import {
  PAPER_AUTHORSHIP_EVIDENCE_FIELD,
  type PaperAuthorshipEvidence,
} from '../paperAuthorshipPolicy';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const EUROPE_PMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

export type EuropePmcFetcher = (query: string, pageSize: number) => Promise<unknown>;

export interface EuropePmcPaperScraperOptions {
  userModel?: { find: typeof User.find };
  fetcher?: EuropePmcFetcher;
  pageSize?: number;
}

interface EuropePmcSourceConfig {
  sourceName: 'europe-pmc' | 'pubmed';
  displayName: string;
  authorshipMethod: 'europepmc-orcid' | 'pubmed-orcid';
  syncField: 'europePmcWorksSyncedAt' | 'pubmedWorksSyncedAt';
  queryForOrcid: (orcid: string) => string;
  includeResult: (result: EuropePmcResult) => boolean;
}

const EUROPE_PMC_SOURCE_CONFIG: EuropePmcSourceConfig = {
  sourceName: 'europe-pmc',
  displayName: 'Europe PMC ORCID paper sync',
  authorshipMethod: 'europepmc-orcid',
  syncField: 'europePmcWorksSyncedAt',
  queryForOrcid: (orcid) => `AUTHORID:"${orcid}"`,
  includeResult: () => true,
};

const PUBMED_SOURCE_CONFIG: EuropePmcSourceConfig = {
  sourceName: 'pubmed',
  displayName: 'PubMed ORCID paper sync via Europe PMC',
  authorshipMethod: 'pubmed-orcid',
  syncField: 'pubmedWorksSyncedAt',
  queryForOrcid: (orcid) => `AUTHORID:"${orcid}" AND SRC:MED`,
  includeResult: (result) => {
    const source = String(result.source || '').trim().toUpperCase();
    return source === 'MED' || Boolean(result.pmid);
  },
};

interface EuropePmcResult {
  id?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  journalTitle?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  authorString?: string;
  source?: string;
  fullTextUrlList?: { fullTextUrl?: { url?: string }[] };
}

const defaultFetcher: EuropePmcFetcher = async (query, pageSize) => {
  const res = await axios.get(EUROPE_PMC_BASE, {
    timeout: 30000,
    params: {
      query,
      format: 'json',
      pageSize,
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

function normalizeOrcid(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  return raw.trim().replace(/^https?:\/\/orcid\.org\//i, '') || undefined;
}

function entityKeyForResult(result: EuropePmcResult): string | undefined {
  const doi = normalizeDoi(result.doi);
  if (doi) return `doi:${doi}`;
  return undefined;
}

function resultToObservations(
  result: EuropePmcResult,
  owner: {
    userId: string;
    netid?: string;
    displayName: string;
    orcid: string;
  },
  sourceConfig: EuropePmcSourceConfig,
): ObservationInput[] {
  const entityKey = entityKeyForResult(result);
  if (!entityKey || !result.title) return [];
  const doi = normalizeDoi(result.doi);
  const sourceUrl = result.pmid
    ? `https://europepmc.org/article/MED/${result.pmid}`
    : `https://europepmc.org/search?query=AUTHORID:${encodeURIComponent(owner.orcid)}`;
  const externalIds: Record<string, string> = {
    ...(doi ? { DOI: doi } : {}),
    ...(result.pmid ? { PMID: result.pmid } : {}),
    ...(result.pmcid ? { PMCID: result.pmcid } : {}),
    ...(result.id ? { europePmc: result.id } : {}),
  };
  const evidence: PaperAuthorshipEvidence = {
    userId: owner.userId,
    netid: owner.netid,
    displayName: owner.displayName,
    sourceName: sourceConfig.sourceName,
    method: sourceConfig.authorshipMethod,
    externalAuthorIds: { orcid: owner.orcid },
    confidence: 0.95,
    sourceUrl,
    observedAt: new Date(),
  };
  const publishedAt = result.firstPublicationDate
    ? new Date(result.firstPublicationDate)
    : undefined;
  const fields: Array<[string, unknown]> = [
    ['title', result.title],
    ['doi', doi],
    ['year', result.pubYear ? Number(result.pubYear) : undefined],
    ['publishedAt', publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined],
    ['venue', result.journalTitle],
    ['authors', result.authorString ? result.authorString.split(/\s*,\s*/).filter(Boolean) : undefined],
    ['url', sourceUrl],
    ['externalIds', externalIds],
    [PAPER_AUTHORSHIP_EVIDENCE_FIELD, evidence],
    ['sources', [sourceConfig.sourceName]],
  ];

  return fields
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([field, value]) => ({
      entityType: 'paper' as const,
      entityKey,
      field,
      value,
      sourceUrl,
      ...(field === PAPER_AUTHORSHIP_EVIDENCE_FIELD
        ? { confidenceOverride: evidence.confidence }
        : {}),
    }));
}

export class EuropePmcPaperScraper implements IScraper {
  readonly name: string;
  readonly displayName: string;

  private readonly userModel: { find: typeof User.find };
  private readonly fetcher: EuropePmcFetcher;
  private readonly pageSize: number;
  private readonly sourceConfig: EuropePmcSourceConfig;

  constructor(
    options: EuropePmcPaperScraperOptions = {},
    sourceConfig: EuropePmcSourceConfig = EUROPE_PMC_SOURCE_CONFIG,
  ) {
    this.name = sourceConfig.sourceName;
    this.displayName = sourceConfig.displayName;
    this.sourceConfig = sourceConfig;
    this.userModel = options.userModel || User;
    this.fetcher = options.fetcher || defaultFetcher;
    this.pageSize = options.pageSize || 100;
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
      userType: { $in: ['professor', 'faculty'] },
      orcid: { $exists: true, $ne: null, $nin: [''] },
    };
    if (ctx.options.only?.length) {
      filter.netid = { $in: ctx.options.only.map((value) => value.trim()).filter(Boolean) };
    }

    let query = this.userModel
      .find(filter, { _id: 1, netid: 1, fname: 1, lname: 1, orcid: 1 })
      .sort({ netid: 1, _id: 1 });
    if (offsetOption && offsetOption > 0) query = query.skip(offsetOption);
    if (limitOption && limitOption > 0) query = query.limit(limitOption);
    const users: any[] = await query.lean();
    let totalObs = 0;
    let totalPapers = 0;
    let failures = 0;

    for (const user of users) {
      const orcid = normalizeOrcid(user.orcid);
      const displayName = `${String(user.fname || '').trim()} ${String(user.lname || '').trim()}`.trim();
      if (!orcid || !displayName) continue;
      try {
        const query = this.sourceConfig.queryForOrcid(orcid);
        const payload = (await this.fetcher(query, this.pageSize)) as {
          resultList?: { result?: EuropePmcResult[] };
        };
        const results = (payload?.resultList?.result || []).filter(this.sourceConfig.includeResult);
        const observations = results.flatMap((result) =>
          resultToObservations(result, {
            userId: serializedDocumentId(user._id) || '',
            netid: user.netid ? String(user.netid) : undefined,
            displayName,
            orcid,
          }, this.sourceConfig),
        );
        if (observations.length > 0) {
          await ctx.emit(observations);
          totalObs += observations.length;
          totalPapers += new Set(observations.map((obs) => obs.entityKey)).size;
        }
        await ctx.emit({
          entityType: 'user',
          entityKey: String(user.netid || ''),
          field: this.sourceConfig.syncField,
          value: new Date(),
          sourceUrl: `https://europepmc.org/search?query=AUTHORID:${encodeURIComponent(orcid)}`,
        });
        totalObs++;
      } catch (error: any) {
        failures++;
        ctx.log(`${this.displayName} failed for Yale author candidate: ${sanitizeLogValue(error)}`);
      }
    }

    return {
      observationCount: totalObs,
      entitiesObserved: totalPapers,
      notes: `Synced ${this.displayName} for ${users.length} users (${totalPapers} papers, ${failures} failures).`,
    };
  }
}

export class PubMedPaperScraper extends EuropePmcPaperScraper {
  constructor(options: EuropePmcPaperScraperOptions = {}) {
    super(options, PUBMED_SOURCE_CONFIG);
  }
}
