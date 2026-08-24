import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { Researcher } from '../models/researcher';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { researchEntityServesPublicDetail } from './researchEntityPublicDescription';
import { getMeiliIndex } from '../utils/meiliClient';
import { serializedDocumentId } from '../utils/idSerialization';
import { normalizeResearchAreaList } from '../utils/researchAreaHygiene';
import {
  publicResearcherDisplayName,
  publicResearcherText,
  researcherHasPrimaryIdentityLink,
} from './researcherDto';

export const RESEARCHER_SEARCH_INDEX_NAME = 'researchers';
export const RESEARCHER_SEARCH_INDEX_PRIMARY_KEY = 'id';
export const RESEARCHER_SEARCH_MAX_TOTAL_HITS = 100000;

const MAX_INDEXED_HOME_NAMES = 25;
const MAX_INDEXED_RESEARCH_AREAS = 40;

const RESEARCHER_SEARCH_INDEX_SETTINGS = {
  searchableAttributes: ['displayName', 'title', 'primaryDepartment', 'homeNames', 'researchAreas', 'school'],
  filterableAttributes: ['status', 'archived'],
  sortableAttributes: ['homeCount', 'displayName'],
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

export interface ResearcherHomeAggregates {
  homeNames: string[];
  researchAreas: string[];
  school?: string;
  homeCount: number;
}

export type ResearcherHomeAggregateMap = Map<string, ResearcherHomeAggregates>;

const toObjectIds = (values: unknown[]): mongoose.Types.ObjectId[] => {
  const seen = new Set<string>();
  const out: mongoose.Types.ObjectId[] = [];
  for (const value of values) {
    const id = serializedDocumentId(value);
    if (!id || seen.has(id) || !mongoose.isValidObjectId(id)) continue;
    seen.add(id);
    out.push(new mongoose.Types.ObjectId(id));
  }
  return out;
};

export async function fetchResearcherPublicHomeAggregates(
  personIds: unknown[],
): Promise<ResearcherHomeAggregateMap> {
  const ids = toObjectIds(personIds);
  if (ids.length === 0) return new Map();

  const assignments = await RoleAssignment.find({
    personId: { $in: ids },
    'target.kind': 'RESEARCH_ENTITY',
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('personId target.id')
    .lean();

  const entityIdsByPerson = new Map<string, Set<string>>();
  const allEntityIds = new Set<string>();
  for (const assignment of assignments as any[]) {
    const personKey = serializedDocumentId(assignment?.personId);
    const entityKey = serializedDocumentId(assignment?.target?.id);
    if (!personKey || !entityKey) continue;
    const set = entityIdsByPerson.get(personKey) ?? new Set<string>();
    set.add(entityKey);
    entityIdsByPerson.set(personKey, set);
    allEntityIds.add(entityKey);
  }
  if (allEntityIds.size === 0) return new Map();

  const entities = await ResearchEntity.find({
    _id: { $in: Array.from(allEntityIds).map((id) => new mongoose.Types.ObjectId(id)) },
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  }).lean();

  const servableById = new Map<string, Record<string, any>>();
  for (const entity of entities as Record<string, any>[]) {
    if (!publicStudentVisibilityTiers.includes(entity.studentVisibilityTier)) continue;
    if (!researchEntityServesPublicDetail(entity)) continue;
    const id = serializedDocumentId(entity._id);
    if (id) servableById.set(id, entity);
  }

  const aggregates: ResearcherHomeAggregateMap = new Map();
  for (const [personKey, entitySet] of entityIdsByPerson) {
    const homeNames: string[] = [];
    const researchAreas: string[] = [];
    const schoolCounts = new Map<string, number>();
    let homeCount = 0;

    for (const entityKey of entitySet) {
      const entity = servableById.get(entityKey);
      if (!entity) continue;
      homeCount += 1;

      const name = typeof entity.name === 'string' ? entity.name.trim() : '';
      if (name && homeNames.length < MAX_INDEXED_HOME_NAMES) homeNames.push(name);

      if (Array.isArray(entity.researchAreas)) {
        for (const area of entity.researchAreas) {
          if (typeof area === 'string' && area.trim()) researchAreas.push(area.trim());
        }
      }

      const school = typeof entity.school === 'string' ? entity.school.trim() : '';
      if (school) schoolCounts.set(school, (schoolCounts.get(school) || 0) + 1);
    }

    let school: string | undefined;
    let bestCount = 0;
    for (const [candidate, count] of schoolCounts) {
      if (count > bestCount) {
        school = candidate;
        bestCount = count;
      }
    }

    aggregates.set(personKey, {
      homeNames,
      researchAreas: normalizeResearchAreaList(researchAreas).slice(0, MAX_INDEXED_RESEARCH_AREAS),
      ...(school ? { school } : {}),
      homeCount,
    });
  }

  return aggregates;
}

const EMPTY_HOME_AGGREGATES: ResearcherHomeAggregates = {
  homeNames: [],
  researchAreas: [],
  homeCount: 0,
};

export function buildResearcherSearchIndexDocument(
  researcher: any,
  aggregates: ResearcherHomeAggregates = EMPTY_HOME_AGGREGATES,
): Record<string, any> | null {
  if (!researcher) return null;
  if (researcher.archived === true) return null;
  if (researcher.status === 'DEPARTED') return null;

  const id = serializedDocumentId(researcher._id ?? researcher.id);
  if (!id) return null;

  const displayName = publicResearcherDisplayName(researcher.displayName);
  if (!displayName) return null;

  if (aggregates.homeCount === 0 && !researcherHasPrimaryIdentityLink(researcher.profileLinks)) {
    return null;
  }

  const doc: Record<string, any> = {
    id,
    displayName,
    status: typeof researcher.status === 'string' ? researcher.status : 'UNKNOWN',
    archived: false,
    homeCount: aggregates.homeCount,
  };

  const title = publicResearcherText(researcher.profile?.title);
  if (title) doc.title = title;
  const primaryDepartment = publicResearcherText(researcher.profile?.primaryDepartment);
  if (primaryDepartment) doc.primaryDepartment = primaryDepartment;
  if (aggregates.homeNames.length > 0) doc.homeNames = aggregates.homeNames;
  if (aggregates.researchAreas.length > 0) doc.researchAreas = aggregates.researchAreas;
  if (aggregates.school) doc.school = aggregates.school;

  return doc;
}

export async function buildResearcherSearchIndexDocumentsWithHomes(
  researchers: any[],
  fetchAggregates: (
    personIds: unknown[],
  ) => Promise<ResearcherHomeAggregateMap> = fetchResearcherPublicHomeAggregates,
): Promise<Record<string, any>[]> {
  const aggregates = await fetchAggregates(researchers.map((researcher) => researcher?._id ?? researcher?.id));
  return researchers
    .map((researcher) =>
      buildResearcherSearchIndexDocument(
        researcher,
        aggregates.get(serializedDocumentId(researcher?._id ?? researcher?.id) || '') ??
          EMPTY_HOME_AGGREGATES,
      ),
    )
    .filter((doc): doc is Record<string, any> => doc !== null);
}

export interface ResearcherSearchIndexRebuildOptions {
  pageSize?: number;
  clearExisting?: boolean;
  getIndex?: typeof getMeiliIndex;
  fetchPage?: (page: number, pageSize: number) => Promise<any[]>;
  fetchAggregates?: (personIds: unknown[]) => Promise<ResearcherHomeAggregateMap>;
}

export interface ResearcherSearchIndexRebuildResult {
  indexName: string;
  pageSize: number;
  fetchedDocumentCount: number;
  indexedDocumentCount: number;
  pageCount: number;
  clearedExisting: boolean;
}

async function fetchResearcherPage(page: number, pageSize: number): Promise<any[]> {
  return Researcher.find({ archived: { $ne: true }, status: { $ne: 'DEPARTED' } })
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

const MEILI_SETTINGS_TASK_WAIT_TIMEOUT_MS = 180_000;

interface MeiliTaskAwareIndex {
  tasks?: {
    waitForTask: (
      taskUid: number,
      options?: { timeout?: number },
    ) => Promise<{ status: string; error?: unknown }>;
  };
}

async function assertMeiliSettingsTaskSucceeded(
  index: MeiliTaskAwareIndex,
  enqueued: unknown,
  label: string,
): Promise<void> {
  const taskUid = (enqueued as { taskUid?: number })?.taskUid;
  if (typeof index.tasks?.waitForTask !== 'function' || typeof taskUid !== 'number') return;

  const task = await index.tasks.waitForTask(taskUid, {
    timeout: MEILI_SETTINGS_TASK_WAIT_TIMEOUT_MS,
  });
  if (task.status !== 'succeeded') {
    throw new Error(
      `Meilisearch ${label} task ${taskUid} did not succeed (status: ${task.status}): ${JSON.stringify(task.error)}`,
    );
  }
}

export async function rebuildResearcherSearchIndex(
  options: ResearcherSearchIndexRebuildOptions = {},
): Promise<ResearcherSearchIndexRebuildResult> {
  const pageSize = normalizeRebuildPageSize(options.pageSize);
  const clearExisting = options.clearExisting ?? false;
  const index = await (options.getIndex || getMeiliIndex)(RESEARCHER_SEARCH_INDEX_NAME);
  const fetchPage = options.fetchPage || fetchResearcherPage;
  const fetchAggregates = options.fetchAggregates || fetchResearcherPublicHomeAggregates;

  const settingsTask = await index.updateSettings(getResearcherSearchIndexSettings());
  await assertMeiliSettingsTaskSucceeded(index, settingsTask, 'updateSettings');
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
    const indexDocs = await buildResearcherSearchIndexDocumentsWithHomes(docs, fetchAggregates);
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
