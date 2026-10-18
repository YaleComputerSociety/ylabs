import mongoose from 'mongoose';
import { LEAD_ROLE_CANONICAL_VALUES } from '../../models/canonicalRoleMapping';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment, rosterIdentityBases } from '../../models/roleAssignment';
import { CENTERS_INSTITUTES_SOURCE_NAME } from '../centerRosterRetirement';
import type { IScraper, ScraperContext, ScraperResult } from '../types';
import {
  CENTER_MEMBER_PROFILE_RESEARCH_SOURCE,
  PERSONAL_RESEARCH_ROW_TYPES,
  fdsMemberProfileExtractor,
  planCenterMemberProfileResearch,
  type CenterMemberIdentityJoin,
  type CenterMemberProfileExtractor,
  type CenterMemberProfileRead,
  type PersonalResearchRow,
} from '../utils/centerMemberProfileResearch';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';
import { DEFAULT_CENTER_CONFIGS, type CenterConfig } from './centersInstitutesScraper';

const FETCH_TIMEOUT_MS = 30_000;
const PROFILE_FETCH_CONCURRENCY = 2;

export interface CenterMemberProfileLaneConfig {
  centerKey: string;
  profileExtractor: CenterMemberProfileExtractor;
}

export const CENTER_MEMBER_PROFILE_LANE_CONFIGS: readonly CenterMemberProfileLaneConfig[] = [
  { centerKey: 'fds', profileExtractor: fdsMemberProfileExtractor },
];

export type PageFetcher = (url: string) => Promise<string>;

const fetchPage: PageFetcher = async (url) =>
  (await fetchPageWithPolicy(url, { timeoutMs: FETCH_TIMEOUT_MS })).html;

const objectIds = (ids: readonly string[]): mongoose.Types.ObjectId[] =>
  ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));

export async function loadIdentityJoins(
  profileUrls: readonly string[],
): Promise<CenterMemberIdentityJoin[]> {
  if (profileUrls.length === 0) return [];
  const edges = (await RoleAssignment.find({
    'rosterProvenance.sourceName': CENTERS_INSTITUTES_SOURCE_NAME,
    'rosterProvenance.profileUrl': { $in: [...profileUrls] },
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

export class CenterMemberProfileResearchScraper implements IScraper {
  readonly name = CENTER_MEMBER_PROFILE_RESEARCH_SOURCE;
  readonly displayName = 'Center member profile research';

  constructor(
    private readonly laneConfigs: readonly CenterMemberProfileLaneConfig[] = CENTER_MEMBER_PROFILE_LANE_CONFIGS,
    private readonly centerConfigs: readonly CenterConfig[] = DEFAULT_CENTER_CONFIGS,
    private readonly pageFetcher: PageFetcher = fetchPage,
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = ctx.options.only?.length ? new Set(ctx.options.only) : null;
    let observationCount = 0;
    let entitiesObserved = 0;
    const notes: string[] = [];
    for (const lane of this.laneConfigs) {
      const center = this.centerConfigs.find((config) => config.centerKey === lane.centerKey);
      if (!center) throw new Error(`No center config for ${lane.centerKey}`);
      const rosterHtml = await this.pageFetcher(center.url);
      const profileUrls = [
        ...new Set(
          center
            .extractor(rosterHtml, { pageUrl: center.url, centerName: center.centerName })
            .members.map((member) => member.profileUrl || '')
            .filter(Boolean),
        ),
      ].slice(0, ctx.options.limit ?? undefined);
      const reads: CenterMemberProfileRead[] = profileUrls.map((profileUrl) => ({ profileUrl }));
      await mapWithConcurrency(reads, PROFILE_FETCH_CONCURRENCY, async (read) => {
        try {
          read.text = lane.profileExtractor(await this.pageFetcher(read.profileUrl));
        } catch {
          read.text = undefined;
        }
      });
      const joins = await loadIdentityJoins(profileUrls);
      const rows = await loadPersonalResearchRows([...new Set(joins.map((join) => join.personId))]);
      const plan = planCenterMemberProfileResearch({ reads, joins, rows });
      const observations = plan.observations.filter(
        (obs) => !only || only.has(String(obs.entityKey)),
      );
      if (observations.length) await ctx.emit(observations);
      observationCount += observations.length;
      entitiesObserved += new Set(observations.map((obs) => obs.entityId)).size;
      const summary = `${lane.centerKey}: ${profileUrls.length} profiles, ${plan.emittedRows} rows; skipped ${JSON.stringify(plan.skipped)}`;
      ctx.log(summary);
      notes.push(summary);
    }
    return { observationCount, entitiesObserved, notes: notes.join('; ') };
  }
}
