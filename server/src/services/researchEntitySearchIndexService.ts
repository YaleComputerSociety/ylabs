import { ResearchEntity } from '../models/researchEntity';
import { getResearchEntityRosterByEntityId } from './researchEntityMembershipAccessor';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  isStudiesResearchAreaEchoDescription,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { getMeiliIndex } from '../utils/meiliClient';
import { normalizeResearchAreaList } from '../utils/researchAreaHygiene';
import { isPublicHttpUrl } from '../utils/urlSafety';

export const RESEARCH_ENTITY_SEARCH_INDEX_NAME = 'researchentities';
export const RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY = 'id';

export const RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS = 100000;

export const RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET = 10000;

const RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS = {
  searchableAttributes: [
    'name',
    'displayName',
    'leadProfessorNames',
    'professorNames',
    'researchAreas',
    'studentSearchTerms',
    'departments',
    'shortDescription',
    'fullDescription',
    'school',
    'kind',
    'entityType',
    'websiteUrl',
    'sourceUrls',
  ],
  filterableAttributes: [
    'archived',
    'kind',
    'entityType',
    'school',
    'schools',
    'departments',
    'researchAreas',
    'accessAcceptanceLevel',
    'hasUndergradHostingEvidence',
    'undergraduateCurrentAvailability',
    'studentVisibilityTier',
  ],
  sortableAttributes: ['browseRankScore', 'lastObservedAt', 'name', 'createdAt', 'updatedAt'],
  displayedAttributes: ['*'],
  // `exactness` and `typo` precede `attribute` (Meili's default puts `attribute`
  // first) so an exact, typo-free topical match in a lower-priority field beats a
  // fuzzy/prefix collision that only wins on high-priority-field placement -
  // e.g. "poetry" must not rank the surname "Petrylak" above real poetry scholars.
  rankingRules: ['words', 'proximity', 'exactness', 'typo', 'attribute', 'sort'],
  typoTolerance: {
    minWordSizeForTypos: {
      oneTypo: 5,
      twoTypos: 9,
    },
    disableOnWords: ['ai', 'ml', 'nlp', 'cv'],
  },
  synonyms: {
    ai: ['artificial intelligence', 'machine learning', 'deep learning'],
    ml: ['machine learning', 'artificial intelligence', 'deep learning'],
    nlp: ['natural language processing', 'computational linguistics'],
    cv: ['computer vision', 'medical imaging', 'image analysis'],
    'computer vision': ['computational vision', 'cv'],
    'computational vision': ['computer vision', 'cv'],
    neuro: ['neuroscience', 'neurology', 'neural', 'brain'],
    psych: ['psychology', 'psychiatry', 'cognitive science', 'behavioral science'],
  },
  pagination: {
    maxTotalHits: RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
  },
  faceting: {
    maxValuesPerFacet: RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET,
  },
};

export interface ResearchEntitySearchIndexRebuildOptions {
  pageSize?: number;
  clearExisting?: boolean;
  getIndex?: typeof getMeiliIndex;
  fetchPage?: (page: number, pageSize: number) => Promise<any[]>;
  fetchMemberNames?: (entityIds: unknown[]) => Promise<ResearchEntitySearchMemberNameMap>;
}

export interface ResearchEntitySearchIndexRebuildResult {
  indexName: string;
  pageSize: number;
  fetchedDocumentCount: number;
  indexedDocumentCount: number;
  pageCount: number;
  clearedExisting: boolean;
}

export interface ResearchEntitySearchMemberNameFields {
  leadProfessorNames: string[];
  professorNames: string[];
}

export type ResearchEntitySearchMemberNameMap = Map<string, ResearchEntitySearchMemberNameFields>;

export function getResearchEntitySearchIndexSettings() {
  return {
    searchableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.searchableAttributes],
    filterableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.filterableAttributes],
    sortableAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.sortableAttributes],
    displayedAttributes: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.displayedAttributes],
    rankingRules: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.rankingRules],
    typoTolerance: {
      minWordSizeForTypos: {
        ...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.typoTolerance.minWordSizeForTypos,
      },
      disableOnWords: [...RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.typoTolerance.disableOnWords],
    },
    synonyms: Object.fromEntries(
      Object.entries(RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.synonyms).map(([key, values]) => [
        key,
        [...values],
      ]),
    ),
    pagination: {
      maxTotalHits: RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.pagination.maxTotalHits,
    },
    faceting: {
      maxValuesPerFacet: RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS.faceting.maxValuesPerFacet,
    },
  };
}

const SEARCH_INDEX_TEXT_FIELDS = [
  'name',
  'displayName',
  'summary',
  'shortDescription',
  'fullDescription',
  'undergradEvidenceQuote',
  'undergradAccessEvidence',
] as const;

const SEARCH_INDEX_DIRECT_CONTACT_FIELDS = [
  'contactEmail',
  'contactName',
  'contactRole',
  'contactPhone',
  'email',
  'phone',
] as const;

const SEARCH_INDEX_PERSON_NAME_FIELDS = ['leadProfessorNames', 'professorNames'] as const;

const RETIRED_ACCESS_INDEX_FIELDS = [
  'openness',
  'acceptingUndergrads',
  'acceptanceConfidence',
  'opennessSignals',
  'opennessStatusCache',
  'opennessExplanationCache',
  'opennessComputedAt',
  'opennessLastSignalAt',
] as const;

const STUDENT_TOPIC_ALIASES: Record<string, string[]> = {
  ai: ['ai', 'artificial intelligence', 'machine learning', 'deep learning'],
  'artificial intelligence': ['ai', 'artificial intelligence', 'machine learning', 'deep learning'],
  ml: ['ml', 'machine learning', 'artificial intelligence', 'deep learning'],
  'machine learning': ['ml', 'machine learning', 'artificial intelligence', 'deep learning'],
  nlp: ['nlp', 'natural language processing', 'computational linguistics'],
  'natural language processing': [
    'nlp',
    'natural language processing',
    'computational linguistics',
  ],
  cv: ['cv', 'computer vision', 'computational vision', 'image analysis', 'visual recognition'],
  'computer vision': [
    'cv',
    'computer vision',
    'computational vision',
    'image analysis',
    'visual recognition',
  ],
  'computational vision': [
    'cv',
    'computer vision',
    'computational vision',
    'image analysis',
    'visual recognition',
  ],
  neuro: ['neuro', 'neuroscience', 'neurology', 'neural', 'brain'],
  neuroscience: ['neuro', 'neuroscience', 'neurology', 'neural', 'brain'],
  psych: ['psych', 'psychology', 'psychiatry', 'cognitive science', 'behavioral science'],
  psychology: ['psych', 'psychology', 'psychiatry', 'cognitive science', 'behavioral science'],
};

const LEAD_PROFESSOR_MEMBER_ROLES = new Set([
  'pi',
  'co-pi',
  'director',
  'co-director',
  'principal_investigator',
  'lead',
  'faculty_lead',
]);

const SEARCHABLE_PROFESSOR_MEMBER_ROLES = new Set([
  ...LEAD_PROFESSOR_MEMBER_ROLES,
  'core-faculty',
  'affiliated',
  'affiliate',
  'faculty',
]);
const MONGO_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const researchEntitySearchDocumentId = (doc: any): string =>
  serializedDocumentId(doc?._id) || serializedDocumentId(doc?.id) || '';

const uniqueObjectIdValues = (values: unknown[]): unknown[] => {
  const seen = new Set<string>();
  const out: unknown[] = [];

  for (const value of values) {
    const id = serializedDocumentId(value);
    if (!id || !MONGO_OBJECT_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }

  return out;
};

const cleanPersonName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const cleaned = redactDirectContactInfo(value)
    .replace(/\[(?:email|phone) redacted\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned;
};

const uniquePersonNames = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const cleaned = cleanPersonName(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }

  return out;
};

const normalizedAliasHaystack = (values: unknown[]): string =>
  values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      return value == null ? [] : [value];
    })
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const addUniqueSearchTerm = (terms: string[], seen: Set<string>, term: string) => {
  const cleaned = term.trim().replace(/\s+/g, ' ');
  const key = cleaned.toLowerCase();
  if (!cleaned || seen.has(key)) return;
  seen.add(key);
  terms.push(cleaned);
};

const CV_ADMIN_CONTEXT_PATTERNS: RegExp[] = [
  /\b(?:email|send|submit|attach|include|provide|share|mail)\s+(?:a|an|your|the)?\s*cv\b/gi,
  /\bcv\s+(?:to|and\s+(?:a\s+)?cover\s+letter|and\s+resume|or\s+resume)\b/gi,
  /\b(?:r[ée]sum[ée]|cover\s+letter)\b[^.]{0,40}\bcv\b/gi,
  /\bcv\b[^.]{0,40}\b(?:r[ée]sum[ée]|cover\s+letter)\b/gi,
];

const CV_CITATION_INITIALS_PATTERN = /\b[A-Z][a-zA-Z'-]{1,30}\s+CV[,.]/g;

const stripCvFalsePositiveContext = (text: string): string => {
  let cleaned = /\bcurriculum\b/i.test(text) ? text.replace(/\bcv\b/gi, ' ') : text;
  cleaned = cleaned.replace(CV_CITATION_INITIALS_PATTERN, ' ');
  for (const pattern of CV_ADMIN_CONTEXT_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned;
};

// An endowed-chair or rank title ("Sterling Professor of Political Science",
// "William K. Townsend Professor of Law", "Assistant Professor of Chemistry")
// is boilerplate that a literal search term can collide with (e.g. "townsend",
// "sterling") even though the entity has no real connection to that term - the
// department/field named after "of" is already indexed separately, so the
// whole phrase carries no unique search signal. See #1286.
const ENDOWED_CHAIR_TITLE_PATTERN =
  /\b(?:the\s+)?(?:[A-Z][A-Za-z.'-]+\s+){1,4}Professor(?:\s+Emerit(?:us|a))?\s+of\s+[A-Z][A-Za-z]+(?:\s+(?:and|of|the)\s+[A-Z][A-Za-z]+|\s+[A-Z][A-Za-z]+){0,3}/g;

const stripEndowedChairTitles = (text: string): string =>
  text.replace(ENDOWED_CHAIR_TITLE_PATTERN, ' ').replace(/[ \t]+/g, ' ').trim();

export function buildStudentSearchTerms(doc: any): string[] {
  const textFields = [
    doc?.name,
    doc?.displayName,
    doc?.summary,
    doc?.shortDescription,
    doc?.fullDescription,
    doc?.departments,
    doc?.researchAreas,
    doc?.keywords,
    doc?.kind,
    doc?.entityType,
  ];

  const haystack = normalizedAliasHaystack(textFields);
  if (!haystack) return [];

  const cvGuardedHaystack = normalizedAliasHaystack(
    textFields.map((value) => (typeof value === 'string' ? stripCvFalsePositiveContext(value) : value)),
  );

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const [trigger, aliases] of Object.entries(STUDENT_TOPIC_ALIASES)) {
    const triggerPattern = new RegExp(`(^|\\s)${trigger.replace(/\s+/g, '\\s+')}(\\s|$)`, 'i');
    const haystackForTrigger = trigger === 'cv' ? cvGuardedHaystack : haystack;
    if (!triggerPattern.test(haystackForTrigger)) continue;
    for (const alias of aliases) {
      addUniqueSearchTerm(terms, seen, alias);
    }
  }

  return terms;
}

const emptyMemberNameFields = (): ResearchEntitySearchMemberNameFields => ({
  leadProfessorNames: [],
  professorNames: [],
});

export async function fetchResearchEntitySearchMemberNames(
  entityIds: unknown[],
): Promise<ResearchEntitySearchMemberNameMap> {
  const ids = uniqueObjectIdValues(entityIds);
  if (ids.length === 0) return new Map();

  const rosterByEntityId = await getResearchEntityRosterByEntityId(ids);
  const byEntityId: ResearchEntitySearchMemberNameMap = new Map();

  for (const [entityId, roster] of rosterByEntityId) {
    for (const member of roster) {
      if (!member.isCurrentMember) continue;
      if (!SEARCHABLE_PROFESSOR_MEMBER_ROLES.has(member.role)) continue;

      const name = cleanPersonName(member.name);
      if (!name) continue;

      const fields = byEntityId.get(entityId) || emptyMemberNameFields();
      fields.professorNames = uniquePersonNames([...fields.professorNames, name]);
      if (LEAD_PROFESSOR_MEMBER_ROLES.has(member.role)) {
        fields.leadProfessorNames = uniquePersonNames([...fields.leadProfessorNames, name]);
      }
      byEntityId.set(entityId, fields);
    }
  }

  return byEntityId;
}

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
  Array.isArray(value) ? value.flatMap((item) => publicHttpUrl(item) ?? []) : [];

const sanitizeResearchEntityIndexDocument = (out: Record<string, any>) => {
  for (const field of SEARCH_INDEX_DIRECT_CONTACT_FIELDS) {
    delete out[field];
  }

  for (const field of SEARCH_INDEX_TEXT_FIELDS) {
    if (typeof out[field] === 'string') {
      out[field] = redactDirectContactInfo(out[field]);
    }
  }

  if (typeof out.fullDescription === 'string') {
    let cleaned = sanitizeResearchEntityDescription(out.fullDescription);
    if (isStudiesResearchAreaEchoDescription(cleaned, out.researchAreas)) cleaned = '';
    out.fullDescription = stripEndowedChairTitles(cleaned);
  }
  if (typeof out.shortDescription === 'string') {
    let cleaned = sanitizeResearchEntityShortDescription(out.shortDescription);
    if (isStudiesResearchAreaEchoDescription(cleaned, out.researchAreas)) cleaned = '';
    out.shortDescription = stripEndowedChairTitles(cleaned);
  }

  for (const field of SEARCH_INDEX_PERSON_NAME_FIELDS) {
    const names = uniquePersonNames(out[field]);
    if (names.length > 0) out[field] = names;
    else delete out[field];
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

  if (Array.isArray(out.researchAreas)) {
    const researchAreas = normalizeResearchAreaList(out.researchAreas);
    if (researchAreas.length > 0) out.researchAreas = researchAreas;
    else delete out.researchAreas;
  }
};

export function buildResearchEntitySearchIndexDocument(
  doc: any,
  memberNames?: ResearchEntitySearchMemberNameFields,
): Record<string, any> | null {
  if (!doc) return null;
  const rawId = doc._id ?? doc.id;
  if (rawId == null) return null;
  const id = serializedDocumentId(rawId);
  if (!id) return null;

  const out: Record<string, any> = {
    ...doc,
    id,
  };
  if (memberNames) {
    out.leadProfessorNames = memberNames.leadProfessorNames;
    out.professorNames = memberNames.professorNames;
  }
  const studentSearchTerms = buildStudentSearchTerms(out);
  if (studentSearchTerms.length > 0) {
    out.studentSearchTerms = studentSearchTerms;
  }
  delete out._id;
  delete out.__v;
  delete out.embedding;
  for (const field of RETIRED_ACCESS_INDEX_FIELDS) {
    delete out[field];
  }
  sanitizeResearchEntityIndexDocument(out);
  return out;
}

export function buildResearchEntitySearchIndexDocuments(
  docs: any[],
  memberNamesByEntityId: ResearchEntitySearchMemberNameMap = new Map(),
): Record<string, any>[] {
  return docs
    .map((doc) =>
      buildResearchEntitySearchIndexDocument(
        doc,
        memberNamesByEntityId.get(researchEntitySearchDocumentId(doc)),
      ),
    )
    .filter((doc): doc is Record<string, any> => doc !== null);
}

export async function buildResearchEntitySearchIndexDocumentsWithMemberNames(
  docs: any[],
  fetchMemberNames: (
    entityIds: unknown[],
  ) => Promise<ResearchEntitySearchMemberNameMap> = fetchResearchEntitySearchMemberNames,
): Promise<Record<string, any>[]> {
  const memberNamesByEntityId = await fetchMemberNames(docs.map((doc) => doc?._id ?? doc?.id));
  return buildResearchEntitySearchIndexDocuments(docs, memberNamesByEntityId);
}

async function fetchResearchEntityPage(page: number, pageSize: number): Promise<any[]> {
  return ResearchEntity.find({ archived: { $ne: true } })
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

export const RESEARCH_ENTITY_SEARCH_EMBEDDER_NAME = 'default';
export const RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL = 'text-embedding-3-small';

export const buildResearchEntitySearchEmbedderConfig = (apiKey: string) => ({
  [RESEARCH_ENTITY_SEARCH_EMBEDDER_NAME]: {
    source: 'openAi',
    apiKey,
    model: RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL,
    documentTemplate:
      'Name: {{doc.name}}\n' +
      '{% if doc.professorNames %}Professors: {{doc.professorNames}}\n{% endif %}' +
      '{% if doc.departments %}Departments: {{doc.departments}}\n{% endif %}' +
      '{% if doc.researchAreas %}Research areas: {{doc.researchAreas}}\n{% endif %}' +
      '{% if doc.shortDescription %}Description: {{doc.shortDescription}} {% endif %}' +
      '{% if doc.fullDescription %}{{doc.fullDescription}}{% endif %}',
  },
});

const RESEARCH_ENTITY_SEARCH_EMBEDDER_CHECK_CACHE_TTL_MS = 5 * 60 * 1000;

let embedderConfiguredCache: boolean | null = null;
let embedderConfiguredCacheAt = 0;

export const invalidateResearchEntitySearchEmbedderCache = (): void => {
  embedderConfiguredCache = null;
  embedderConfiguredCacheAt = 0;
};

interface ResearchEntitySearchIndexLike {
  getEmbedders?: () => Promise<Record<string, unknown> | null | undefined>;
}

export async function isResearchEntitySearchEmbedderConfigured(
  index: ResearchEntitySearchIndexLike,
): Promise<boolean> {
  const now = Date.now();
  if (
    embedderConfiguredCache !== null &&
    now - embedderConfiguredCacheAt < RESEARCH_ENTITY_SEARCH_EMBEDDER_CHECK_CACHE_TTL_MS
  ) {
    return embedderConfiguredCache;
  }

  let configured = false;
  try {
    const embedders = typeof index.getEmbedders === 'function' ? await index.getEmbedders() : null;
    configured = Boolean(
      embedders &&
      typeof embedders === 'object' &&
      RESEARCH_ENTITY_SEARCH_EMBEDDER_NAME in embedders,
    );
  } catch {
    configured = false;
  }

  embedderConfiguredCache = configured;
  embedderConfiguredCacheAt = now;
  return configured;
}

const MEILI_SETTINGS_TASK_WAIT_TIMEOUT_MS = 180_000;

interface MeiliTaskWaiter {
  waitForTask: (
    taskUid: number,
    options?: { timeout?: number },
  ) => Promise<{
    status: string;
    error?: unknown;
  }>;
}

interface MeiliTaskAwareIndex {
  tasks?: MeiliTaskWaiter;
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

export async function rebuildResearchEntitySearchIndex(
  options: ResearchEntitySearchIndexRebuildOptions = {},
): Promise<ResearchEntitySearchIndexRebuildResult> {
  const pageSize = normalizeRebuildPageSize(options.pageSize);
  const clearExisting = options.clearExisting ?? false;
  const index = await (options.getIndex || getMeiliIndex)(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
  const fetchPage = options.fetchPage || fetchResearchEntityPage;
  const fetchMemberNames = options.fetchMemberNames || fetchResearchEntitySearchMemberNames;

  const settingsTask = await index.updateSettings(getResearchEntitySearchIndexSettings());
  await assertMeiliSettingsTaskSucceeded(index, settingsTask, 'updateSettings');
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (openAiApiKey && typeof (index as any).updateEmbedders === 'function') {
    const embedderTask = await (index as any).updateEmbedders(
      buildResearchEntitySearchEmbedderConfig(openAiApiKey),
    );
    await assertMeiliSettingsTaskSucceeded(index, embedderTask, 'updateEmbedders');
    invalidateResearchEntitySearchEmbedderCache();
  }
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
    const indexDocs = await buildResearchEntitySearchIndexDocumentsWithMemberNames(
      docs,
      fetchMemberNames,
    );
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
