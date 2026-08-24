import mongoose from 'mongoose';
import {
  Researcher,
  type ResearcherProfileLink,
  type ResearcherStatus,
} from '../models/researcher';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { getMeiliIndex } from '../utils/meiliClient';
import { researchEntityServesPublicDetail } from './researchEntityPublicDescription';
import {
  publiclyFindableResearcherDisplayName,
  researcherHasPrimaryIdentityLink,
  researcherIsPubliclyFindable,
} from './researcherFindability';

export const RESEARCHER_SEARCH_INDEX_NAME = 'researchers';
export const RESEARCHER_SEARCH_INDEX_PRIMARY_KEY = 'id';

export const RESEARCHER_SEARCH_MAX_TOTAL_HITS = 100000;

const MAX_INDEXED_TEXT_LENGTH = 240;

const RESEARCHER_SEARCH_INDEX_SETTINGS = {
  searchableAttributes: ['displayName', 'title', 'primaryDepartment', 'school'],
  filterableAttributes: ['archived', 'status'],
  sortableAttributes: ['displayName', 'homeCount'],
  displayedAttributes: ['*'],
  rankingRules: ['words', 'proximity', 'exactness', 'typo', 'attribute', 'sort'],
  typoTolerance: {
    minWordSizeForTypos: {
      oneTypo: 5,
      twoTypos: 9,
    },
  },
  pagination: {
    maxTotalHits: RESEARCHER_SEARCH_MAX_TOTAL_HITS,
  },
};

export function getResearcherSearchIndexSettings() {
  return {
    searchableAttributes: [...RESEARCHER_SEARCH_INDEX_SETTINGS.searchableAttributes],
    filterableAttributes: [...RESEARCHER_SEARCH_INDEX_SETTINGS.filterableAttributes],
    sortableAttributes: [...RESEARCHER_SEARCH_INDEX_SETTINGS.sortableAttributes],
    displayedAttributes: [...RESEARCHER_SEARCH_INDEX_SETTINGS.displayedAttributes],
    rankingRules: [...RESEARCHER_SEARCH_INDEX_SETTINGS.rankingRules],
    typoTolerance: {
      minWordSizeForTypos: {
        ...RESEARCHER_SEARCH_INDEX_SETTINGS.typoTolerance.minWordSizeForTypos,
      },
    },
    pagination: {
      maxTotalHits: RESEARCHER_SEARCH_INDEX_SETTINGS.pagination.maxTotalHits,
    },
  };
}

export interface ResearcherHomeStats {
  servableHomeCount: number;
  school?: string;
}

export interface ResearcherSearchIndexInputDoc {
  _id?: unknown;
  id?: unknown;
  displayName?: string;
  status?: string;
  archived?: boolean;
  profile?: { title?: string; primaryDepartment?: string };
  profileLinks?: ResearcherProfileLink[];
}

const cleanIndexedText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = redactDirectContactInfo(value)
    .replace(/\[(?:email|phone) redacted\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_INDEXED_TEXT_LENGTH);
  return cleaned.length > 0 ? cleaned : undefined;
};

export function buildResearcherSearchIndexDocument(
  doc: ResearcherSearchIndexInputDoc,
  homeStats: ResearcherHomeStats,
): Record<string, any> | null {
  if (!doc) return null;
  const id = serializedDocumentId(doc._id ?? doc.id);
  if (!id) return null;

  const displayName = publiclyFindableResearcherDisplayName(doc.displayName);
  if (!displayName) return null;

  const servableHomeCount = Math.max(0, Math.trunc(homeStats.servableHomeCount || 0));
  const hasPrimaryIdentityLink = researcherHasPrimaryIdentityLink(doc.profileLinks);

  if (
    !researcherIsPubliclyFindable({
      archived: doc.archived,
      status: doc.status as ResearcherStatus | undefined,
      displayName: doc.displayName,
      servableHomeCount,
      hasPrimaryIdentityLink,
    })
  ) {
    return null;
  }

  const title = cleanIndexedText(doc.profile?.title);
  const primaryDepartment = cleanIndexedText(doc.profile?.primaryDepartment);
  const school = cleanIndexedText(homeStats.school);

  return {
    id,
    publicKey: id,
    displayName,
    status: doc.status ?? 'UNKNOWN',
    archived: false,
    homeCount: servableHomeCount,
    ...(title ? { title } : {}),
    ...(primaryDepartment ? { primaryDepartment } : {}),
    ...(school ? { school } : {}),
  };
}

const mostCommonSchool = (schools: string[]): string | undefined => {
  const counts = new Map<string, number>();
  for (const raw of schools) {
    const school = typeof raw === 'string' ? raw.trim() : '';
    if (school) counts.set(school, (counts.get(school) || 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [school, count] of counts) {
    if (count > bestCount) {
      best = school;
      bestCount = count;
    }
  }
  return best;
};

export async function fetchResearcherHomeStats(
  personIds: mongoose.Types.ObjectId[],
): Promise<Map<string, ResearcherHomeStats>> {
  const stats = new Map<string, ResearcherHomeStats>();
  if (personIds.length === 0) return stats;

  const assignments = await RoleAssignment.find({
    personId: { $in: personIds },
    'target.kind': 'RESEARCH_ENTITY',
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('personId target.id')
    .lean();

  const entityIdsByPerson = new Map<string, Set<string>>();
  const allEntityIds = new Set<string>();
  for (const assignment of assignments as any[]) {
    const personId = serializedDocumentId(assignment?.personId);
    const entityId = serializedDocumentId(assignment?.target?.id);
    if (!personId || !entityId) continue;
    if (!entityIdsByPerson.has(personId)) entityIdsByPerson.set(personId, new Set());
    entityIdsByPerson.get(personId)!.add(entityId);
    allEntityIds.add(entityId);
  }

  const servableEntitySchools = new Map<string, string | undefined>();
  if (allEntityIds.size > 0) {
    const entities = await ResearchEntity.find({
      _id: { $in: Array.from(allEntityIds).map((id) => new mongoose.Types.ObjectId(id)) },
      archived: { $ne: true },
      studentVisibilityTier: { $in: publicStudentVisibilityTiers },
    }).lean();

    for (const entity of entities as Record<string, any>[]) {
      if (!researchEntityServesPublicDetail(entity)) continue;
      const entityId = serializedDocumentId(entity._id ?? entity.id);
      if (!entityId) continue;
      const school = typeof entity.school === 'string' ? entity.school.trim() : undefined;
      servableEntitySchools.set(entityId, school || undefined);
    }
  }

  for (const [personId, entityIds] of entityIdsByPerson) {
    const schools: string[] = [];
    let servableHomeCount = 0;
    for (const entityId of entityIds) {
      if (!servableEntitySchools.has(entityId)) continue;
      servableHomeCount += 1;
      const school = servableEntitySchools.get(entityId);
      if (school) schools.push(school);
    }
    stats.set(personId, { servableHomeCount, school: mostCommonSchool(schools) });
  }

  return stats;
}

export interface ResearcherSearchIndexRebuildOptions {
  pageSize?: number;
  clearExisting?: boolean;
  getIndex?: typeof getMeiliIndex;
  fetchPage?: (page: number, pageSize: number) => Promise<ResearcherSearchIndexInputDoc[]>;
  fetchHomeStats?: (
    personIds: mongoose.Types.ObjectId[],
  ) => Promise<Map<string, ResearcherHomeStats>>;
}

export interface ResearcherSearchIndexRebuildResult {
  indexName: string;
  pageSize: number;
  fetchedDocumentCount: number;
  indexedDocumentCount: number;
  pageCount: number;
  clearedExisting: boolean;
}

async function fetchResearcherPage(
  page: number,
  pageSize: number,
): Promise<ResearcherSearchIndexInputDoc[]> {
  return Researcher.find({ archived: { $ne: true }, status: { $ne: 'DEPARTED' } })
    .select('_id displayName status archived profile profileLinks')
    .sort({ _id: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();
}

function normalizeRebuildPageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return 250;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error('--page-size must be a safe positive integer');
  }
  return pageSize;
}

export async function buildResearcherSearchIndexDocumentsForPage(
  docs: ResearcherSearchIndexInputDoc[],
  fetchHomeStats: (
    personIds: mongoose.Types.ObjectId[],
  ) => Promise<Map<string, ResearcherHomeStats>> = fetchResearcherHomeStats,
): Promise<Record<string, any>[]> {
  const personIds = docs
    .map((doc) => serializedDocumentId(doc._id ?? doc.id))
    .filter((id): id is string => Boolean(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const homeStatsByPerson = await fetchHomeStats(personIds);

  return docs
    .map((doc) => {
      const id = serializedDocumentId(doc._id ?? doc.id);
      const homeStats = (id && homeStatsByPerson.get(id)) || { servableHomeCount: 0 };
      return buildResearcherSearchIndexDocument(doc, homeStats);
    })
    .filter((doc): doc is Record<string, any> => doc !== null);
}

export async function rebuildResearcherSearchIndex(
  options: ResearcherSearchIndexRebuildOptions = {},
): Promise<ResearcherSearchIndexRebuildResult> {
  const pageSize = normalizeRebuildPageSize(options.pageSize);
  const clearExisting = options.clearExisting ?? false;
  const index = await (options.getIndex || getMeiliIndex)(RESEARCHER_SEARCH_INDEX_NAME);
  const fetchPage = options.fetchPage || fetchResearcherPage;
  const fetchHomeStats = options.fetchHomeStats || fetchResearcherHomeStats;

  await index.updateSettings(getResearcherSearchIndexSettings());
  if (clearExisting) {
    await index.deleteAllDocuments();
  }

  let page = 1;
  let fetchedDocumentCount = 0;
  let indexedDocumentCount = 0;
  let pageCount = 0;

  while (true) {
    const docs = await fetchPage(page, pageSize);
    if (docs.length === 0) break;

    fetchedDocumentCount += docs.length;
    pageCount += 1;
    const indexDocs = await buildResearcherSearchIndexDocumentsForPage(docs, fetchHomeStats);
    indexedDocumentCount += indexDocs.length;
    if (indexDocs.length > 0) {
      await index.addDocuments(indexDocs, {
        primaryKey: RESEARCHER_SEARCH_INDEX_PRIMARY_KEY,
      });
    }

    if (docs.length < pageSize) break;
    page += 1;
  }

  return {
    indexName: RESEARCHER_SEARCH_INDEX_NAME,
    pageSize,
    fetchedDocumentCount,
    indexedDocumentCount,
    pageCount,
    clearedExisting: clearExisting,
  };
}

export interface ResearcherSearchHit {
  id: string;
  publicKey: string;
  displayName: string;
  title?: string;
  primaryDepartment?: string;
  school?: string;
  homeCount: number;
}

export interface ResearcherSearchResult {
  hits: ResearcherSearchHit[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

const MAX_RESEARCHER_SEARCH_PAGE_SIZE = 25;

const toResearcherSearchHit = (raw: Record<string, any>): ResearcherSearchHit | null => {
  const id = typeof raw.id === 'string' ? raw.id : serializedDocumentId(raw.id ?? raw._id);
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  if (!id || !displayName) return null;
  return {
    id,
    publicKey: typeof raw.publicKey === 'string' && raw.publicKey ? raw.publicKey : id,
    displayName,
    homeCount: Number.isFinite(raw.homeCount) ? Number(raw.homeCount) : 0,
    ...(typeof raw.title === 'string' && raw.title ? { title: raw.title } : {}),
    ...(typeof raw.primaryDepartment === 'string' && raw.primaryDepartment
      ? { primaryDepartment: raw.primaryDepartment }
      : {}),
    ...(typeof raw.school === 'string' && raw.school ? { school: raw.school } : {}),
  };
};

interface ResearcherSearchIndexLike {
  search: (query: string, params: Record<string, any>) => Promise<any>;
}

export async function searchResearchersViaMeili(
  rawQuery: string,
  options: { page?: number; pageSize?: number; getIndex?: typeof getMeiliIndex } = {},
): Promise<ResearcherSearchResult> {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  const page = Number.isSafeInteger(options.page) && (options.page as number) > 0 ? (options.page as number) : 1;
  const pageSize = Math.min(
    MAX_RESEARCHER_SEARCH_PAGE_SIZE,
    Number.isSafeInteger(options.pageSize) && (options.pageSize as number) > 0
      ? (options.pageSize as number)
      : 10,
  );

  const emptyResult: ResearcherSearchResult = { hits: [], estimatedTotalHits: 0, page, pageSize };
  if (!query) return emptyResult;

  try {
    const index = (await (options.getIndex || getMeiliIndex)(
      RESEARCHER_SEARCH_INDEX_NAME,
    )) as unknown as ResearcherSearchIndexLike;
    const response = await index.search(query, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      filter: ['archived = false'],
    });

    const rawHits: Record<string, any>[] = Array.isArray(response?.hits) ? response.hits : [];
    const hits = rawHits
      .map(toResearcherSearchHit)
      .filter((hit): hit is ResearcherSearchHit => hit !== null);
    const estimatedTotalHits = Number.isFinite(response?.estimatedTotalHits)
      ? Number(response.estimatedTotalHits)
      : hits.length;

    return { hits, estimatedTotalHits, page, pageSize };
  } catch {
    return emptyResult;
  }
}
