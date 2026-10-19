import mongoose from 'mongoose';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { CENTERS_INSTITUTES_SOURCE_NAME } from '../centerRosterRetirement';
import type { IScraper, ScraperContext, ScraperResult } from '../types';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';
import { PERSONAL_RESEARCH_ROW_TYPES } from '../utils/centerMemberProfileResearch';
import {
  CENTER_PROFILE_RESEARCH_ROWS_SOURCE,
  centerProfileResearchRowObservations,
  normalizeCitedUrl,
  planCenterProfileResearchRows,
  type CenterProfileRowCandidate,
  type CenterProfileRowCoverage,
} from '../utils/centerProfileResearchRows';
import { rosterBioPersonNameKey } from '../utils/rosterBioResearchEvidence';
import {
  CENTER_MEMBER_PROFILE_LANE_CONFIGS,
  fetchCenterProfilePage,
  hostOf,
  loadIdentityJoins,
  loadPersonalResearchRows,
  type CenterMemberProfileLaneConfig,
  type PageFetcher,
} from './centerMemberProfileResearchScraper';

const PROFILE_FETCH_CONCURRENCY = 2;

export async function loadCenterProfileRowCoverage(): Promise<CenterProfileRowCoverage> {
  const rows = (await ResearchEntity.find({})
    .select('slug name websiteUrl sourceUrls archived entityType')
    .lean()) as Array<Record<string, any>>;
  const slugs = new Set<string>();
  const citedUrls = new Set<string>();
  const personalRowNames = new Set<string>();
  for (const row of rows) {
    if (row.slug) slugs.add(row.slug);
    for (const url of [row.websiteUrl, ...(Array.isArray(row.sourceUrls) ? row.sourceUrls : [])]) {
      if (url) citedUrls.add(normalizeCitedUrl(url));
    }
    if (PERSONAL_RESEARCH_ROW_TYPES.includes(row.entityType)) {
      const nameKey = rosterBioPersonNameKey(row.name);
      if (nameKey) personalRowNames.add(nameKey);
    }
  }
  const leadKeys = (await Observation.find({ field: 'inferredPiUserKey', superseded: false })
    .select('entityKey value')
    .lean()) as Array<{ entityKey?: string; value?: unknown }>;
  const inferredLeadKeys = new Set(
    leadKeys.flatMap((row) =>
      row.entityKey && slugs.has(row.entityKey) && typeof row.value === 'string'
        ? [row.value.trim().toLowerCase()]
        : [],
    ),
  );
  return { slugs, citedUrls, personalRowNames, inferredLeadKeys };
}

async function listedTitleByProfileUrl(
  profileUrls: readonly string[],
): Promise<Map<string, string>> {
  const memberKeys = (await Observation.find({
    sourceName: CENTERS_INSTITUTES_SOURCE_NAME,
    entityType: 'researchGroupMember',
    field: 'profileUrl',
    value: { $in: [...profileUrls] },
    superseded: false,
  })
    .select('entityKey value')
    .lean()) as Array<{ entityKey?: string; value?: unknown }>;
  const urlByKey = new Map(memberKeys.map((row) => [String(row.entityKey), String(row.value)]));
  const titles = (await Observation.find({
    sourceName: CENTERS_INSTITUTES_SOURCE_NAME,
    entityType: 'researchGroupMember',
    field: 'title',
    entityKey: { $in: [...urlByKey.keys()] },
    superseded: false,
  })
    .select('entityKey value')
    .lean()) as Array<{ entityKey?: string; value?: unknown }>;
  const byUrl = new Map<string, string>();
  for (const row of titles) {
    const url = urlByKey.get(String(row.entityKey));
    if (url && typeof row.value === 'string' && row.value.trim()) byUrl.set(url, row.value.trim());
  }
  return byUrl;
}

/**
 * Mints a faculty-research row for an identity-proven center member who leads none, when
 * their own center profile states research they do now. Manual-only: the owner reviews the
 * rows a run plans before the lane joins the sweep.
 */
export class CenterProfileResearchRowsScraper implements IScraper {
  readonly name = CENTER_PROFILE_RESEARCH_ROWS_SOURCE;
  readonly displayName = 'Center profile research rows';

  constructor(
    private readonly laneConfigs: readonly CenterMemberProfileLaneConfig[] = CENTER_MEMBER_PROFILE_LANE_CONFIGS,
    private readonly pageFetcher: PageFetcher = fetchCenterProfilePage,
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const extractorByHost = new Map(
      this.laneConfigs.map((lane) => [lane.profileHost, lane.profileExtractor]),
    );
    const joins = await loadIdentityJoins([...extractorByHost.keys()]);
    const peopleByUrl = new Map<string, Set<string>>();
    for (const join of joins) {
      peopleByUrl.set(
        join.profileUrl,
        (peopleByUrl.get(join.profileUrl) ?? new Set()).add(join.personId),
      );
    }
    const leaders = new Set(
      (await loadPersonalResearchRows([...new Set(joins.map((join) => join.personId))])).map(
        (row) => row.personId,
      ),
    );
    const urlsByPerson = new Map<string, string[]>();
    for (const [url, people] of peopleByUrl) {
      if (people.size !== 1) continue;
      const [personId] = people;
      if (leaders.has(personId)) continue;
      urlsByPerson.set(personId, [...(urlsByPerson.get(personId) ?? []), url].sort());
    }

    const researchers = (await Researcher.find({
      _id: { $in: [...urlsByPerson.keys()].map((id) => new mongoose.Types.ObjectId(id)) },
      archived: { $ne: true },
    })
      .select('_id displayName identifiers.netid profile.title title')
      .lean()) as Array<Record<string, any>>;
    const titles = await listedTitleByProfileUrl([...urlsByPerson.values()].flat());
    const candidates: Array<CenterProfileRowCandidate & { urls: string[] }> = researchers
      .map((researcher) => {
        const urls = urlsByPerson.get(String(researcher._id)) ?? [];
        return {
          personId: String(researcher._id),
          displayName: String(researcher.displayName ?? ''),
          netid: researcher.identifiers?.netid,
          title:
            urls.map((url) => titles.get(url)).find(Boolean) ||
            researcher.profile?.title ||
            researcher.title,
          profileUrl: urls[0] ?? '',
          urls,
        };
      })
      .filter((candidate) => candidate.profileUrl)
      .slice(0, ctx.options.limit ?? undefined);

    let unreadProfiles = 0;
    await mapWithConcurrency(candidates, PROFILE_FETCH_CONCURRENCY, async (candidate) => {
      for (const url of candidate.urls) {
        try {
          const text = extractorByHost.get(hostOf(url))?.(await this.pageFetcher(url));
          const joined = [text?.researchStatement, text?.biography].filter(Boolean).join(' ');
          if (joined.length > (candidate.profileText?.length ?? 0)) {
            candidate.profileText = joined;
            candidate.profileUrl = url;
          }
        } catch {
          unreadProfiles += 1;
        }
      }
    });

    const { planned, skipped } = planCenterProfileResearchRows(
      candidates,
      await loadCenterProfileRowCoverage(),
    );
    const only = ctx.options.only?.length ? new Set(ctx.options.only) : null;
    const scoped = planned.filter((row) => !only || only.has(row.slug));
    const observations = scoped.flatMap(centerProfileResearchRowObservations);
    if (observations.length) await ctx.emit(observations);
    const notes = `${candidates.length} members lead no personal row; ${unreadProfiles} profile pages unread; planned ${planned.length}, emitting ${scoped.length}; skipped ${JSON.stringify(skipped)}`;
    ctx.log(notes);
    return { observationCount: observations.length, entitiesObserved: scoped.length, notes };
  }
}
