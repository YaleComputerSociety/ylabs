import type { LabDetailPayload } from './labDetail';
import type { PathwaySearchHit } from './pathway';
import type {
  ResearchEntity as ResearchEntityBacking,
  ResearchGroupSearchResponse,
} from './researchGroup';

export interface ResearchEntitySearchMatch {
  mode: 'semantic' | 'hybrid' | 'expanded-keyword' | 'keyword';
  concepts: string[];
  methods: string[];
  reason: string;
}

export interface ResearchEntity extends ResearchEntityBacking {
  searchMatch?: ResearchEntitySearchMatch;
  waysIn?: PathwaySearchHit[];
}

export interface ResearchEntitySearchResponse
  extends Omit<ResearchGroupSearchResponse, 'hits' | 'researchEntities'> {
  researchEntities?: ResearchEntity[];
  hits?: ResearchEntity[];
}

export interface NormalizedResearchEntitySearchResponse
  extends Omit<ResearchGroupSearchResponse, 'hits' | 'researchEntities'> {
  researchEntities: ResearchEntity[];
  hits: ResearchEntity[];
}

export interface ResearchEntityDetailPayload
  extends Omit<LabDetailPayload, 'group' | 'researchEntity'> {
  researchEntity: ResearchEntity;
  group?: ResearchEntity;
}

type MaybeResearchEntityDetailPayload =
  Partial<Omit<LabDetailPayload, 'group' | 'researchEntity'>> & {
    researchEntity?: ResearchEntity | null;
    group?: ResearchEntity | null;
  };

const normalizeStringArray = (values: unknown): string[] =>
  Array.isArray(values)
    ? values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    : [];

const SOURCE_CHROME_PATTERNS = [
  /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i,
  /\bORCID\s*/i,
  /Publications\s*Timeline/i,
  /\bYSM Researchers?\b/i,
  /ResearchersView/i,
  /View\s+(?:Lab Website|Full Profile|Related Publications?|Related Publication)/i,
  /View\s+\d+\s+(?:Common|Related)\s+Publications?/i,
  /\b(?:Common|Related)\s+Publications?\b/i,
  /Yale Co-Authors/i,
  /Streamline Icon/i,
  /\bCitations\b/i,
];

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const isSourceChromeText = (value: unknown): boolean => {
  const text = normalizeText(value);
  return !!text && SOURCE_CHROME_PATTERNS.some((pattern) => pattern.test(text));
};

const isDescriptionPlaceholder = (value: unknown): boolean =>
  /^research areas?\s*(?::|include\b)/i.test(normalizeText(value));

const isAcademicAppointmentText = (value: unknown): boolean => {
  const text = normalizeText(value);
  if (!text) return false;
  if (
    /\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs)\b/i.test(
      text,
    )
  ) {
    return false;
  }

  return [
    /^Department Chair\b.*\bProfessor of\b/i,
    /\bProfessor of\b.*;\s*Affiliated Faculty\b/i,
    /\bProfessor of\b.*\bDirector,\s+Yale\b/i,
  ].some((pattern) => pattern.test(text));
};

const isRoleOnlyTitleFragment = (value: unknown): boolean => {
  const text = normalizeText(value);
  if (!text || text.length > 120) return false;
  const titlePatterns = [
    /^(?:track\s+)?director\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:co-)?director\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:principal\s+investigator|faculty|lecturer|instructor)\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /\b(?:course|program|track|site|center|centre|department)\s+director\b/i,
  ];
  if (titlePatterns.some((pattern) => pattern.test(text))) return true;

  if (
    /\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs|researches)\b/i.test(
      text,
    )
  ) {
    return false;
  }

  return false;
};

const publicDescriptionText = (value: unknown): string => {
  const text = normalizeText(value);
  if (
    !text ||
    isDescriptionPlaceholder(text) ||
    isAcademicAppointmentText(text) ||
    isRoleOnlyTitleFragment(text) ||
    isSourceChromeText(text)
  ) {
    return '';
  }
  return text;
};

const publicResearchAreas = (values: unknown): string[] => {
  const seen = new Set<string>();
  const areas: string[] = [];
  for (const value of normalizeStringArray(values)) {
    const key = value.toLowerCase();
    if (
      !key ||
      seen.has(key) ||
      value.length > 90 ||
      /https?:\/\//i.test(value) ||
      isSourceChromeText(value)
    ) {
      continue;
    }
    seen.add(key);
    areas.push(value);
  }
  return areas;
};

const normalizeSearchMatch = (
  value: ResearchEntitySearchMatch | undefined,
): ResearchEntitySearchMatch | undefined => {
  if (!value || typeof value.reason !== 'string') return undefined;

  return {
    mode: value.mode,
    concepts: normalizeStringArray(value.concepts),
    methods: normalizeStringArray(value.methods),
    reason: value.reason.trim(),
  };
};

const normalizeResearchEntity = (entity: ResearchEntity): ResearchEntity => ({
  ...entity,
  shortDescription: publicDescriptionText(entity.shortDescription),
  description: publicDescriptionText(entity.description),
  fullDescription: publicDescriptionText(entity.fullDescription),
  researchAreas: publicResearchAreas(entity.researchAreas),
  searchMatch: normalizeSearchMatch(entity.searchMatch),
});

export function normalizeResearchEntitySearchResponse(
  response: ResearchEntitySearchResponse,
): NormalizedResearchEntitySearchResponse {
  const researchEntities = (
    Array.isArray(response.researchEntities)
      ? response.researchEntities
      : Array.isArray(response.hits)
        ? response.hits
        : []
  ).map(normalizeResearchEntity);

  return {
    ...response,
    hits: researchEntities,
    researchEntities,
    estimatedTotalHits: response.estimatedTotalHits ?? researchEntities.length,
    page: response.page ?? 1,
    pageSize: response.pageSize ?? researchEntities.length,
  };
}

export function normalizeResearchEntityDetailPayload(
  payload: MaybeResearchEntityDetailPayload,
): ResearchEntityDetailPayload {
  const researchEntity = payload.researchEntity || payload.group;
  if (!researchEntity) {
    throw new Error('Research detail payload is missing researchEntity');
  }
  const normalizedResearchEntity = normalizeResearchEntity(researchEntity);
  const normalizedGroup = payload.group
    ? normalizeResearchEntity(payload.group)
    : normalizedResearchEntity;

  return {
    ...payload,
    researchEntity: normalizedResearchEntity,
    group: normalizedGroup,
    members: payload.members ?? [],
    researchActivityLinks: payload.researchActivityLinks ?? [],
    scholarlyLinks: payload.scholarlyLinks ?? [],
    memberScholarlyLinks: payload.memberScholarlyLinks ?? [],
    recentPapers: payload.recentPapers ?? [],
    recentArxivPreprints: payload.recentArxivPreprints ?? [],
    activeListings: payload.activeListings ?? [],
    entryPathways: payload.entryPathways ?? [],
    accessSignals: payload.accessSignals ?? [],
    contactRoutes: payload.contactRoutes ?? [],
    postedOpportunities: payload.postedOpportunities ?? [],
    entityRelationships: payload.entityRelationships ?? [],
    relatedResearchEntities: payload.relatedResearchEntities ?? [],
    affiliatedRelationships: payload.affiliatedRelationships ?? [],
    affiliatedResearchEntities: payload.affiliatedResearchEntities ?? [],
  };
}
