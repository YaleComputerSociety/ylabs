/**
 * ORCID public works scraper.
 *
 * ORCID records are accepted Yale-user identifiers in this pipeline. A work
 * listed on an accepted user's public ORCID record is therefore authorship
 * evidence for that user. The paper metadata can then be enriched later by
 * arXiv/OpenAlex/Crossref without those sources inventing faculty links.
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

const ORCID_BASE = 'https://pub.orcid.org/v3.0';
const OBSERVATION_EMIT_BATCH_SIZE = 1000;

export type OrcidWorksFetcher = (orcid: string) => Promise<unknown>;

export interface OrcidWorksScraperOptions {
  userModel?: { find: typeof User.find };
  fetcher?: OrcidWorksFetcher;
}

export interface ParsedOrcidWork {
  putCode: string;
  title: string;
  type?: string;
  venue?: string;
  year?: number;
  doi?: string;
  pmid?: string;
  arxivId?: string;
  sourceUrl?: string;
  externalIds: Record<string, string>;
}

interface OrcidOwner {
  userId: string;
  netid?: string;
  displayName: string;
  orcid: string;
}

const defaultFetcher: OrcidWorksFetcher = async (orcid) => {
  const res = await axios.get(`${ORCID_BASE}/${encodeURIComponent(orcid)}/works`, {
    timeout: 30000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'yalelabs.io ORCID work sync (mailto:info@yalelabs.io)',
    },
  });
  return res.data;
};

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return textValue((value as Record<string, unknown>).value);
  }
  return undefined;
}

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
  const normalized = raw
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '');
  return normalized || undefined;
}

function normalizeArxivId(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, '')
    .replace(/^arxiv:/i, '')
    .replace(/v\d+$/i, '');
  return normalized || undefined;
}

function parseYear(summary: Record<string, unknown>): number | undefined {
  const rawYear = textValue(
    (summary['publication-date'] as Record<string, unknown> | undefined)?.year,
  );
  const year = rawYear ? Number(rawYear) : NaN;
  return Number.isFinite(year) ? year : undefined;
}

function parseExternalIds(summary: Record<string, unknown>): Record<string, string> {
  const externalIds = (summary['external-ids'] as Record<string, unknown> | undefined)?.[
    'external-id'
  ];
  const rows = Array.isArray(externalIds) ? externalIds : externalIds ? [externalIds] : [];
  const parsed: Record<string, string> = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const type = textValue(record['external-id-type'])?.toLowerCase();
    const value = textValue(record['external-id-value']);
    if (!type || !value) continue;
    if (type === 'doi') parsed.DOI = normalizeDoi(value) || value;
    else if (type === 'pmid') parsed.PMID = value;
    else if (type === 'arxiv') parsed.arxiv = normalizeArxivId(value) || value;
    else parsed[type] = value;
  }
  return parsed;
}

export function parseOrcidWorks(payload: unknown): ParsedOrcidWork[] {
  const groups = Array.isArray((payload as any)?.group) ? (payload as any).group : [];
  const works: ParsedOrcidWork[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const summaries = Array.isArray(group?.['work-summary'])
      ? group['work-summary']
      : group?.['work-summary']
        ? [group['work-summary']]
        : [];
    for (const rawSummary of summaries) {
      if (!rawSummary || typeof rawSummary !== 'object') continue;
      const summary = rawSummary as Record<string, unknown>;
      const title = textValue((summary.title as Record<string, unknown> | undefined)?.title);
      const putCode = textValue(summary['put-code']) || String(summary['put-code'] || '');
      if (!title || !putCode) continue;
      const externalIds = parseExternalIds(summary);
      const doi = normalizeDoi(externalIds.DOI);
      const pmid = externalIds.PMID;
      const arxivId = normalizeArxivId(externalIds.arxiv);
      if (!doi && !arxivId && !pmid) continue;

      const identityKey = arxivId || doi || pmid || putCode;
      if (seen.has(identityKey)) continue;
      seen.add(identityKey);

      works.push({
        putCode,
        title,
        type: textValue(summary.type),
        venue: textValue(summary['journal-title']),
        year: parseYear(summary),
        doi,
        pmid,
        arxivId,
        sourceUrl: textValue(summary.url),
        externalIds: {
          ...externalIds,
          ...(doi ? { DOI: doi } : {}),
          ...(arxivId ? { arxiv: arxivId } : {}),
        },
      });
    }
  }

  return works;
}

function entityKeyForWork(work: ParsedOrcidWork): string | undefined {
  if (work.arxivId) return work.arxivId;
  if (work.doi) return `doi:${work.doi}`;
  return undefined;
}

export function orcidWorkSummaryToObservations(
  work: ParsedOrcidWork,
  owner: OrcidOwner,
): ObservationInput[] {
  const entityKey = entityKeyForWork(work);
  if (!entityKey) return [];

  const sourceUrl =
    work.sourceUrl || `https://orcid.org/${owner.orcid}/work/${encodeURIComponent(work.putCode)}`;
  const evidence: PaperAuthorshipEvidence = {
    userId: owner.userId,
    netid: owner.netid,
    displayName: owner.displayName,
    sourceName: 'orcid',
    method: 'orcid-record',
    externalAuthorIds: {
      orcid: owner.orcid,
    },
    confidence: 0.95,
    sourceUrl,
    observedAt: new Date(),
  };
  const base = {
    entityType: 'paper' as const,
    entityKey,
    sourceUrl,
  };
  const fields: Array<[string, unknown]> = [
    ['title', work.title],
    ['doi', work.doi],
    ['arxivId', work.arxivId],
    ['year', work.year],
    ['venue', work.venue],
    ['url', sourceUrl],
    ['publicationTypes', work.type ? [work.type] : undefined],
    ['externalIds', work.externalIds],
    [PAPER_AUTHORSHIP_EVIDENCE_FIELD, evidence],
    ['sources', ['orcid']],
  ];

  return fields
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([field, value]) => ({
      ...base,
      field,
      value,
      ...(field === PAPER_AUTHORSHIP_EVIDENCE_FIELD
        ? { confidenceOverride: evidence.confidence }
        : {}),
    }));
}

export class OrcidWorksScraper implements IScraper {
  readonly name = 'orcid';
  readonly displayName = 'ORCID public works sync';

  private readonly userModel: { find: typeof User.find };
  private readonly fetcher: OrcidWorksFetcher;

  constructor(options: OrcidWorksScraperOptions = {}) {
    this.userModel = options.userModel || User;
    this.fetcher = options.fetcher || defaultFetcher;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const offsetOption = ctx.options.offset;
    if (
      offsetOption !== undefined &&
      (!Number.isSafeInteger(offsetOption) || offsetOption < 0)
    ) {
      throw new Error('--offset must be a safe non-negative integer');
    }
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    const filter: any = {
      userType: { $in: ['professor', 'faculty'] },
      orcid: { $exists: true, $ne: null, $nin: [''] },
    };
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()).filter(Boolean))
        : null;
    if (onlyFilter) {
      filter.netid = { $in: Array.from(onlyFilter) };
    }

    let query = this.userModel
      .find(filter, {
        _id: 1,
        netid: 1,
        fname: 1,
        lname: 1,
        orcid: 1,
      })
      .sort({ netid: 1, _id: 1 });
    if (offsetOption && offsetOption > 0) {
      query = query.skip(offsetOption);
    }
    if (limitOption) {
      query = query.limit(limitOption);
    }

    const users: any[] = await query.lean();
    const pending: ObservationInput[] = [];
    let totalObs = 0;
    let totalWorks = 0;
    let failures = 0;

    const flush = async () => {
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      await ctx.emit(batch);
    };

    for (const user of users) {
      const orcid = normalizeOrcid(user.orcid);
      const displayName = `${String(user.fname || '').trim()} ${String(user.lname || '').trim()}`.trim();
      if (!orcid || !displayName) continue;
      try {
        const payload = await this.fetcher(orcid);
        const works = parseOrcidWorks(payload);
        for (const work of works) {
          const observations = orcidWorkSummaryToObservations(work, {
            userId: serializedDocumentId(user._id) || '',
            netid: user.netid ? String(user.netid) : undefined,
            displayName,
            orcid,
          });
          pending.push(...observations);
          totalObs += observations.length;
          totalWorks++;
          if (pending.length >= OBSERVATION_EMIT_BATCH_SIZE) {
            await flush();
          }
        }
        pending.push({
          entityType: 'user',
          entityKey: String(user.netid || ''),
          field: 'orcidWorksSyncedAt',
          value: new Date(),
          sourceUrl: `https://orcid.org/${orcid}`,
        });
        totalObs++;
      } catch (error: any) {
        failures++;
        ctx.log(`ORCID works fetch failed for Yale author candidate: ${sanitizeLogValue(error)}`);
      }
    }
    await flush();

    return {
      observationCount: totalObs,
      entitiesObserved: totalWorks,
      notes: `Synced ORCID works for ${users.length} users (${totalWorks} works, ${failures} failures).`,
    };
  }
}
