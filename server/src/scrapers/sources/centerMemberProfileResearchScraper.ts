import mongoose from 'mongoose';
import { LEAD_ROLE_CANONICAL_VALUES } from '../../models/canonicalRoleMapping';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment, rosterIdentityBases } from '../../models/roleAssignment';
import { CENTERS_INSTITUTES_SOURCE_NAME } from '../centerRosterRetirement';
import type { IScraper, ScraperContext, ScraperResult } from '../types';
import {
  CENTER_MEMBER_PROFILE_RESEARCH_FIELDS,
  CENTER_MEMBER_PROFILE_RESEARCH_SOURCE,
  PERSONAL_RESEARCH_ROW_TYPES,
  cowlesPersonProfileExtractor,
  fdsMemberProfileExtractor,
  macmillanPersonProfileExtractor,
  planCenterMemberProfileResearch,
  staleProfileTextRetractions,
  type CenterMemberIdentityJoin,
  type CenterMemberProfileExtractor,
  type CenterMemberProfileRead,
  type LiveProfileTextRow,
  type PersonalResearchRow,
} from '../utils/centerMemberProfileResearch';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';

const FETCH_TIMEOUT_MS = 30_000;
const PROFILE_FETCH_CONCURRENCY = 2;

export interface CenterMemberProfileLaneConfig {
  profileHost: string;
  profileExtractor: CenterMemberProfileExtractor;
}

export const CENTER_MEMBER_PROFILE_LANE_CONFIGS: readonly CenterMemberProfileLaneConfig[] = [
  { profileHost: 'fds.yale.edu', profileExtractor: fdsMemberProfileExtractor },
  { profileHost: 'cowles.yale.edu', profileExtractor: cowlesPersonProfileExtractor },
  { profileHost: 'macmillan.yale.edu', profileExtractor: macmillanPersonProfileExtractor },
];

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

export type PageFetcher = (url: string) => Promise<string>;

const fetchPage: PageFetcher = async (url) =>
  (await fetchPageWithPolicy(url, { timeoutMs: FETCH_TIMEOUT_MS })).html;

const objectIds = (ids: readonly string[]): mongoose.Types.ObjectId[] =>
  ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function loadIdentityJoins(
  profileHosts: readonly string[],
): Promise<CenterMemberIdentityJoin[]> {
  if (profileHosts.length === 0) return [];
  const hostPattern = new RegExp(
    `^https?://(?:www\\.)?(?:${profileHosts.map(escapeRegExp).join('|')})/`,
    'i',
  );
  const edges = (await RoleAssignment.find({
    'rosterProvenance.sourceName': CENTERS_INSTITUTES_SOURCE_NAME,
    'rosterProvenance.profileUrl': hostPattern,
    'rosterProvenance.identityBasis': { $in: [...rosterIdentityBases] },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('personId rosterProvenance.profileUrl')
    .lean()) as Array<{ personId?: unknown; rosterProvenance?: { profileUrl?: string } }>;
  return edges.flatMap((edge) =>
    edge.personId && edge.rosterProvenance?.profileUrl
      ? [{ profileUrl: edge.rosterProvenance.profileUrl, personId: String(edge.personId) }]
      : [],
  );
}

export async function loadPersonalResearchRows(
  personIds: readonly string[],
): Promise<PersonalResearchRow[]> {
  if (personIds.length === 0) return [];
  const edges = (await RoleAssignment.find({
    personId: { $in: objectIds(personIds) },
    role: { $in: [...LEAD_ROLE_CANONICAL_VALUES] },
    'target.kind': 'RESEARCH_ENTITY',
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('personId target.id')
    .lean()) as Array<{ personId?: unknown; target?: { id?: unknown } }>;
  const rows = (await ResearchEntity.find({
    _id: { $in: edges.map((edge) => edge.target?.id).filter(Boolean) },
    archived: { $ne: true },
    entityType: { $in: [...PERSONAL_RESEARCH_ROW_TYPES] },
  })
    .select('_id slug')
    .lean()) as Array<{ _id: unknown; slug?: string }>;
  const slugById = new Map(rows.map((row) => [String(row._id), row.slug || '']));
  return edges.flatMap((edge) => {
    const entityId = String(edge.target?.id ?? '');
    const slug = slugById.get(entityId);
    return slug ? [{ personId: String(edge.personId), entityId, slug }] : [];
  });
}

export async function loadLiveProfileTextRows(): Promise<LiveProfileTextRow[]> {
  const live = (await Observation.find({
    sourceName: CENTER_MEMBER_PROFILE_RESEARCH_SOURCE,
    entityType: 'researchEntity',
    field: { $in: [...CENTER_MEMBER_PROFILE_RESEARCH_FIELDS] },
    superseded: false,
  })
    .select('entityId entityKey sourceUrl value')
    .lean()) as Array<{
    entityId?: unknown;
    entityKey?: string;
    sourceUrl?: string;
    value?: unknown;
  }>;
  return live.flatMap((obs) =>
    obs.entityId && obs.entityKey && obs.sourceUrl && typeof obs.value === 'string' && obs.value
      ? [{ entityId: String(obs.entityId), slug: obs.entityKey, profileUrl: obs.sourceUrl }]
      : [],
  );
}

export class CenterMemberProfileResearchScraper implements IScraper {
  readonly name = CENTER_MEMBER_PROFILE_RESEARCH_SOURCE;
  readonly displayName = 'Center member profile research';

  constructor(
    private readonly laneConfigs: readonly CenterMemberProfileLaneConfig[] = CENTER_MEMBER_PROFILE_LANE_CONFIGS,
    private readonly pageFetcher: PageFetcher = fetchPage,
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = ctx.options.only?.length ? new Set(ctx.options.only) : null;
    const extractorByHost = new Map(
      this.laneConfigs.map((lane) => [lane.profileHost, lane.profileExtractor]),
    );
    // The centers lane walks every roster page and ends a membership the roster stops
    // listing, so its live identity-proven edges are the roster this lane reads.
    const joins = await loadIdentityJoins([...extractorByHost.keys()]);
    const rosterProfileUrls = new Set(joins.map((join) => join.profileUrl));
    if (rosterProfileUrls.size === 0) {
      throw new Error('No identity-proven center memberships link a configured profile host');
    }

    const profileUrls = [...rosterProfileUrls].sort().slice(0, ctx.options.limit ?? undefined);
    const reads: CenterMemberProfileRead[] = profileUrls.map((profileUrl) => ({ profileUrl }));
    await mapWithConcurrency(reads, PROFILE_FETCH_CONCURRENCY, async (read) => {
      const extractor = extractorByHost.get(hostOf(read.profileUrl));
      try {
        read.text = extractor?.(await this.pageFetcher(read.profileUrl));
      } catch {
        read.text = undefined;
      }
    });
    const rows = await loadPersonalResearchRows([...new Set(joins.map((join) => join.personId))]);
    const plan = planCenterMemberProfileResearch({ reads, joins, rows });
    const retractions = staleProfileTextRetractions({
      live: await loadLiveProfileTextRows(),
      reads,
      rosterProfileUrls,
      keptEntityIds: new Set([
        ...plan.observations.map((obs) => String(obs.entityId)),
        ...plan.undecidedEntityIds,
      ]),
    });
    const observations = [...plan.observations, ...retractions].filter(
      (obs) => !only || only.has(String(obs.entityKey)),
    );
    if (observations.length) await ctx.emit(observations);

    const unread = reads.filter((read) => !read.text).length;
    const notes = [
      `${profileUrls.length} profiles (${unread} unread), ${plan.emittedRows} rows`,
      `skipped ${JSON.stringify(plan.skipped)}`,
      `retracted ${retractions.length / CENTER_MEMBER_PROFILE_RESEARCH_FIELDS.length} rows`,
    ].join('; ');
    ctx.log(notes);
    return {
      observationCount: observations.length,
      entitiesObserved: new Set(observations.map((obs) => String(obs.entityId))).size,
      notes,
    };
  }
}
