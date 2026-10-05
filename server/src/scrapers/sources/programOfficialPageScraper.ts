import mongoose from 'mongoose';
import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { YALE_FELLOWSHIP_DATABASE_SOURCE } from '../fellowshipSourcePrecedence';
import {
  confirmGoneLanePage,
  fetchFailureHttpStatus,
  lanePageHealthObservation,
  lanePageReadVerdict,
  type LanePageProbe,
} from '../lanePageHealth';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import { landsAwayFromRequestedResource } from '../../services/sourceLinkHealth';
import {
  PROGRAM_OFFICIAL_PAGE_SOURCE,
  chooseOfficialPage,
  officialPageNamesFund,
  officialPageText,
} from '../utils/programOfficialPage';
import programOfficialPageSeeds from '../data/programOfficialPageSeeds.json';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

export { PROGRAM_OFFICIAL_PAGE_SOURCE };

const FETCH_TIMEOUT_MS = 30_000;

export interface ProgramOfficialPageCandidate {
  recordId: string;
  sourceKey: string;
  title: string;
  pageUrl: string;
  storedSourceLinkHealth?: unknown;
}

export interface OfficialPageFetch {
  html: string;
  finalUrl: string;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function seedPageUrlsByRecordId(
  seeds: { seeds?: Array<{ recordId?: unknown; pageUrl?: unknown }> } = programOfficialPageSeeds,
): Map<string, string> {
  const byRecordId = new Map<string, string>();
  for (const seed of seeds.seeds ?? []) {
    const recordId = textValue(seed.recordId);
    const pageUrl = textValue(seed.pageUrl);
    if (recordId && pageUrl) byRecordId.set(recordId, pageUrl);
  }
  return byRecordId;
}

async function ownCitedPagesBySourceKey(sourceKeys: string[]): Promise<Map<string, string>> {
  const cited = await Observation.find({
    sourceName: PROGRAM_OFFICIAL_PAGE_SOURCE,
    entityType: 'fellowship',
    field: 'sourceUrl',
    superseded: false,
    entityKey: { $in: sourceKeys },
  })
    .select('entityKey value observedAt')
    .sort({ observedAt: -1 })
    .lean<Array<{ entityKey?: string; value?: unknown }>>();
  const byKey = new Map<string, string>();
  for (const observation of cited) {
    const key = textValue(observation.entityKey);
    if (key && !byKey.has(key)) byKey.set(key, textValue(observation.value));
  }
  return byKey;
}

export async function readProgramOfficialPageCandidates(options: {
  only?: string[];
  limit?: number;
}): Promise<ProgramOfficialPageCandidate[]> {
  const only = (options.only ?? []).map((value) => value.trim()).filter(Boolean);
  const onlyIds = only.filter((value) => mongoose.isValidObjectId(value));
  const rows = await Fellowship.find({
    sourceName: YALE_FELLOWSHIP_DATABASE_SOURCE,
    archived: { $ne: true },
    sourceKey: { $type: 'string', $ne: '' },
    ...(only.length
      ? {
          $or: [
            { sourceKey: { $in: only } },
            ...(onlyIds.length ? [{ _id: { $in: onlyIds } }] : []),
          ],
        }
      : {}),
  })
    .select('_id title sourceKey sourceUrl sourceLinkHealth')
    .lean<
      Array<{
        _id: unknown;
        title?: string;
        sourceKey?: string;
        sourceUrl?: string;
        sourceLinkHealth?: unknown;
      }>
    >();
  const seeds = seedPageUrlsByRecordId();
  const ownCited = await ownCitedPagesBySourceKey(rows.map((row) => textValue(row.sourceKey)));
  const candidates: ProgramOfficialPageCandidate[] = [];
  for (const row of rows) {
    const recordId = String(row._id);
    const sourceKey = textValue(row.sourceKey);
    const title = textValue(row.title);
    const pageUrl = chooseOfficialPage({
      storedSourceUrl: row.sourceUrl,
      ownCitedUrl: ownCited.get(sourceKey),
      seedUrl: seeds.get(recordId),
    });
    if (!title || !pageUrl) continue;
    candidates.push({
      recordId,
      sourceKey,
      title,
      pageUrl,
      ...(row.sourceLinkHealth ? { storedSourceLinkHealth: row.sourceLinkHealth } : {}),
    });
  }
  candidates.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  return typeof options.limit === 'number' && options.limit > 0
    ? candidates.slice(0, options.limit)
    : candidates;
}

export async function fetchOfficialPage(url: string): Promise<OfficialPageFetch> {
  const page = await fetchPageWithPolicy(url, { timeoutMs: FETCH_TIMEOUT_MS });
  return { html: page.html, finalUrl: page.url || url };
}

export function officialPageCitationObservation(
  candidate: Pick<ProgramOfficialPageCandidate, 'sourceKey' | 'pageUrl'>,
  namesFund: boolean,
  observedAt: Date,
): ObservationInput {
  return {
    entityType: 'fellowship',
    entityKey: candidate.sourceKey,
    field: 'sourceUrl',
    value: namesFund ? candidate.pageUrl : '',
    sourceUrl: candidate.pageUrl,
    observedAt,
  };
}

export class ProgramOfficialPageScraper implements IScraper {
  readonly name = PROGRAM_OFFICIAL_PAGE_SOURCE;
  readonly displayName = 'Program official page citation';

  constructor(
    private readonly readCandidates: (options: {
      only?: string[];
      limit?: number;
    }) => Promise<ProgramOfficialPageCandidate[]> = readProgramOfficialPageCandidates,
    private readonly fetchPage: (url: string) => Promise<OfficialPageFetch> = fetchOfficialPage,
    private readonly probePage?: LanePageProbe,
  ) {}

  async run(context: ScraperContext): Promise<ScraperResult> {
    const candidates = await this.readCandidates({
      only: context.options.only,
      limit: context.options.limit,
    });
    const reads = new Map<string, Promise<OfficialPageFetch | { error: unknown }>>();
    const readOnce = (url: string) => {
      const pending =
        reads.get(url) ??
        this.fetchPage(url).then(
          (page) => page,
          (error: unknown) => ({ error }),
        );
      reads.set(url, pending);
      return pending;
    };
    const tally = { cited: 0, notNamed: 0, gone: 0, unread: 0 };
    const partialFailures: string[] = [];
    let observationCount = 0;
    for (const candidate of candidates) {
      const observedAt = context.options.referenceDate ?? new Date();
      const read = await readOnce(candidate.pageUrl);
      const observations: ObservationInput[] = [];
      if ('error' in read) {
        const verdict = await confirmGoneLanePage(
          candidate.pageUrl,
          {
            httpStatusCode: fetchFailureHttpStatus(read.error),
            storedHealth: candidate.storedSourceLinkHealth
              ? [candidate.storedSourceLinkHealth]
              : undefined,
          },
          this.probePage,
        );
        if (verdict) {
          observations.push(
            lanePageHealthObservation(
              { entityType: 'fellowship', entityKey: candidate.sourceKey },
              verdict,
            ),
          );
          tally.gone += 1;
        } else {
          tally.unread += 1;
          partialFailures.push(`${candidate.sourceKey}: official page could not be read`);
        }
      } else if (landsAwayFromRequestedResource(candidate.pageUrl, read.finalUrl)) {
        tally.unread += 1;
        partialFailures.push(`${candidate.sourceKey}: official page landed away from itself`);
      } else {
        const naming = officialPageNamesFund(candidate.title, officialPageText(read.html));
        observations.push(
          lanePageHealthObservation(
            { entityType: 'fellowship', entityKey: candidate.sourceKey },
            lanePageReadVerdict(candidate.pageUrl, read.finalUrl),
          ),
          officialPageCitationObservation(candidate, naming.named, observedAt),
        );
        if (naming.named) tally.cited += 1;
        else tally.notNamed += 1;
        context.log(
          `${candidate.sourceKey}: ${naming.named ? `cited (${naming.phrase})` : 'page does not name the fund'}`,
        );
      }
      if (observations.length > 0) {
        await context.emit(observations);
        observationCount += observations.length;
      }
    }
    return {
      observationCount,
      entitiesObserved: candidates.length,
      ...(partialFailures.length ? { partialFailures } : {}),
      notes:
        `cited=${tally.cited}; notNamed=${tally.notNamed}; gone=${tally.gone}; unread=${tally.unread}. ` +
        'Cites a program official page as sourceUrl only when the page names the fund.',
    };
  }
}
