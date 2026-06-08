import { ResearchEntity } from '../models/researchEntity';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { getMeiliIndex } from '../utils/meiliClient';
import { isPublicHttpUrl } from '../utils/urlSafety';

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
  sortableAttributes: ['browseRankScore', 'lastObservedAt', 'name', 'createdAt', 'updatedAt'],
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

const SEARCH_INDEX_TEXT_FIELDS = [
  'name',
  'displayName',
  'description',
  'summary',
  'shortDescription',
  'fullDescription',
  'undergradEvidenceQuote',
  'undergradAccessEvidence',
] as const;

const publicHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    return isPublicHttpUrl(trimmed) ? trimmed : undefined;
  } catch {
    return undefined;
  }
};

const publicHttpUrls = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => publicHttpUrl(item) ?? [])
    : [];

const sanitizeResearchEntityIndexDocument = (out: Record<string, any>) => {
  for (const field of SEARCH_INDEX_TEXT_FIELDS) {
    if (typeof out[field] === 'string') {
      out[field] = redactDirectContactInfo(out[field]);
    }
  }

  const websiteUrl = publicHttpUrl(out.websiteUrl);
  const website = publicHttpUrl(out.website);
  if (websiteUrl || website) out.websiteUrl = websiteUrl || website;
  else delete out.websiteUrl;

  if (website) out.website = website;
  else delete out.website;

  if ('sourceUrls' in out) {
    const sourceUrls = publicHttpUrls(out.sourceUrls);
    if (sourceUrls.length > 0) out.sourceUrls = sourceUrls;
    else delete out.sourceUrls;
  }
};

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
  sanitizeResearchEntityIndexDocument(out);
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

function normalizeRebuildPageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return 250;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error('--page-size must be a safe positive integer');
  }
  return pageSize;
}

export async function rebuildResearchEntitySearchIndex(
  options: ResearchEntitySearchIndexRebuildOptions = {},
): Promise<ResearchEntitySearchIndexRebuildResult> {
  const pageSize = normalizeRebuildPageSize(options.pageSize);
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
