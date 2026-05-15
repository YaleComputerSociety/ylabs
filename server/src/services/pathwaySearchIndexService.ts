import {
  getPathwaysByIds,
  searchPathways,
  type PathwaySearchHit,
  type PathwaySearchInput,
  type PathwaySearchResult,
} from './pathwaySearchService';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { getMeiliIndex } from '../utils/meiliClient';

export const PATHWAY_SEARCH_INDEX_NAME = 'pathways';
export const PATHWAY_SEARCH_INDEX_PRIMARY_KEY = 'id';

const MAX_EVIDENCE_ITEMS = 3;
const MAX_EVIDENCE_EXCERPT_LENGTH = 480;
const FORMALIZATION_ONLY_PATHWAY_TYPES = [
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
];

export interface PathwaySearchIndexSettings {
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
  displayedAttributes: string[];
}

export interface PathwaySearchIndexEvidenceDocument {
  signalType?: string;
  confidence?: string;
  confidenceScore?: number;
  excerpt?: string;
  sourceUrl?: string;
  observedAt?: string;
  observedAtTimestamp?: number;
}

export interface PathwaySearchIndexContactRouteDocument {
  routeType?: string;
  label?: string;
  url?: string;
  contactPolicy?: string;
  rationale?: string;
}

export interface PathwaySearchIndexDocument {
  id: string;
  pathwayId: string;
  pathwayType?: string;
  status?: string;
  evidenceStrength?: string;
  compensation?: string;
  studentFacingLabel?: string;
  explanation?: string;
  bestNextStep?: string;
  bestNextStepCategory?: string;
  confidence?: number;
  sourceUrls: string[];
  lastObservedAt?: string;
  lastObservedAtTimestamp?: number;
  createdAt?: string;
  createdAtTimestamp?: number;
  entityId?: string;
  entitySlug?: string;
  entityName?: string;
  entityDisplayName?: string;
  entityKind?: string;
  entityType?: string;
  entityDepartments: string[];
  entityResearchAreas: string[];
  entitySchool?: string;
  entityWebsiteUrl?: string;
  hasActivePostedOpportunity: boolean;
  postedOpportunityId?: string;
  postedOpportunityTitle?: string;
  postedOpportunityDeadline?: string;
  postedOpportunityDeadlineTimestamp?: number;
  postedOpportunityStatus?: string;
  postedOpportunityTerm?: string;
  publicContactRoute?: PathwaySearchIndexContactRouteDocument;
  publicContactRouteType?: string;
  publicContactPolicy?: string;
  evidence: PathwaySearchIndexEvidenceDocument[];
  evidenceSnippets: string[];
}

export type PathwaySearchIndexInput = Record<string, unknown>;

export interface PathwaySearchIndexAdapter {
  updateSettings: (settings: PathwaySearchIndexSettings) => Promise<unknown>;
  addDocuments: (
    documents: PathwaySearchIndexDocument[],
    options: { primaryKey: string },
  ) => Promise<unknown>;
  deleteAllDocuments?: () => Promise<unknown>;
  deleteDocument?: (id: string) => Promise<unknown>;
}

export interface RebuildPathwaySearchIndexOptions {
  pageSize?: number;
  clearExisting?: boolean;
  getIndex?: (name: string) => Promise<PathwaySearchIndexAdapter>;
}

export interface RebuildPathwaySearchIndexResult {
  indexName: string;
  pageSize: number;
  fetchedHitCount: number;
  indexedDocumentCount: number;
  pageCount: number;
  clearedExisting: boolean;
}

export interface PathwaySearchIndexSearchAdapter extends PathwaySearchIndexAdapter {
  search: (query: string, params: Record<string, unknown>) => Promise<{
    hits?: PathwaySearchIndexDocument[];
    estimatedTotalHits?: number;
  }>;
}

export type FetchPathwaySearchIndexPage = (
  page: number,
  pageSize: number,
) => Promise<{
  hits: PathwaySearchHit[];
  estimatedTotalHits: number;
}>;

export const PATHWAY_SEARCH_INDEX_SETTINGS: PathwaySearchIndexSettings = {
  searchableAttributes: [
    'studentFacingLabel',
    'explanation',
    'bestNextStep',
    'pathwayType',
    'compensation',
    'entityName',
    'entityDisplayName',
    'entityDepartments',
    'entityResearchAreas',
    'entitySchool',
    'postedOpportunityTitle',
    'evidenceSnippets',
    'sourceUrls',
  ],
  filterableAttributes: [
    'pathwayId',
    'pathwayType',
    'status',
    'evidenceStrength',
    'compensation',
    'bestNextStepCategory',
    'entityId',
    'entitySlug',
    'entityType',
    'entityDepartments',
    'entityResearchAreas',
    'hasActivePostedOpportunity',
    'postedOpportunityStatus',
    'publicContactRouteType',
    'publicContactPolicy',
  ],
  sortableAttributes: [
    'confidence',
    'lastObservedAtTimestamp',
    'createdAtTimestamp',
    'postedOpportunityDeadlineTimestamp',
  ],
  displayedAttributes: ['*'],
};

export function getPathwaySearchIndexSettings(): PathwaySearchIndexSettings {
  return {
    searchableAttributes: [...PATHWAY_SEARCH_INDEX_SETTINGS.searchableAttributes],
    filterableAttributes: [...PATHWAY_SEARCH_INDEX_SETTINGS.filterableAttributes],
    sortableAttributes: [...PATHWAY_SEARCH_INDEX_SETTINGS.sortableAttributes],
    displayedAttributes: [...PATHWAY_SEARCH_INDEX_SETTINGS.displayedAttributes],
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringifyId = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (isRecord(value) && typeof value.toString === 'function') {
    const stringified = value.toString();
    return stringified === '[object Object]' ? undefined : stringified;
  }
  return undefined;
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => toStringValue(item))
        .filter((item): item is string => Boolean(item)),
    ),
  );
};

const toNumberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
};

const toDate = (value: unknown): Date | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

const toIsoString = (value: unknown): string | undefined => toDate(value)?.toISOString();

const toTimestamp = (value: unknown): number | undefined => toDate(value)?.getTime();

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;

const redactAndTrim = (value: unknown): string | undefined => {
  const stringValue = toStringValue(value);
  if (!stringValue) return undefined;
  return truncate(redactDirectContactInfo(stringValue), MAX_EVIDENCE_EXCERPT_LENGTH);
};

const toPublicHttpUrl = (value: unknown): string | undefined => {
  const stringValue = toStringValue(value);
  if (!stringValue) return undefined;

  try {
    const url = new URL(stringValue);
    return url.protocol === 'http:' || url.protocol === 'https:' ? stringValue : undefined;
  } catch {
    return undefined;
  }
};

const toPublicHttpArray = (value: unknown): string[] =>
  toStringArray(value)
    .map(toPublicHttpUrl)
    .filter((url): url is string => Boolean(url));

const normalizeEvidence = (
  evidence: unknown,
): {
  evidence: PathwaySearchIndexEvidenceDocument[];
  snippets: string[];
  sourceUrls: string[];
} => {
  if (!Array.isArray(evidence)) {
    return { evidence: [], snippets: [], sourceUrls: [] };
  }

  const items = evidence
    .filter(isRecord)
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((item): PathwaySearchIndexEvidenceDocument => ({
      signalType: toStringValue(item.signalType),
      confidence: toStringValue(item.confidence),
      confidenceScore: toNumberValue(item.confidenceScore),
      excerpt: redactAndTrim(item.excerpt),
      sourceUrl: toPublicHttpUrl(item.sourceUrl),
      observedAt: toIsoString(item.observedAt),
      observedAtTimestamp: toTimestamp(item.observedAt),
    }));

  return {
    evidence: items,
    snippets: items
      .map((item) => item.excerpt)
      .filter((excerpt): excerpt is string => Boolean(excerpt)),
    sourceUrls: items
      .map((item) => item.sourceUrl)
      .filter((sourceUrl): sourceUrl is string => Boolean(sourceUrl)),
  };
};

const normalizePublicContactRoute = (
  contactRoute: unknown,
): PathwaySearchIndexContactRouteDocument | undefined => {
  if (!isRecord(contactRoute)) return undefined;

  const visibility = toStringValue(contactRoute.visibility);
  const contactPolicy = toStringValue(contactRoute.contactPolicy);
  if (visibility !== 'PUBLIC' || contactPolicy === 'NO_DIRECT_CONTACT') return undefined;

  return {
    routeType: toStringValue(contactRoute.routeType),
    label: redactAndTrim(contactRoute.label),
    url: toPublicHttpUrl(contactRoute.url),
    contactPolicy,
    rationale: redactAndTrim(contactRoute.rationale),
  };
};

const uniqueStrings = (...groups: string[][]): string[] =>
  Array.from(new Set(groups.flat().filter(Boolean)));

const quoteFilterValue = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const anyFilter = (field: string, values?: string[]): string | undefined => {
  const clean = toStringArray(values);
  if (clean.length === 0) return undefined;
  return clean.map((value) => `${field} = ${quoteFilterValue(value)}`).join(' OR ');
};

function buildPathwayMeiliFilter(filters: PathwaySearchInput['filters'] = {}): string | undefined {
  const requestedPathwayTypes = toStringArray(filters.pathwayType).filter(
    (pathwayType) => !FORMALIZATION_ONLY_PATHWAY_TYPES.includes(pathwayType),
  );
  const pathwayTypeFilter =
    toStringArray(filters.pathwayType).length > 0
      ? anyFilter('pathwayType', requestedPathwayTypes)
      : FORMALIZATION_ONLY_PATHWAY_TYPES
          .map((pathwayType) => `pathwayType != ${quoteFilterValue(pathwayType)}`)
          .join(' AND ');
  const parts = [
    anyFilter('pathwayId', filters.pathwayIds),
    anyFilter('entityId', filters.entityIds),
    pathwayTypeFilter || 'pathwayId = "__formalization_only_pathway_filter_miss__"',
    anyFilter('compensation', filters.compensation),
    anyFilter('status', filters.status),
    anyFilter('evidenceStrength', filters.evidenceStrength),
    anyFilter('entityType', filters.entityType),
    anyFilter('entityDepartments', filters.departments),
    anyFilter('entityResearchAreas', filters.researchAreas),
    anyFilter('bestNextStepCategory', filters.bestNextStepCategory),
    typeof filters.hasActivePostedOpportunity === 'boolean'
      ? `hasActivePostedOpportunity = ${filters.hasActivePostedOpportunity}`
      : undefined,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.map((part) => `(${part})`).join(' AND ') : undefined;
}

function buildPathwayMeiliSort(input: PathwaySearchInput): string[] | undefined {
  const direction = input.sort?.sortOrder === 'asc' ? 'asc' : 'desc';
  switch (input.sort?.sortBy) {
    case 'confidence':
      return [`confidence:${direction}`, 'lastObservedAtTimestamp:desc'];
    case 'lastObservedAt':
      return [`lastObservedAtTimestamp:${direction}`, 'confidence:desc'];
    case 'deadline':
      return [`postedOpportunityDeadlineTimestamp:${direction}`, 'confidence:desc'];
    case 'createdAt':
      return [`createdAtTimestamp:${direction}`, 'confidence:desc'];
    default:
      return input.q?.trim() ? undefined : ['lastObservedAtTimestamp:desc', 'confidence:desc'];
  }
}

function indexDocumentToHit(doc: PathwaySearchIndexDocument): PathwaySearchHit {
  return {
    _id: doc.pathwayId || doc.id,
    pathwayType: doc.pathwayType || '',
    status: doc.status || '',
    evidenceStrength: doc.evidenceStrength || '',
    studentFacingLabel: doc.studentFacingLabel || '',
    explanation: doc.explanation,
    bestNextStep: doc.bestNextStep,
    bestNextStepCategory: (doc.bestNextStepCategory || 'save-for-later') as any,
    compensation: doc.compensation,
    confidence: doc.confidence,
    sourceUrls: doc.sourceUrls || [],
    lastObservedAt: doc.lastObservedAt ? new Date(doc.lastObservedAt) : undefined,
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    researchEntity: {
      _id: doc.entityId || '',
      slug: doc.entitySlug || '',
      name: doc.entityName || '',
      displayName: doc.entityDisplayName,
      kind: doc.entityKind,
      entityType: doc.entityType,
      departments: doc.entityDepartments || [],
      researchAreas: doc.entityResearchAreas || [],
      school: doc.entitySchool,
      websiteUrl: doc.entityWebsiteUrl,
    },
    activePostedOpportunity: doc.hasActivePostedOpportunity
      ? {
          _id: doc.postedOpportunityId || '',
          title: doc.postedOpportunityTitle || '',
          deadline: doc.postedOpportunityDeadline
            ? new Date(doc.postedOpportunityDeadline)
            : undefined,
          status: (doc.postedOpportunityStatus || 'OPEN') as any,
          term: doc.postedOpportunityTerm,
        }
      : undefined,
    evidence: (doc.evidence || []).map((item) => ({
      signalType: item.signalType || '',
      confidence: item.confidence || '',
      confidenceScore: item.confidenceScore,
      excerpt: item.excerpt,
      sourceUrl: item.sourceUrl,
      observedAt: item.observedAt ? new Date(item.observedAt) : undefined,
    })),
    contactRoute: doc.publicContactRoute
      ? {
          routeType: doc.publicContactRoute.routeType || '',
          label: doc.publicContactRoute.label,
          url: doc.publicContactRoute.url,
          contactPolicy: doc.publicContactRoute.contactPolicy,
          visibility: 'PUBLIC',
          rationale: doc.publicContactRoute.rationale,
        }
      : undefined,
  };
}

export function buildPathwaySearchIndexDocument(
  input: PathwaySearchHit | PathwaySearchIndexInput,
): PathwaySearchIndexDocument {
  const record = input as PathwaySearchIndexInput;
  const researchEntity: Record<string, unknown> = isRecord(record.researchEntity)
    ? record.researchEntity
    : {};
  const activePostedOpportunity = isRecord(record.activePostedOpportunity)
    ? record.activePostedOpportunity
    : undefined;
  const normalizedEvidence = normalizeEvidence(record.evidence);
  const publicContactRoute = normalizePublicContactRoute(record.contactRoute);
  const id = stringifyId(record._id) || stringifyId(record.id) || '';

  return {
    id,
    pathwayId: id,
    pathwayType: toStringValue(record.pathwayType),
    status: toStringValue(record.status),
    evidenceStrength: toStringValue(record.evidenceStrength),
    compensation: toStringValue(record.compensation),
    studentFacingLabel: toStringValue(record.studentFacingLabel),
    explanation: toStringValue(record.explanation),
    bestNextStep: toStringValue(record.bestNextStep),
    bestNextStepCategory: toStringValue(record.bestNextStepCategory),
    confidence: toNumberValue(record.confidence),
    sourceUrls: uniqueStrings(toPublicHttpArray(record.sourceUrls), normalizedEvidence.sourceUrls),
    lastObservedAt: toIsoString(record.lastObservedAt),
    lastObservedAtTimestamp: toTimestamp(record.lastObservedAt),
    createdAt: toIsoString(record.createdAt),
    createdAtTimestamp: toTimestamp(record.createdAt),
    entityId: stringifyId(researchEntity._id) || stringifyId(researchEntity.id),
    entitySlug: toStringValue(researchEntity.slug),
    entityName: toStringValue(researchEntity.name),
    entityDisplayName: toStringValue(researchEntity.displayName),
    entityKind: toStringValue(researchEntity.kind),
    entityType: toStringValue(researchEntity.entityType),
    entityDepartments: toStringArray(researchEntity.departments),
    entityResearchAreas: toStringArray(researchEntity.researchAreas),
    entitySchool: toStringValue(researchEntity.school),
    entityWebsiteUrl:
      toStringValue(researchEntity.websiteUrl) || toStringValue(researchEntity.website),
    hasActivePostedOpportunity: Boolean(activePostedOpportunity),
    postedOpportunityId:
      stringifyId(activePostedOpportunity?._id) || stringifyId(activePostedOpportunity?.id),
    postedOpportunityTitle: toStringValue(activePostedOpportunity?.title),
    postedOpportunityDeadline: toIsoString(activePostedOpportunity?.deadline),
    postedOpportunityDeadlineTimestamp: toTimestamp(activePostedOpportunity?.deadline),
    postedOpportunityStatus: toStringValue(activePostedOpportunity?.status),
    postedOpportunityTerm: toStringValue(activePostedOpportunity?.term),
    publicContactRoute,
    publicContactRouteType: publicContactRoute?.routeType,
    publicContactPolicy: publicContactRoute?.contactPolicy,
    evidence: normalizedEvidence.evidence,
    evidenceSnippets: normalizedEvidence.snippets,
  };
}

export function buildPathwaySearchIndexDocuments(
  inputs: Array<PathwaySearchHit | PathwaySearchIndexInput>,
): PathwaySearchIndexDocument[] {
  return inputs.map(buildPathwaySearchIndexDocument).filter((doc) => Boolean(doc.id));
}

export async function configurePathwaySearchIndex(
  getIndex: (name: string) => Promise<PathwaySearchIndexAdapter> = getMeiliIndex,
): Promise<PathwaySearchIndexAdapter> {
  const index = await getIndex(PATHWAY_SEARCH_INDEX_NAME);
  await index.updateSettings(getPathwaySearchIndexSettings());
  return index;
}

export async function searchPathwaysViaMeili(
  input: PathwaySearchInput,
  getIndex: (name: string) => Promise<PathwaySearchIndexSearchAdapter> = getMeiliIndex as any,
): Promise<PathwaySearchResult> {
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize || 24)));
  const offset = (page - 1) * pageSize;
  const index = await getIndex(PATHWAY_SEARCH_INDEX_NAME);
  const filter = buildPathwayMeiliFilter(input.filters);
  const sort = buildPathwayMeiliSort(input);
  const params: Record<string, unknown> = {
    limit: pageSize,
    offset,
  };
  if (filter) params.filter = filter;
  if (sort && sort.length > 0) params.sort = sort;

  const result = await index.search((input.q || '').trim(), params);
  const hits = (result.hits || []).map(indexDocumentToHit);

  return {
    hits,
    estimatedTotalHits: result.estimatedTotalHits ?? hits.length,
    page,
    pageSize,
  };
}

export async function rebuildPathwaySearchIndex(
  fetchPage: FetchPathwaySearchIndexPage,
  options: RebuildPathwaySearchIndexOptions = {},
): Promise<RebuildPathwaySearchIndexResult> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize || 100)));
  const index = await configurePathwaySearchIndex(options.getIndex || getMeiliIndex);
  const clearExisting = options.clearExisting === true;
  if (clearExisting && index.deleteAllDocuments) {
    await index.deleteAllDocuments();
  }

  let page = 1;
  let fetchedHitCount = 0;
  let indexedDocumentCount = 0;
  let estimatedTotalHits = 0;

  while (page === 1 || fetchedHitCount < estimatedTotalHits) {
    const result = await fetchPage(page, pageSize);
    const hits = result.hits || [];
    estimatedTotalHits = result.estimatedTotalHits || hits.length;
    fetchedHitCount += hits.length;

    const documents = buildPathwaySearchIndexDocuments(hits);
    if (documents.length > 0) {
      await index.addDocuments(documents, { primaryKey: PATHWAY_SEARCH_INDEX_PRIMARY_KEY });
      indexedDocumentCount += documents.length;
    }

    if (hits.length === 0) break;
    page += 1;
  }

  return {
    indexName: PATHWAY_SEARCH_INDEX_NAME,
    pageSize,
    fetchedHitCount,
    indexedDocumentCount,
    pageCount: page - 1,
    clearedExisting: clearExisting,
  };
}

export async function syncPathwaySearchIndexDocument(
  pathwayId: string | undefined,
  getIndex: (name: string) => Promise<PathwaySearchIndexAdapter> = getMeiliIndex,
): Promise<{ indexed: boolean; deleted: boolean }> {
  if (!pathwayId) return { indexed: false, deleted: false };

  const index = await configurePathwaySearchIndex(getIndex);
  const [hit] = await getPathwaysByIds([pathwayId]);
  if (!hit) {
    if (index.deleteDocument) await index.deleteDocument(pathwayId);
    return { indexed: false, deleted: true };
  }

  const [document] = buildPathwaySearchIndexDocuments([hit]);
  if (!document) return { indexed: false, deleted: false };

  await index.addDocuments([document], { primaryKey: PATHWAY_SEARCH_INDEX_PRIMARY_KEY });
  return { indexed: true, deleted: false };
}

export async function syncPathwaySearchIndexDocumentsForEntity(
  researchEntityId: string | undefined,
  getIndex: (name: string) => Promise<PathwaySearchIndexAdapter> = getMeiliIndex,
): Promise<{ indexedDocumentCount: number }> {
  if (!researchEntityId) return { indexedDocumentCount: 0 };

  const pageSize = 100;
  let page = 1;
  let indexedDocumentCount = 0;
  const index = await configurePathwaySearchIndex(getIndex);

  while (true) {
    const result = await searchPathways({
      page,
      pageSize,
      filters: { entityIds: [researchEntityId] },
      sort: { sortBy: 'createdAt', sortOrder: 'desc' },
    });
    const documents = buildPathwaySearchIndexDocuments(result.hits);
    if (documents.length > 0) {
      await index.addDocuments(documents, { primaryKey: PATHWAY_SEARCH_INDEX_PRIMARY_KEY });
      indexedDocumentCount += documents.length;
    }
    if (result.hits.length < pageSize || page * pageSize >= result.estimatedTotalHits) break;
    page += 1;
  }

  return { indexedDocumentCount };
}
