import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { publicResearchAreaArray } from './researchEntityDto';
import { getMeiliClient, getMeiliIndex } from '../utils/meiliClient';
import { sanitizeResearchEntityPublicDescriptionFields } from '../utils/researchEntityDescriptionText';

export const RESEARCH_ENTITY_SEARCH_INDEX_NAME = 'researchentities';
export const RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY = 'id';

const RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS = {
  searchableAttributes: [
    'searchTitle',
    'name',
    'displayName',
    'semanticText',
    'fullDescription',
    'shortDescription',
    'summary',
    'methodSignals',
    'conceptSignals',
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
  ],
  sortableAttributes: ['lastObservedAt', 'name', 'createdAt', 'updatedAt'],
  displayedAttributes: ['*'],
};

export interface ResearchEntitySearchIndexRebuildOptions {
  pageSize?: number;
  clearExisting?: boolean;
  getIndex?: typeof getMeiliIndex;
  fetchPage?: (page: number, pageSize: number) => Promise<any[]>;
  waitForTask?: (taskUid: number) => Promise<unknown>;
}

export interface ResearchEntitySearchIndexSettingsOptions {
  semanticSearchEnabled?: boolean;
  openAiApiKey?: string;
  embeddingModel?: string;
}

export interface ResearchEntitySearchIndexRebuildResult {
  indexName: string;
  pageSize: number;
  fetchedDocumentCount: number;
  indexedDocumentCount: number;
  pageCount: number;
  clearedExisting: boolean;
}

export interface ResearchEntitySemanticIndexReadiness {
  status: 'ready' | 'blocked';
  message: string;
  documentCount: number;
  embeddedDocumentCount: number;
}

interface ResearchEntitySemanticStatsAdapter {
  getStats: () => Promise<Record<string, any>>;
}

const taskUidFromResponse = (response: unknown): number | undefined => {
  if (!response || typeof response !== 'object') return undefined;
  const record = response as Record<string, unknown>;
  const uid = record.taskUid ?? record.uid;
  return typeof uid === 'number' && Number.isFinite(uid) ? uid : undefined;
};

const defaultWaitForMeiliTask = async (taskUid: number): Promise<unknown> => {
  const client = await getMeiliClient();
  const result = await client.tasks.waitForTask(taskUid, {
    timeout: Number(process.env.MEILI_TASK_TIMEOUT_MS || 15 * 60 * 1000),
    interval: Number(process.env.MEILI_TASK_POLL_INTERVAL_MS || 500),
  });
  if (result?.status === 'failed') {
    throw new Error(result.error?.message || `Meilisearch task ${taskUid} failed`);
  }
  return result;
};

const waitForTaskResponse = async (
  response: unknown,
  waitForTask: (taskUid: number) => Promise<unknown>,
): Promise<void> => {
  const taskUid = taskUidFromResponse(response);
  if (taskUid !== undefined) {
    await waitForTask(taskUid);
  }
};

const numericStat = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const embeddedDocumentCountFromStats = (stats: Record<string, any>): number => {
  const direct =
    stats.numberOfEmbeddedDocuments ??
    stats.numberOfDocumentsWithEmbeddings ??
    stats.embeddedDocuments;
  if (typeof direct === 'number') return direct;

  const embedders = stats.embedders;
  if (embedders && typeof embedders === 'object') {
    return Math.max(
      0,
      ...Object.values(embedders).map((embedder: any) =>
        numericStat(
          embedder?.numberOfEmbeddedDocuments ??
            embedder?.numberOfDocumentsWithEmbeddings ??
            embedder?.embeddedDocuments,
        ),
      ),
    );
  }

  return 0;
};

export async function getResearchEntitySemanticIndexReadiness(
  index: ResearchEntitySemanticStatsAdapter,
): Promise<ResearchEntitySemanticIndexReadiness> {
  const stats = await index.getStats();
  const documentCount = numericStat(stats.numberOfDocuments ?? stats.numberOfDocumentsTotal);
  const embeddedDocumentCount = embeddedDocumentCountFromStats(stats);
  const ready = embeddedDocumentCount > 0;

  return {
    status: ready ? 'ready' : 'blocked',
    documentCount,
    embeddedDocumentCount,
    message: ready
      ? 'ResearchEntity Meilisearch index has embedded documents.'
      : 'ResearchEntity Meilisearch index has no embedded documents; configure the default embedder and rebuild before production promotion.',
  };
}

export function getResearchEntitySearchIndexSettings(
  options: ResearchEntitySearchIndexSettingsOptions = {},
) {
  const settings: Record<string, any> = {
    searchableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.searchableAttributes],
    filterableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.filterableAttributes],
    sortableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.sortableAttributes],
    displayedAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.displayedAttributes],
  };

  if (options.semanticSearchEnabled && options.openAiApiKey) {
    settings.embedders = {
      default: {
        source: 'openAi',
        apiKey: options.openAiApiKey,
        model: options.embeddingModel || 'text-embedding-3-small',
        documentTemplate: '{{doc.semanticText}}',
      },
    };
  }

  return settings;
}

const normalizeSignalText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const uniqueStrings = (values: Array<string | undefined | null>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = (value || '').trim();
    const key = normalizeSignalText(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
};

const collectSemanticSourceText = (doc: any): string =>
  normalizeSignalText(
    [
      doc.name,
      doc.displayName,
      doc.fullDescription,
      doc.shortDescription,
      doc.summary,
      ...(doc.researchAreas || []),
      ...(doc.profileResearchAreas || []),
      ...(doc.keywords || []),
    ].join(' '),
  );

const inferMethodSignals = (doc: any): string[] => {
  const text = collectSemanticSourceText(doc);

  return uniqueStrings([
    text.includes('molecular biology') || text.includes('cell biology')
      ? 'wet lab'
      : undefined,
    text.includes('archive') || text.includes('manuscript') || text.includes('collection')
      ? 'archival research'
      : undefined,
    text.includes('computational text') || text.includes('digital humanities')
      ? 'computational text analysis'
      : undefined,
    text.includes('policy') ? 'policy analysis' : undefined,
    text.includes('epidemiology') || text.includes('population health')
      ? 'population health'
      : undefined,
    text.includes('machine learning') || text.includes('artificial intelligence')
      ? 'computational modeling'
      : undefined,
    text.includes('statistics') || text.includes('survey') || text.includes('quantitative')
      ? 'quantitative analysis'
      : undefined,
  ]);
};

const inferConceptSignals = (doc: any): string[] => {
  const text = collectSemanticSourceText(doc);

  return uniqueStrings([
    text.includes('digital humanities') ? 'digital humanities' : undefined,
    text.includes('archive') || text.includes('collection')
      ? 'archives and collections'
      : undefined,
    text.includes('climate') ? 'climate policy' : undefined,
    text.includes('public health') || text.includes('epidemiology')
      ? 'public health'
      : undefined,
    text.includes('social science') || text.includes('political science')
      ? 'social science data'
      : undefined,
    text.includes('machine learning') || text.includes('artificial intelligence')
      ? 'machine learning'
      : undefined,
    text.includes('molecular biology') || text.includes('cell biology')
      ? 'biomedical research'
      : undefined,
  ]);
};

const buildSemanticText = (
  doc: any,
  methodSignals: string[],
  conceptSignals: string[],
): string =>
  uniqueStrings([
    doc.name,
    doc.displayName,
    doc.fullDescription,
    doc.shortDescription,
    doc.summary,
    ...(doc.departments || []),
    ...(doc.researchAreas || []),
    ...(doc.profileResearchAreas || []),
    ...(doc.keywords || []),
    ...(doc.sourceUrls || []),
    ...methodSignals,
    ...conceptSignals,
  ]).join('. ');

const normalizeProfileFallbackKey = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

export function applyProfileResearchAreasForIndexDocument(
  doc: Record<string, any>,
  profileResearchAreas: unknown,
): Record<string, any> {
  const entityAreas = publicResearchAreaArray(doc.researchAreas);
  const profileAreas = publicResearchAreaArray(profileResearchAreas);
  if (profileAreas.length === 0) {
    return { ...doc, researchAreas: entityAreas };
  }

  const profileKeys = new Set(profileAreas.map(normalizeProfileFallbackKey));
  const entityAreasAreOnlyProfileTerms =
    entityAreas.length === 0 ||
    entityAreas.every((area) => profileKeys.has(normalizeProfileFallbackKey(area)));

  if (!entityAreasAreOnlyProfileTerms) {
    return { ...doc, researchAreas: entityAreas };
  }

  return {
    ...doc,
    researchAreas: [],
    profileResearchAreas: profileAreas,
    researchAreaSource: 'PI_PROFILE_FALLBACK',
  };
}

export function buildResearchEntitySearchIndexDocument(doc: any): Record<string, any> | null {
  if (!doc) return null;
  if (doc.archived === true) return null;
  const rawId = doc._id ?? doc.id;
  if (rawId == null) return null;
  const normalizedDoc = sanitizeResearchEntityPublicDescriptionFields({
    ...doc,
    researchAreas: publicResearchAreaArray(doc.researchAreas),
  });

  const out: Record<string, any> = {
    ...normalizedDoc,
    id: String(rawId),
  };
  const methodSignals = inferMethodSignals(normalizedDoc);
  const conceptSignals = inferConceptSignals(normalizedDoc);
  out.searchTitle = String(normalizedDoc.displayName || normalizedDoc.name || '').trim();
  out.methodSignals = methodSignals;
  out.conceptSignals = conceptSignals;
  out.descriptionQuality =
    normalizedDoc.fullDescription ||
    normalizedDoc.shortDescription ||
    normalizedDoc.summary
      ? 'described'
      : 'sparse';
  out.semanticText = buildSemanticText(normalizedDoc, methodSignals, conceptSignals);
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
  const docs = await ResearchEntity.find({})
    .sort({ _id: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();
  if (docs.length === 0) return docs;

  const entityIds = docs.map((doc: any) => doc._id).filter(Boolean);
  const members = await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    role: 'pi',
    isCurrentMember: { $ne: false },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId')
    .lean();
  if (members.length === 0) return docs;

  const userIds = [...new Set(members.map((member: any) => String(member.userId)))];
  const users = await User.find({ _id: { $in: userIds } })
    .select('researchInterests topics')
    .lean();
  const usersById = new Map(users.map((user: any) => [String(user._id), user]));
  const membersByEntityId = new Map<string, any[]>();
  for (const member of members as any[]) {
    const key = String(member.researchEntityId);
    membersByEntityId.set(key, [...(membersByEntityId.get(key) || []), member]);
  }

  return docs.map((doc: any) => {
    const profileAreas = (membersByEntityId.get(String(doc._id)) || []).flatMap((member: any) => {
      const user = usersById.get(String(member.userId));
      return [
        ...(Array.isArray(user?.topics) ? user.topics : []),
        ...(Array.isArray(user?.researchInterests) ? user.researchInterests : []),
      ];
    });
    return applyProfileResearchAreasForIndexDocument(doc, profileAreas);
  });
}

export async function rebuildResearchEntitySearchIndex(
  options: ResearchEntitySearchIndexRebuildOptions = {},
): Promise<ResearchEntitySearchIndexRebuildResult> {
  const pageSize = Math.max(1, Math.floor(options.pageSize || 250));
  const clearExisting = options.clearExisting ?? false;
  const index = await (options.getIndex || getMeiliIndex)(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
  const fetchPage = options.fetchPage || fetchResearchEntityPage;
  const waitForTask = options.waitForTask || defaultWaitForMeiliTask;

  if (clearExisting) {
    await waitForTaskResponse(await index.deleteAllDocuments(), waitForTask);
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
      await waitForTaskResponse(
        await index.addDocuments(indexDocs, {
          primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
        }),
        waitForTask,
      );
    }

    if (docs.length < pageSize) break;
    page += 1;
  }

  await waitForTaskResponse(
    await index.updateSettings(
      getResearchEntitySearchIndexSettings({
        semanticSearchEnabled: process.env.RESEARCH_SEARCH_SEMANTIC === 'true',
        openAiApiKey: process.env.OPENAI_API_KEY,
        embeddingModel: process.env.RESEARCH_SEARCH_EMBEDDING_MODEL,
      }),
    ),
    waitForTask,
  );

  return {
    indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
    pageSize,
    fetchedDocumentCount,
    indexedDocumentCount,
    pageCount,
    clearedExisting: clearExisting,
  };
}
