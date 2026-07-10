import { ResearchEntity } from '../models/researchEntity';
import { FacultyMember } from '../models/facultyMember';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { getMeiliIndex } from '../utils/meiliClient';
import { isPublicHttpUrl } from '../utils/urlSafety';

export const RESEARCH_ENTITY_SEARCH_INDEX_NAME = 'researchentities';
export const RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY = 'id';

const RESEARCH_ENTITY_SEARCH_INDEX_SETTINGS = {
  searchableAttributes: [
    'name',
    'displayName',
    'leadProfessorNames',
    'professorNames',
    'researchAreas',
    'keywords',
    'studentSearchTerms',
    'departments',
    'summary',
    'description',
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
  rankingRules: ['words', 'proximity', 'attribute', 'exactness', 'typo', 'sort'],
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
    neuro: ['neuroscience', 'neurology', 'neural', 'brain'],
    psych: ['psychology', 'psychiatry', 'cognitive science', 'behavioral science'],
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

const SEARCH_INDEX_DIRECT_CONTACT_FIELDS = [
  'contactEmail',
  'contactName',
  'contactRole',
  'contactPhone',
  'email',
  'phone',
] as const;

const SEARCH_INDEX_PERSON_NAME_FIELDS = ['leadProfessorNames', 'professorNames'] as const;

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
  cv: ['cv', 'computer vision', 'image analysis', 'visual recognition'],
  'computer vision': ['cv', 'computer vision', 'image analysis', 'visual recognition'],
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

const personNameFromParts = (...parts: unknown[]): string =>
  cleanPersonName(parts.filter(Boolean).join(' '));

const userDisplayName = (user: any): string =>
  cleanPersonName(user?.displayName) ||
  personNameFromParts(user?.fname, user?.lname) ||
  cleanPersonName(user?.name);

const facultyDisplayName = (faculty: any): string =>
  cleanPersonName(faculty?.name) || personNameFromParts(faculty?.firstName, faculty?.lastName);

const memberDisplayName = (
  member: any,
  usersById: Map<string, any>,
  facultyMembersById: Map<string, any>,
): string => {
  const rowName = cleanPersonName(member?.name);
  if (rowName) return rowName;

  const userId = serializedDocumentId(member?.userId);
  const userName = userId ? userDisplayName(usersById.get(userId)) : '';
  if (userName) return userName;

  const facultyMemberId = serializedDocumentId(member?.facultyMemberId);
  return facultyMemberId ? facultyDisplayName(facultyMembersById.get(facultyMemberId)) : '';
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

export function buildStudentSearchTerms(doc: any): string[] {
  const haystack = normalizedAliasHaystack([
    doc?.name,
    doc?.displayName,
    doc?.description,
    doc?.summary,
    doc?.shortDescription,
    doc?.fullDescription,
    doc?.departments,
    doc?.researchAreas,
    doc?.keywords,
    doc?.kind,
    doc?.entityType,
  ]);
  if (!haystack) return [];

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const [trigger, aliases] of Object.entries(STUDENT_TOPIC_ALIASES)) {
    const triggerPattern = new RegExp(`(^|\\s)${trigger.replace(/\s+/g, '\\s+')}(\\s|$)`, 'i');
    if (!triggerPattern.test(haystack)) continue;
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

  const members = await ResearchGroupMember.find({
    archived: { $ne: true },
    isCurrentMember: { $ne: false },
    role: { $in: Array.from(SEARCHABLE_PROFESSOR_MEMBER_ROLES) },
    $or: [{ researchEntityId: { $in: ids } }, { researchGroupId: { $in: ids } }],
  }).lean();

  const memberRows = members as any[];
  const userIds = uniqueObjectIdValues(memberRows.map((member) => member.userId));
  const facultyMemberIds = uniqueObjectIdValues(memberRows.map((member) => member.facultyMemberId));
  const [users, facultyMembers] = await Promise.all([
    userIds.length > 0
      ? User.find({ _id: { $in: userIds } })
          .select('_id fname lname displayName name')
          .lean()
      : Promise.resolve([]),
    facultyMemberIds.length > 0
      ? FacultyMember.find({ _id: { $in: facultyMemberIds } })
          .select('_id name firstName lastName')
          .lean()
      : Promise.resolve([]),
  ]);

  const usersById = new Map(
    (users as any[]).flatMap((user) => {
      const id = serializedDocumentId(user?._id);
      return id ? [[id, user]] : [];
    }),
  );
  const facultyMembersById = new Map(
    (facultyMembers as any[]).flatMap((faculty) => {
      const id = serializedDocumentId(faculty?._id);
      return id ? [[id, faculty]] : [];
    }),
  );
  const byEntityId: ResearchEntitySearchMemberNameMap = new Map();

  for (const member of memberRows) {
    const entityId =
      serializedDocumentId(member.researchEntityId) || serializedDocumentId(member.researchGroupId);
    if (!entityId) continue;

    const name = memberDisplayName(member, usersById, facultyMembersById);
    if (!name) continue;

    const fields = byEntityId.get(entityId) || emptyMemberNameFields();
    fields.professorNames = uniquePersonNames([...fields.professorNames, name]);
    if (LEAD_PROFESSOR_MEMBER_ROLES.has(String(member.role || ''))) {
      fields.leadProfessorNames = uniquePersonNames([...fields.leadProfessorNames, name]);
    }
    byEntityId.set(entityId, fields);
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
  const fetchMemberNames = options.fetchMemberNames || fetchResearchEntitySearchMemberNames;

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
