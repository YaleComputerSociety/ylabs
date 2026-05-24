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
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const EUROPE_PMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

export type EuropePmcFetcher = (orcid: string, pageSize: number) => Promise<unknown>;

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
  allowedResultSources?: string[];
}

const EUROPE_PMC_SOURCE_CONFIG: EuropePmcSourceConfig = {
  sourceName: 'europe-pmc',
  displayName: 'Europe PMC ORCID paper sync',
  authorshipMethod: 'europepmc-orcid',
  syncField: 'europePmcWorksSyncedAt',
};

const PUBMED_SOURCE_CONFIG: EuropePmcSourceConfig = {
  sourceName: 'pubmed',
  displayName: 'PubMed ORCID paper sync via Europe PMC',
  authorshipMethod: 'pubmed-orcid',
  syncField: 'pubmedWorksSyncedAt',
  allowedResultSources: ['MED'],
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

const defaultFetcher: EuropePmcFetcher = async (orcid, pageSize) => {
  const res = await axios.get(EUROPE_PMC_BASE, {
    timeout: 30000,
    params: {
      query: `AUTHORID:"${orcid}"`,
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

function parsePublicationDate(result: EuropePmcResult): Date | undefined {
  if (!result.firstPublicationDate) return undefined;
  const publishedAt = new Date(result.firstPublicationDate);
  return Number.isNaN(publishedAt.getTime()) ? undefined : publishedAt;
}

function publicationYear(result: EuropePmcResult, publishedAt: Date | undefined): number | undefined {
  if (publishedAt) return publishedAt.getUTCFullYear();
  const year = result.pubYear ? Number(result.pubYear) : undefined;
  return year && Number.isInteger(year) ? year : undefined;
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
  if (
    sourceConfig.allowedResultSources?.length &&
    !sourceConfig.allowedResultSources.includes(String(result.source || '').toUpperCase())
  ) {
    return [];
  }
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
  const publishedAt = parsePublicationDate(result);
  const fields: Array<[string, unknown]> = [
    ['title', result.title],
    ['doi', doi],
    ['year', publicationYear(result, publishedAt)],
    ['publishedAt', publishedAt],
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

function serializeObservationValueForRunDedupe(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '__null__';
  if (typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function runDedupeKeyForObservation(obs: ObservationInput): string | undefined {
  if (obs.field === PAPER_AUTHORSHIP_EVIDENCE_FIELD) return undefined;
  const entity = obs.entityId || obs.entityKey;
  if (!entity) return undefined;
  return JSON.stringify([
    obs.entityType,
    String(entity),
    obs.field,
    serializeObservationValueForRunDedupe(obs.value),
  ]);
}

function filterDuplicateRunObservations(
  observations: ObservationInput[],
  seenKeys: Set<string>,
): ObservationInput[] {
  return observations.filter((obs) => {
    const key = runDedupeKeyForObservation(obs);
    if (!key) return true;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
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
    if (ctx.options.offset && ctx.options.offset > 0) query = query.skip(ctx.options.offset);
    if (ctx.options.limit && ctx.options.limit > 0) query = query.limit(ctx.options.limit);
    const users: any[] = await query.lean();
    let totalObs = 0;
    let failures = 0;
    const paperKeysObserved = new Set<string>();
    const emittedObservationKeys = new Set<string>();

    for (const user of users) {
      const orcid = normalizeOrcid(user.orcid);
      const displayName = `${String(user.fname || '').trim()} ${String(user.lname || '').trim()}`.trim();
      if (!orcid || !displayName) continue;
      try {
        const payload = (await this.fetcher(orcid, this.pageSize)) as {
          resultList?: { result?: EuropePmcResult[] };
        };
        const results = payload?.resultList?.result || [];
        const observations = results.flatMap((result) =>
          resultToObservations(result, {
            userId: String(user._id),
            netid: user.netid ? String(user.netid) : undefined,
            displayName,
            orcid,
          }, this.sourceConfig),
        );
        for (const obs of observations) {
          if (obs.entityType === 'paper' && obs.entityKey) paperKeysObserved.add(obs.entityKey);
        }
        const observationsToEmit = filterDuplicateRunObservations(
          observations,
          emittedObservationKeys,
        );
        if (observationsToEmit.length > 0) {
          await ctx.emit(observationsToEmit);
          totalObs += observationsToEmit.length;
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
        ctx.log(`${this.displayName} failed for ${user.netid || orcid}: ${error?.message || error}`);
      }
    }

    return {
      observationCount: totalObs,
      entitiesObserved: paperKeysObserved.size,
      notes: `Synced ${this.displayName} for ${users.length} users (${paperKeysObserved.size} papers, ${failures} failures).`,
    };
  }
}

export class PubMedPaperScraper extends EuropePmcPaperScraper {
  constructor(options: EuropePmcPaperScraperOptions = {}) {
    super(options, PUBMED_SOURCE_CONFIG);
  }
}
