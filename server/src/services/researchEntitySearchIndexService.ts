import { ResearchEntity } from '../models/researchEntity';
import { getMeiliIndex } from '../utils/meiliClient';

export const RESEARCH_ENTITY_SEARCH_INDEX_NAME = 'researchentities';
export const RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY = 'id';

const RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS = {
  searchableAttributes: [
    'name',
    'displayName',
    'description',
    'summary',
    'departments',
    'researchAreas',
    'keywords',
    'school',
    'kind',
    'entityType',
    'websiteUrl',
    'sourceUrls',
  ],
  filterableAttributes: [
    'archived',
    'kind',
    'school',
    'departments',
    'researchAreas',
    'openness',
    'acceptingUndergrads',
    'acceptanceConfidence',
    'offersIndependentStudy',
    'currentUndergradCount',
    'studentVisibilityTier',
  ],
  sortableAttributes: ['lastObservedAt', 'name', 'createdAt', 'updatedAt'],
  displayedAttributes: ['*'],
};

export interface ResearchEntitySearchIndexRebuildOptions {
  pageSize?: number;
  clearExisting?: boolean;
  getIndex?: typeof getMeiliIndex;
  fetchPage?: (page: number, pageSize: number) => Promise<any[]>;
}

export interface ResearchEntitySearchIndexRebuildResult {
  indexName: string;
  pageSize: number;
  fetchedDocumentCount: number;
  indexedDocumentCount: number;
  pageCount: number;
  clearedExisting: boolean;
}

export function getResearchEntitySearchIndexSettings() {
  return {
    searchableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.searchableAttributes],
    filterableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.filterableAttributes],
    sortableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.sortableAttributes],
    displayedAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.displayedAttributes],
  };
}

export function buildResearchEntitySearchIndexDocument(doc: any): Record<string, any> | null {
  if (!doc) return null;
  const rawId = doc._id ?? doc.id;
  if (rawId == null) return null;

  const out: Record<string, any> = {
    ...doc,
    id: String(rawId),
  };
  delete out._id;
  delete out.__v;
  delete out.embedding;
  return out;
}

export function buildResearchEntitySearchIndexDocuments(docs: any[]): Record<string, any>[] {
  return docs
    .map((doc) => buildResearchEntitySearchIndexDocument(doc))
    .filter((doc): doc is Record<string, any> => doc !== null);
}

async function fetchResearchEntityPage(page: number, pageSize: number): Promise<any[]> {
  return ResearchEntity.find({})
    .sort({ _id: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();
}

export async function rebuildResearchEntitySearchIndex(
  options: ResearchEntitySearchIndexRebuildOptions = {},
): Promise<ResearchEntitySearchIndexRebuildResult> {
  const pageSize = Math.max(1, Math.floor(options.pageSize || 250));
  const clearExisting = options.clearExisting ?? false;
  const index = await (options.getIndex || getMeiliIndex)(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
  const fetchPage = options.fetchPage || fetchResearchEntityPage;

  await index.updateSettings(getResearchEntitySearchIndexSettings());
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
    const indexDocs = buildResearchEntitySearchIndexDocuments(docs);
    indexedDocumentCount += indexDocs.length;
    if (indexDocs.length > 0) {
      await index.addDocuments(indexDocs, {
        primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
      });
    }

    if (docs.length < pageSize) break;
    page += 1;
  }

  return {
    indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
    pageSize,
    fetchedDocumentCount,
    indexedDocumentCount,
    pageCount,
    clearedExisting: clearExisting,
  };
}
