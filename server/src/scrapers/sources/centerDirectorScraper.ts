/**
 * Center director, read with code from an organizational research home's own pages.
 *
 * The deterministic replacement for `center-director-llm` (#5296): the same page always
 * yields the same observations. For each CENTER / INSTITUTE / INITIATIVE / CORE_FACILITY
 * with an official `websiteUrl`, it reads the home's own page and the leadership pages
 * inside its own subtree, settles one director with `decideCenterDirector`, and emits the
 * same entity-level `inferredDirector*` observations the LLM lane emits, so
 * `materializeInferredDirectorMembership` resolves the name to a unique Researcher before
 * any lead edge is written.
 *
 * A page that names two directors at the same rank is refused, and a page that states a
 * director only in prose the patterns cannot settle emits nothing: no observation field
 * holds unsettled page text for materialize-time interpretation yet.
 */
import mongoose from 'mongoose';
import { LEAD_ROLE_CANONICAL_VALUES } from '../../models/canonicalRoleMapping';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import { normalizeName, splitName } from '../utils/scraperHelpers';
import {
  centerDirectorCandidateUrls,
  decideCenterDirector,
  readCenterDirectorSignals,
  statedCenterDirectors,
  type CenterDirectorCandidate,
  type CenterDirectorDecision,
  type CenterDirectorPageSignals,
} from '../utils/centerDirectorPageRead';
import { CENTER_DIRECTOR_LLM_SOURCE_NAME } from './centerDirectorLLMExtractor';
import {
  CENTER_DIRECTOR_SOURCE_NAME,
  centerDirectorReadSnapshotObservation,
} from '../centerDirectorReadSnapshot';

export { CENTER_DIRECTOR_SOURCE_NAME };

const ORG_ENTITY_TYPES = ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'];
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const DIRECTOR_ROLE_CONFIDENCE = 0.85;

const DIRECTOR_LANES = new Set([CENTER_DIRECTOR_SOURCE_NAME, CENTER_DIRECTOR_LLM_SOURCE_NAME]);

export interface CenterDirectorTarget {
  slug: string;
  name: string;
  websiteUrl: string;
}

export type CenterDirectorPageFetcher = (url: string) => Promise<{ url: string; html: string }>;

export type CenterDirectorTargetFinder = (only: string[]) => Promise<CenterDirectorTarget[]>;

export interface CenterDirectorScraperDeps {
  fetchPage?: CenterDirectorPageFetcher;
  findTargets?: CenterDirectorTargetFinder;
}

export interface CenterDirectorRead {
  decision: CenterDirectorDecision;
  pagesRead: string[];
  stated: Array<{ name: string; role: 'director' | 'co-director' }>;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

async function defaultFetchPage(url: string): Promise<{ url: string; html: string }> {
  const page = await fetchPageWithPolicy(url, {
    timeoutMs: 15_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    maxRedirects: 5,
  });
  return { url: page.url, html: page.html };
}

/**
 * Every organizational home with an official website whose current lead, if any, came
 * from a director lane. A home another lane already leads is left to that lane, so this
 * lane never adds a second lead beside a roster's own.
 */
async function defaultFindTargets(only: string[]): Promise<CenterDirectorTarget[]> {
  const onlyIds = only
    .filter((value) => OBJECT_ID_RE.test(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const identity = only.length
    ? {
        $or: [
          ...(onlyIds.length ? [{ _id: { $in: onlyIds } }] : []),
          { slug: { $in: only } },
          { name: { $in: only } },
        ],
      }
    : {};
  const docs = (await ResearchEntity.find(
    {
      $and: [
        { entityType: { $in: ORG_ENTITY_TYPES } },
        { archived: { $ne: true } },
        { websiteUrl: /^https?:\/\//i },
        identity,
      ],
    },
    { _id: 1, slug: 1, name: 1, websiteUrl: 1 },
  )
    .sort({ slug: 1 })
    .lean()) as Array<{ _id: unknown; slug?: string; name?: string; websiteUrl?: string }>;
  const leadEdges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: docs.map((doc) => doc._id) },
    role: { $in: LEAD_ROLE_CANONICAL_VALUES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('target.id rosterProvenance.sourceName')
    .lean()) as Array<{ target?: { id?: unknown }; rosterProvenance?: { sourceName?: string } }>;
  const ledByAnotherLane = new Set(
    leadEdges
      .filter((edge) => !DIRECTOR_LANES.has(textValue(edge.rosterProvenance?.sourceName)))
      .map((edge) => serializedDocumentId(edge.target?.id)),
  );
  return docs
    .filter((doc) => !ledByAnotherLane.has(serializedDocumentId(doc._id)))
    .map((doc) => ({
      slug: textValue(doc.slug),
      name: textValue(doc.name),
      websiteUrl: textValue(doc.websiteUrl),
    }))
    .filter((target) => target.slug && target.name && target.websiteUrl);
}

export function centerDirectorObservations(
  director: CenterDirectorCandidate,
  centerEntityKey: string,
): ObservationInput[] {
  const name = normalizeName(director.name);
  const { last } = splitName(name);
  const fname = name.split(/\s+/).filter(Boolean)[0] || '';
  if (!centerEntityKey || !fname || !last || fname === last) return [];
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: centerEntityKey,
    sourceUrl: director.pageUrl,
  };
  const observations: ObservationInput[] = [
    { ...base, field: 'inferredDirectorName', value: name },
    { ...base, field: 'inferredDirectorUserName', value: { fname, lname: last } },
    {
      ...base,
      field: 'inferredDirectorRole',
      value: director.role,
      confidenceOverride: DIRECTOR_ROLE_CONFIDENCE,
    },
  ];
  if (director.title) {
    observations.push({ ...base, field: 'inferredDirectorTitle', value: director.title });
  }
  if (director.profileUrl) {
    observations.push({ ...base, field: 'inferredDirectorProfileUrl', value: director.profileUrl });
  }
  return observations;
}

type ReadOutcome = CenterDirectorDecision['outcome'] | 'unreadable';

export class CenterDirectorScraper implements IScraper {
  readonly name = CENTER_DIRECTOR_SOURCE_NAME;
  readonly displayName = 'Center director (organizational lead, deterministic)';

  private readonly fetchPage: CenterDirectorPageFetcher;
  private readonly findTargets: CenterDirectorTargetFinder;

  constructor(deps: CenterDirectorScraperDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.findTargets = deps.findTargets ?? defaultFindTargets;
  }

  async readCenter(
    target: CenterDirectorTarget,
    log: (message: string) => void = () => {},
  ): Promise<CenterDirectorRead | null> {
    let landing: { url: string; html: string };
    try {
      landing = await this.fetchPage(target.websiteUrl);
    } catch (error) {
      log(`[${target.slug}] fetch failed for the home's website: ${sanitizeLogValue(error)}`);
      return null;
    }
    const pages: CenterDirectorPageSignals[] = [];
    const pagesRead: string[] = [];
    for (const url of centerDirectorCandidateUrls(landing.url, landing.html)) {
      let page = url === landing.url ? landing : null;
      if (!page) {
        try {
          page = await this.fetchPage(url);
        } catch (error) {
          log(`[${target.slug}] leadership page fetch failed: ${sanitizeLogValue(error)}`);
          continue;
        }
      }
      pages.push(readCenterDirectorSignals(page.html, page.url, target.name));
      pagesRead.push(page.url);
    }
    return {
      decision: decideCenterDirector(pages),
      pagesRead,
      stated: statedCenterDirectors(pages),
    };
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = Array.from(
      new Set((ctx.options.only || []).map((value) => String(value).trim()).filter(Boolean)),
    );
    const offset = Math.max(0, Number(ctx.options.offset) || 0);
    const limit =
      ctx.options.exhaustive && ctx.options.limit === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Number(ctx.options.limit) || 100);
    const targets = (await this.findTargets(only)).slice(offset, offset + limit);

    const outcomes: Record<ReadOutcome, number> = {
      named: 0,
      ambiguous: 0,
      'prose-only': 0,
      none: 0,
      unreadable: 0,
    };
    let observationCount = 0;
    for (const target of targets) {
      const read = await this.readCenter(target, ctx.log);
      if (!read) {
        outcomes.unreadable += 1;
        continue;
      }
      const { decision } = read;
      outcomes[decision.outcome] += 1;
      const director = decision.outcome === 'named' ? decision.director : null;
      const observations = director ? centerDirectorObservations(director, target.slug) : [];
      const settled =
        director && observations.length > 0 ? { name: director.name, role: director.role } : null;
      if (read.pagesRead.length > 0) {
        observations.push(
          centerDirectorReadSnapshotObservation({
            centerEntityKey: target.slug,
            sourceUrl: read.pagesRead[0],
            stated: read.stated,
            settled,
            pagesRead: read.pagesRead.length,
            cacheAllowed: ctx.options.useCache !== false,
            readAt: ctx.options.referenceDate ?? new Date(),
          }),
        );
      }
      if (observations.length > 0) {
        await ctx.emit(observations);
        observationCount += observations.length;
      }
      ctx.log(
        director && settled
          ? `[${target.slug}] director read from ${director.signal}.`
          : `[${target.slug}] no director settled (${decision.outcome}).`,
      );
    }

    return {
      observationCount,
      entitiesObserved: outcomes.named,
      notes:
        `Read ${targets.length} organizational homes: ${outcomes.named} named a director, ` +
        `${outcomes.ambiguous} refused as ambiguous, ${outcomes['prose-only']} stated one only in prose, ` +
        `${outcomes.none} stated none, ${outcomes.unreadable} unreadable.`,
    };
  }
}
