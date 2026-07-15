import type { LabDetailPayload } from './labDetail';
import type { PathwaySearchHit } from './pathway';
import type {
  ResearchEntity as ResearchEntityBacking,
  ResearchGroupSearchResponse,
} from './researchGroup';
import {
  normalizeResearchMetadataLabels,
  normalizeResearchStringArray,
  publicResearchDescriptionText,
} from '../utils/researchTextNormalization';

export interface ResearchEntitySearchMatch {
  mode: 'semantic' | 'hybrid' | 'expanded-keyword' | 'keyword';
  concepts: string[];
  methods: string[];
  reason: string;
}

export type ResearchEntityDescriptionState =
  | 'source_backed'
  | 'profile_synthesis'
  | 'thin'
  | 'missing';

export type ResearchEntityLeadState = 'lead_attached' | 'lead_weak' | 'lead_missing';

export type ResearchEntityRepairFlag =
  | 'missing_description'
  | 'thin_description'
  | 'profile_fallback_only'
  | 'missing_lead'
  | 'pi_identity_conflict'
  | 'duplicate_risk'
  | 'missing_source_url';

export interface ResearchEntityQualitySummary {
  descriptionState: ResearchEntityDescriptionState;
  leadState: ResearchEntityLeadState;
  repairFlags: ResearchEntityRepairFlag[];
  score: number;
}

export type StudentVisibilityTier =
  | 'student_ready'
  | 'limited_but_safe'
  | 'operator_review'
  | 'suppressed';

export interface ResearchEntity extends ResearchEntityBacking {
  searchMatch?: ResearchEntitySearchMatch;
  waysIn?: PathwaySearchHit[];
  qualitySummary?: ResearchEntityQualitySummary;
  studentVisibilityTier?: StudentVisibilityTier;
  studentVisibilityComputedTier?: StudentVisibilityTier;
  studentVisibilityOverrideTier?: StudentVisibilityTier;
  studentVisibilityReasons?: string[];
  studentVisibilitySuppressionReason?: string;
  studentVisibilityReviewRuleId?: string;
  studentVisibilityReviewNote?: string;
}

export interface ResearchEntitySearchResponse extends Partial<
  Omit<ResearchGroupSearchResponse, 'hits' | 'researchEntities'>
> {
  researchEntities?: ResearchEntity[];
  hits?: ResearchEntity[];
  facetDistribution?: Record<string, Record<string, number>>;
}

export interface NormalizedResearchEntitySearchResponse extends Omit<
  ResearchGroupSearchResponse,
  'hits' | 'researchEntities'
> {
  researchEntities: ResearchEntity[];
  hits: ResearchEntity[];
}

export interface ResearchEntityDetailPayload extends Omit<
  LabDetailPayload,
  'group' | 'researchEntity'
> {
  researchEntity: ResearchEntity;
  group?: ResearchEntity;
}

type MaybeResearchEntityDetailPayload = Partial<
  Omit<LabDetailPayload, 'group' | 'researchEntity'>
> & {
  researchEntity?: ResearchEntity | null;
  group?: ResearchEntity | null;
};

const normalizeSearchMatch = (
  value: ResearchEntitySearchMatch | undefined,
): ResearchEntitySearchMatch | undefined => {
  if (!value || typeof value.reason !== 'string') return undefined;

  return {
    mode: value.mode,
    concepts: normalizeResearchStringArray(value.concepts),
    methods: normalizeResearchStringArray(value.methods),
    reason: value.reason.trim(),
  };
};

const normalizeStudentDecisionExplanation = (
  value: ResearchEntity['studentDecisionExplanation'],
): ResearchEntity['studentDecisionExplanation'] => {
  if (!value || typeof value.headline !== 'string' || typeof value.explanation !== 'string') {
    return undefined;
  }
  return {
    ...value,
    headline: value.headline.trim(),
    explanation: value.explanation.trim(),
    why: Array.isArray(value.why)
      ? value.why
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 3)
      : [],
    sourceUrls: Array.isArray(value.sourceUrls)
      ? value.sourceUrls.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
};

const normalizeResearchEntity = (entity: ResearchEntity): ResearchEntity => ({
  ...entity,
  shortDescription: publicResearchDescriptionText(entity.shortDescription),
  description: publicResearchDescriptionText(entity.description),
  fullDescription: publicResearchDescriptionText(entity.fullDescription),
  researchAreas: normalizeResearchMetadataLabels(entity.researchAreas),
  searchMatch: normalizeSearchMatch(entity.searchMatch),
  studentDecisionExplanation: normalizeStudentDecisionExplanation(
    entity.studentDecisionExplanation,
  ),
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
    roster: payload.roster ?? {
      status: 'no-verified-data',
      returned: 0,
      truncated: false,
      withheldCount: 0,
    },
    researchActivityLinks: payload.researchActivityLinks ?? [],
    earlierResearchActivityLinks: payload.earlierResearchActivityLinks ?? [],
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
