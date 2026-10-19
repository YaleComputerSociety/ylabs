import mongoose from 'mongoose';
import { ResearchEntity } from '../../models/researchEntity';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import {
  buildCenterRosterHealthSnapshot,
  CENTER_AFFILIATION_ROSTER_SOURCE_NAME,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  type CenterRosterReadMember,
} from '../centerRosterRetirement';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  centerAffiliationPageObservations,
  extractCenterAffiliationsFromPage,
  readListedLabLead,
  type CenterAffiliationReadOutcome,
  type ListedLabLead,
} from '../utils/centerAffiliationPageExtractor';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../utils/mapWithConcurrency';

export { CENTER_AFFILIATION_ROSTER_SOURCE_NAME };

const ORG_ENTITY_TYPES = ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'];
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const LISTED_AFFILIATION_ROLE = 'affiliated';
const MAX_LISTED_LAB_PAGES = 12;

export interface CenterAffiliationRosterTarget {
  slug: string;
  name: string;
  websiteUrl: string;
}

export type CenterAffiliationPageFetcher = (url: string) => Promise<{ url: string; html: string }>;

export type CenterAffiliationTargetFinder = (
  only: string[],
) => Promise<CenterAffiliationRosterTarget[]>;

export interface CenterAffiliationRosterScraperDeps {
  fetchPage?: CenterAffiliationPageFetcher;
  findTargets?: CenterAffiliationTargetFinder;
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

async function defaultFindTargets(only: string[]): Promise<CenterAffiliationRosterTarget[]> {
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
    .lean()) as Array<{ slug?: string; name?: string; websiteUrl?: string }>;
  return docs
    .map((doc) => ({
      slug: textValue(doc.slug),
      name: textValue(doc.name),
      websiteUrl: textValue(doc.websiteUrl),
    }))
    .filter((target) => target.slug && target.websiteUrl);
}

export function centerAffiliationReadMembers(
  observations: readonly ObservationInput[],
): CenterRosterReadMember[] {
  const relationshipKeys = new Set(
    observations
      .filter((observation) => observation.entityType === 'researchEntityRelationship')
      .map((observation) => observation.entityKey)
      .filter((key): key is string => Boolean(key)),
  );
  return Array.from(relationshipKeys).map((relationshipKey) => ({
    memberKey: relationshipKey,
    role: LISTED_AFFILIATION_ROLE,
    relationshipKey,
  }));
}

export function centerAffiliationRosterSnapshotObservation(input: {
  centerEntityKey: string;
  sourceUrl: string;
  members: readonly CenterRosterReadMember[];
  readAt: Date;
}): ObservationInput {
  return {
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    entityKey: input.centerEntityKey,
    field: CENTER_ROSTER_HEALTH_FIELD,
    value: buildCenterRosterHealthSnapshot({
      centerKey: input.centerEntityKey,
      entityKey: input.centerEntityKey,
      members: input.members,
      pagesRead: 1,
      readMode: 'html',
      stopReason: 'not-paginated',
      cacheAllowed: false,
      readAt: input.readAt,
    }),
    sourceUrl: input.sourceUrl,
    observedAt: input.readAt,
  };
}

function sameHost(left: string, right: string): boolean {
  try {
    return new URL(left).host.toLowerCase() === new URL(right).host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The listed labs whose own pages sit on the center's site, the only pages the lane
 * follows to learn who heads a lab that no row's website serves.
 */
export function listedLabPages(page: {
  url: string;
  html: string;
}): Array<{ url: string; name: string }> {
  const { labs } = extractCenterAffiliationsFromPage({ html: page.html, pageUrl: page.url });
  const pages = new Map<string, string>();
  for (const lab of labs) {
    if (lab.url && sameHost(lab.url, page.url) && !pages.has(lab.url)) pages.set(lab.url, lab.name);
  }
  return Array.from(pages, ([url, name]) => ({ url, name })).slice(0, MAX_LISTED_LAB_PAGES);
}

export function centerAffiliationRosterObservations(input: {
  centerEntityKey: string;
  page: { url: string; html: string };
  readAt: Date;
  labLeads?: ReadonlyMap<string, ListedLabLead>;
}): { outcome: CenterAffiliationReadOutcome; observations: ObservationInput[] } {
  const extracted = extractCenterAffiliationsFromPage({
    html: input.page.html,
    pageUrl: input.page.url,
  });
  if (extracted.outcome !== 'listed') return { outcome: extracted.outcome, observations: [] };
  const read = {
    ...extracted,
    labs: extracted.labs.map((lab) => {
      const lead = lab.url ? input.labLeads?.get(lab.url) : undefined;
      return lead ? { ...lab, lead } : lab;
    }),
  };
  const relationships = centerAffiliationPageObservations(read, {
    centerEntityKey: input.centerEntityKey,
    sourceUrl: input.page.url,
  });
  const members = centerAffiliationReadMembers(relationships);
  if (members.length === 0) return { outcome: read.outcome, observations: [] };
  return {
    outcome: read.outcome,
    observations: [
      ...relationships,
      centerAffiliationRosterSnapshotObservation({
        centerEntityKey: input.centerEntityKey,
        sourceUrl: input.page.url,
        members,
        readAt: input.readAt,
      }),
    ],
  };
}

type ReadTally = Record<CenterAffiliationReadOutcome | 'fetch-failed', number>;

export class CenterAffiliationRosterScraper implements IScraper {
  readonly name = CENTER_AFFILIATION_ROSTER_SOURCE_NAME;
  readonly displayName = 'Center affiliation roster (faculty & labs, deterministic)';

  private readonly fetchPage: CenterAffiliationPageFetcher;
  private readonly findTargets: CenterAffiliationTargetFinder;

  constructor(deps: CenterAffiliationRosterScraperDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.findTargets = deps.findTargets ?? defaultFindTargets;
  }

  async readListedLabLeads(
    page: { url: string; html: string },
    log: (message: string) => void,
    slug: string,
  ): Promise<Map<string, ListedLabLead>> {
    const leads = new Map<string, ListedLabLead>();
    for (const { url, name } of listedLabPages(page)) {
      let labPage: { url: string; html: string };
      try {
        labPage = await this.fetchPage(url);
      } catch (error) {
        log(`[${slug}] listed lab page fetch failed: ${sanitizeLogValue(error)}`);
        continue;
      }
      const lead = readListedLabLead({
        html: labPage.html,
        pageUrl: labPage.url,
        labName: name,
      });
      if (lead) leads.set(url, lead);
    }
    return leads;
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
    const tally: ReadTally = { listed: 0, 'prose-only': 0, empty: 0, 'fetch-failed': 0 };
    let observationCount = 0;
    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );

    await mapWithConcurrency(targets, concurrency, async (target) => {
      let page: { url: string; html: string };
      try {
        page = await this.fetchPage(target.websiteUrl);
      } catch (error) {
        ctx.log(
          `[${target.slug}] fetch failed for the center's website: ${sanitizeLogValue(error)}`,
        );
        tally['fetch-failed'] += 1;
        return;
      }
      const { outcome, observations } = centerAffiliationRosterObservations({
        centerEntityKey: target.slug,
        page,
        readAt: ctx.options.referenceDate ?? new Date(),
        labLeads: await this.readListedLabLeads(page, ctx.log, target.slug),
      });
      tally[outcome] += 1;
      if (observations.length === 0) {
        ctx.log(`[${target.slug}] no listed affiliation (${outcome}).`);
        return;
      }
      await ctx.emit(observations);
      observationCount += observations.length;
      ctx.log(`[${target.slug}] listed ${observations.length - 1} affiliation observation(s).`);
    });

    return {
      observationCount,
      entitiesObserved: tally.listed,
      notes:
        `Read ${targets.length} centers: ${tally.listed} listed affiliations, ` +
        `${tally['prose-only']} stated people only in prose, ${tally.empty} listed nobody, ` +
        `${tally['fetch-failed']} fetch failure(s).`,
    };
  }
}
