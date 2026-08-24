import mongoose from 'mongoose';
import { Researcher } from '../models/researcher';
import { getMeiliIndex } from '../utils/meiliClient';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  publicResearcherDisplayName,
  publicResearcherText,
  researcherHasPrimaryIdentityLink,
} from './researcherDto';
import {
  RESEARCHER_SEARCH_INDEX_NAME,
  fetchResearcherPublicHomeAggregates,
} from './researcherSearchIndexService';

export interface PublicResearcherSummary {
  id: string;
  publicKey: string;
  displayName: string;
  title?: string;
  primaryDepartment?: string;
  school?: string;
  homeCount: number;
}

const DEFAULT_RESEARCHER_SEARCH_LIMIT = 6;
const MAX_RESEARCHER_SEARCH_LIMIT = 12;

const boundedLimit = (limit: number | undefined): number => {
  if (!Number.isFinite(limit) || limit === undefined) return DEFAULT_RESEARCHER_SEARCH_LIMIT;
  return Math.min(MAX_RESEARCHER_SEARCH_LIMIT, Math.max(1, Math.floor(limit)));
};

const orderedResearcherIds = async (query: string, limit: number): Promise<string[]> => {
  try {
    const index = await getMeiliIndex(RESEARCHER_SEARCH_INDEX_NAME);
    const result = await index.search(query, {
      limit,
      filter: ['archived = false', 'status != DEPARTED'],
      attributesToRetrieve: ['id'],
    });
    const hits = Array.isArray(result?.hits) ? result.hits : [];
    return hits
      .map((hit: any) => serializedDocumentId(hit?.id))
      .filter((id: string): id is string => Boolean(id) && mongoose.isValidObjectId(id));
  } catch (error) {
    console.error('Researcher search index query failed:', sanitizeLogValue(error));
    return [];
  }
};

/**
 * Person-first findability for `/research`: a name query returns matching
 * researchers as their own results, not only entity cards that mention them.
 * Meili supplies match ordering; the served summaries are always rebuilt from
 * live Mongo state so a researcher archived or departed after indexing never
 * survives, and each summary re-applies the same public gate as the index and
 * the researcher detail DTO.
 */
export async function searchResearchersViaMeili(
  rawQuery: string,
  limit = DEFAULT_RESEARCHER_SEARCH_LIMIT,
): Promise<PublicResearcherSummary[]> {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!query) return [];

  const ids = await orderedResearcherIds(query, boundedLimit(limit));
  if (ids.length === 0) return [];

  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const researchers = (await Researcher.find({
    _id: { $in: objectIds },
    archived: { $ne: true },
    status: { $ne: 'DEPARTED' },
  })
    .select('_id displayName profile profileLinks')
    .lean()) as Array<Record<string, any>>;

  const researcherById = new Map<string, Record<string, any>>();
  for (const researcher of researchers) {
    const id = serializedDocumentId(researcher._id);
    if (id) researcherById.set(id, researcher);
  }

  const aggregates = await fetchResearcherPublicHomeAggregates(
    researchers.map((researcher) => researcher._id),
  );

  const summaries: PublicResearcherSummary[] = [];
  for (const id of ids) {
    const researcher = researcherById.get(id);
    if (!researcher) continue;

    const displayName = publicResearcherDisplayName(researcher.displayName);
    if (!displayName) continue;

    const homeAggregates = aggregates.get(id);
    const homeCount = homeAggregates?.homeCount ?? 0;
    if (homeCount === 0 && !researcherHasPrimaryIdentityLink(researcher.profileLinks)) continue;

    const title = publicResearcherText(researcher.profile?.title);
    const primaryDepartment = publicResearcherText(researcher.profile?.primaryDepartment);
    const school = homeAggregates?.school;

    summaries.push({
      id,
      publicKey: id,
      displayName,
      ...(title ? { title } : {}),
      ...(primaryDepartment ? { primaryDepartment } : {}),
      ...(school ? { school } : {}),
      homeCount,
    });
  }

  return summaries;
}
