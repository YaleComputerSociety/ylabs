import { Types, type PipelineStage } from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import type {
  CompensationType,
  EntryPathwayStatus,
  EntryPathwayType,
  EvidenceStrength,
  ResearchEntityType,
} from '../models/researchAccessTypes';
import { sanitizeResearchEntityPublicDescriptionFields } from '../utils/researchEntityDescriptionText';
import { publicSourceUrl, publicSourceUrls } from '../utils/publicSourceUrl';
import { firstUsableResearchWebsiteUrl } from '../utils/researchWebsiteUrl';
import { publicResearchAreaArray } from './researchEntityDto';
import { redactDirectContactInfo } from '../utils/contactRedaction';

export const pathwayBestNextStepCategories = [
  'apply',
  'find-funding',
  'plan-outreach',
  'contact-program',
  'save-for-later',
  'check-back-later',
] as const;

export type PathwayBestNextStepCategory =
  (typeof pathwayBestNextStepCategories)[number];

export type PathwayActionability = 'ACTION_READY' | 'REFERENCE_ONLY';

export interface PathwaySearchFilters {
  pathwayIds?: string[];
  entityIds?: string[];
  pathwayType?: EntryPathwayType[];
  compensation?: CompensationType[];
  status?: EntryPathwayStatus[];
  evidenceStrength?: EvidenceStrength[];
  entityType?: ResearchEntityType[];
  departments?: string[];
  researchAreas?: string[];
  hasActivePostedOpportunity?: boolean;
  bestNextStepCategory?: PathwayBestNextStepCategory[];
}

export interface PathwaySearchSort {
  sortBy?: 'relevance' | 'confidence' | 'lastObservedAt' | 'deadline' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface PathwaySearchInput {
  q?: string;
  page?: number;
  pageSize?: number;
  filters?: PathwaySearchFilters;
  sort?: PathwaySearchSort;
}

export interface PathwaySearchResearchEntityHit {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
  shortDescription?: string;
  description?: string;
  fullDescription?: string;
  kind?: string;
  entityType?: string;
  departments: string[];
  researchAreas: string[];
  school?: string;
  websiteUrl?: string;
}

export interface PathwaySearchPostedOpportunityHit {
  _id: string;
  title: string;
  deadline?: Date;
  applicationUrl?: string;
  status: 'OPEN' | 'ROLLING';
  term?: string;
  provenance?: 'LISTING_BRIDGED' | 'SCRAPER_DERIVED';
}

export interface PathwaySearchEvidenceHit {
  signalType: string;
  confidence: string;
  confidenceScore?: number;
  excerpt?: string;
  sourceUrl?: string;
  sourceName?: string;
  derivationKey?: string;
  observedAt?: Date;
}

export interface PathwaySearchContactRouteHit {
  routeType: string;
  label?: string;
  url?: string;
  contactPolicy?: string;
  visibility?: string;
  rationale?: string;
}

export interface PathwaySearchHit {
  _id: string;
  pathwayType: string;
  status: string;
  evidenceStrength: string;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  bestNextStepCategory: PathwayBestNextStepCategory;
  compensation?: string;
  confidence?: number;
  derivationKey?: string;
  sourceUrls: string[];
  lastObservedAt?: Date;
  createdAt?: Date;
  researchEntity: PathwaySearchResearchEntityHit;
  activePostedOpportunity?: PathwaySearchPostedOpportunityHit;
  evidence: PathwaySearchEvidenceHit[];
  contactRoute?: PathwaySearchContactRouteHit;
  qualityScore?: number;
  evidenceCount?: number;
  hasMicrositeEvidence?: boolean;
  hasFellowshipEvidence?: boolean;
  isProfileFallback?: boolean;
  actionability?: PathwayActionability;
}

export interface PathwaySearchResult {
  hits: PathwaySearchHit[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

interface BestNextStepSnapshot {
  pathwayType?: string;
  status?: string;
  activePostedOpportunity?: unknown;
  contactRoute?: {
    routeType?: string;
  };
  evidence?: Array<{
    signalType?: string;
  }>;
}

export interface PathwayQualityInput {
  pathwayType?: string;
  status?: string;
  evidenceStrength?: string;
  compensation?: string;
  confidence?: number;
  derivationKey?: string;
  activePostedOpportunity?: unknown;
  evidence?: Array<{
    signalType?: string;
    sourceName?: string;
    sourceUrl?: string;
    derivationKey?: string;
  }>;
  contactRoute?: {
    routeType?: string;
  };
}

export interface PathwayQuality {
  qualityScore: number;
  evidenceCount: number;
  hasMicrositeEvidence: boolean;
  hasFellowshipEvidence: boolean;
  isProfileFallback: boolean;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 24;
const FORMALIZATION_ONLY_PATHWAY_TYPES: EntryPathwayType[] = [
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
];
const FORMALIZATION_ONLY_PATHWAY_TYPE_SET = new Set<string>(
  FORMALIZATION_ONLY_PATHWAY_TYPES,
);
const PROFILE_FALLBACK_DERIVATION_RE = /^pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:/i;
const MICROSITE_EVIDENCE_RE = /microsite|lab-microsite|undergrad/i;
const APPLICATION_ROUTE_SIGNAL_TYPES = [
  'POSTED_OPENING',
  'APPLICATION_FORM_EXISTS',
  'RECURRING_PROGRAM',
  'APPLICATION_ONLY',
] as const;
const CONTACT_INSTRUCTION_SIGNAL_TYPES = [
  'CONTACT_INSTRUCTIONS_EXIST',
  'PROGRAM_MANAGER_LISTED',
  'LAB_MANAGER_LISTED',
  'APPLICATION_ONLY',
] as const;
const STRONG_UNDERGRAD_SIGNAL_TYPES = [
  'CURRENT_UNDERGRADS',
  'PAST_UNDERGRADS',
  'FACULTY_SUPERVISES_STUDENT_PROJECTS',
] as const;
const STRUCTURED_ACTION_PATHWAY_TYPES = [
  'POSTED_ROLE',
  'RECURRING_PROGRAM',
  'CENTER_INTERNSHIP',
  'WORK_STUDY',
  'INTERNSHIP',
] as const;
const PROGRAM_CONTACT_ROUTE_TYPES = [
  'PROGRAM_MANAGER',
  'DEPARTMENT_CONTACT',
  'FELLOWSHIP_OFFICE',
  'COURSE_INSTRUCTOR',
] as const;
const NON_RAW_CONTACT_ROUTE_TYPES = [
  'OFFICIAL_APPLICATION',
  'LAB_MANAGER',
  'PROGRAM_MANAGER',
  'DEPARTMENT_CONTACT',
  'FELLOWSHIP_OFFICE',
  'COURSE_INSTRUCTOR',
] as const;

const trimValues = (values?: string[]): string[] =>
  (values || []).map((value) => value.trim()).filter(Boolean);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toObjectIds = (ids?: string[]): Types.ObjectId[] =>
  Array.from(new Set(trimValues(ids)))
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

const redactPublicText = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(value) : undefined;

export function computePathwayQuality(input: PathwayQualityInput): PathwayQuality {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const evidenceCount = evidence.length;
  const signalTypes = new Set(evidence.map((item) => item.signalType).filter(Boolean));
  const isProfileFallback = PROFILE_FALLBACK_DERIVATION_RE.test(input.derivationKey || '');
  const hasMicrositeEvidence = evidence.some((item) =>
    MICROSITE_EVIDENCE_RE.test(
      [item.sourceName, item.sourceUrl, item.derivationKey, item.signalType].filter(Boolean).join(' '),
    ),
  );
  const hasFellowshipEvidence =
    signalTypes.has('FELLOWSHIP_COMPATIBLE') ||
    input.compensation === 'FELLOWSHIP' ||
    input.compensation === 'FELLOWSHIP_ELIGIBLE' ||
    input.contactRoute?.routeType === 'FELLOWSHIP_OFFICE';

  const evidenceStrengthScore: Record<string, number> = {
    DIRECT: 40,
    STRONG: 28,
    MODERATE: 16,
    WEAK: 4,
    NONE: 0,
  };
  const statusScore: Record<string, number> = {
    ACTIVE: 35,
    RECURRING: 25,
    PLAUSIBLE: 12,
    HISTORICAL: -10,
    NOT_CURRENTLY_AVAILABLE: -25,
    NO_EVIDENCE: -35,
  };

  let qualityScore = 0;
  if (input.activePostedOpportunity) qualityScore += 100;
  if (input.contactRoute?.routeType === 'OFFICIAL_APPLICATION') qualityScore += 45;
  if (input.pathwayType === 'POSTED_ROLE') qualityScore += 35;
  if (input.pathwayType === 'RECURRING_PROGRAM' || input.pathwayType === 'CENTER_INTERNSHIP') {
    qualityScore += 24;
  }
  qualityScore += statusScore[input.status || ''] || 0;
  qualityScore += evidenceStrengthScore[input.evidenceStrength || ''] || 0;
  qualityScore += Math.min(evidenceCount, 5) * 8;
  qualityScore += Math.round((input.confidence || 0) * 20);
  if (signalTypes.has('POSTED_OPENING')) qualityScore += 40;
  if (signalTypes.has('APPLICATION_FORM_EXISTS')) qualityScore += 30;
  if (signalTypes.has('CURRENT_UNDERGRADS')) qualityScore += 24;
  if (signalTypes.has('PAST_UNDERGRADS')) qualityScore += 20;
  if (signalTypes.has('CONTACT_INSTRUCTIONS_EXIST')) qualityScore += 16;
  if (hasMicrositeEvidence) qualityScore += 18;
  if (hasFellowshipEvidence) qualityScore += 14;
  if (input.derivationKey && !isProfileFallback) qualityScore += 8;
  if (isProfileFallback) qualityScore -= 80;

  return {
    qualityScore,
    evidenceCount,
    hasMicrositeEvidence,
    hasFellowshipEvidence,
    isProfileFallback,
  };
}

export function getBestNextStepCategory(
  snapshot: BestNextStepSnapshot,
): PathwayBestNextStepCategory {
  const signalTypes = new Set(
    (snapshot.evidence || []).map((item) => item.signalType).filter(Boolean),
  );
  const hasApplicationRouteEvidence = APPLICATION_ROUTE_SIGNAL_TYPES.some((signalType) =>
    signalTypes.has(signalType),
  );

  if (snapshot.status === 'NOT_CURRENTLY_AVAILABLE') {
    return 'check-back-later';
  }

  if (snapshot.activePostedOpportunity) {
    return 'apply';
  }

  if (
    snapshot.contactRoute?.routeType === 'OFFICIAL_APPLICATION' &&
    hasApplicationRouteEvidence
  ) {
    return 'apply';
  }

  if (
    snapshot.contactRoute?.routeType === 'OFFICIAL_APPLICATION' ||
    snapshot.contactRoute?.routeType === 'PROGRAM_MANAGER' ||
    snapshot.contactRoute?.routeType === 'DEPARTMENT_CONTACT' ||
    snapshot.contactRoute?.routeType === 'FELLOWSHIP_OFFICE' ||
    snapshot.contactRoute?.routeType === 'COURSE_INSTRUCTOR'
  ) {
    return 'contact-program';
  }

  if (
    snapshot.pathwayType === 'EXPLORATORY_CONTACT' ||
    snapshot.pathwayType === 'VOLUNTEER_OUTREACH' ||
    snapshot.pathwayType === 'FACULTY_SUPERVISION'
  ) {
    return 'plan-outreach';
  }

  if (snapshot.status === 'NO_EVIDENCE' || snapshot.status === 'HISTORICAL') {
    return 'save-for-later';
  }

  return 'save-for-later';
}

function buildBestNextStepCategoryExpression(): Record<string, unknown> {
  const hasApplicationRouteEvidence = {
    $gt: [
      {
        $size: {
          $setIntersection: [
            { $ifNull: ['$evidence.signalType', []] },
            [...APPLICATION_ROUTE_SIGNAL_TYPES],
          ],
        },
      },
      0,
    ],
  };

  return {
    $switch: {
      branches: [
        {
          case: { $eq: ['$status', 'NOT_CURRENTLY_AVAILABLE'] },
          then: 'check-back-later',
        },
        {
          case: {
            $or: [
              { $ne: [{ $ifNull: ['$activePostedOpportunity', null] }, null] },
              {
                $and: [
                  { $eq: ['$contactRoute.routeType', 'OFFICIAL_APPLICATION'] },
                  hasApplicationRouteEvidence,
                ],
              },
            ],
          },
          then: 'apply',
        },
        {
          case: {
            $in: [
              '$contactRoute.routeType',
              [
                'OFFICIAL_APPLICATION',
                'PROGRAM_MANAGER',
                'DEPARTMENT_CONTACT',
                'FELLOWSHIP_OFFICE',
                'COURSE_INSTRUCTOR',
              ],
            ],
          },
          then: 'contact-program',
        },
        {
          case: {
            $in: [
              '$pathwayType',
              ['EXPLORATORY_CONTACT', 'VOLUNTEER_OUTREACH', 'FACULTY_SUPERVISION'],
            ],
          },
          then: 'plan-outreach',
        },
        {
          case: { $in: ['$status', ['NO_EVIDENCE', 'HISTORICAL']] },
          then: 'save-for-later',
        },
      ],
      default: 'save-for-later',
    },
  };
}

function hasAnySignalExpression(signalTypes: readonly string[]): Record<string, unknown> {
  return {
    $gt: [
      {
        $size: {
          $setIntersection: [
            { $ifNull: ['$evidence.signalType', []] },
            [...signalTypes],
          ],
        },
      },
      0,
    ],
  };
}

function compactMatch(match: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(match).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }),
  );
}

function buildPathwayMatch(filters: PathwaySearchFilters): Record<string, unknown> {
  const pathwayIds = toObjectIds(filters.pathwayIds);
  const hasPathwayIdFilter = trimValues(filters.pathwayIds).length > 0;
  const requestedPathwayTypes = (filters.pathwayType || []).filter(
    (pathwayType) => !FORMALIZATION_ONLY_PATHWAY_TYPE_SET.has(pathwayType),
  );
  const pathwayType =
    filters.pathwayType && filters.pathwayType.length > 0
      ? { $in: requestedPathwayTypes }
      : { $nin: FORMALIZATION_ONLY_PATHWAY_TYPES };

  return compactMatch({
    archived: { $ne: true },
    $nor: [{ derivationKey: /^listing:/ }],
    _id: hasPathwayIdFilter ? { $in: pathwayIds } : undefined,
    pathwayType,
    compensation:
      filters.compensation && filters.compensation.length > 0
        ? { $in: filters.compensation }
        : undefined,
    status:
      filters.status && filters.status.length > 0 ? { $in: filters.status } : undefined,
    evidenceStrength:
      filters.evidenceStrength && filters.evidenceStrength.length > 0
        ? { $in: filters.evidenceStrength }
        : undefined,
  });
}

function buildEntityMatch(filters: PathwaySearchFilters): Record<string, unknown> {
  const departments = trimValues(filters.departments);
  const researchAreas = trimValues(filters.researchAreas);
  const entityIds = toObjectIds(filters.entityIds);

  return compactMatch({
    'researchEntity.archived': { $ne: true },
    'researchEntity._id':
      trimValues(filters.entityIds).length > 0 ? { $in: entityIds } : undefined,
    'researchEntity.entityType':
      filters.entityType && filters.entityType.length > 0
        ? { $in: filters.entityType }
        : undefined,
    'researchEntity.departments':
      departments.length > 0 ? { $in: departments } : undefined,
    'researchEntity.researchAreas':
      researchAreas.length > 0 ? { $in: researchAreas } : undefined,
  });
}

function buildTextMatch(query: string): PipelineStage.Match | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return null;

  const regex = new RegExp(escapeRegExp(trimmedQuery), 'i');
  return {
    $match: {
      $or: [
        { studentFacingLabel: regex },
        { explanation: regex },
        { bestNextStep: regex },
        { pathwayType: regex },
        { compensation: regex },
        { 'researchEntity.name': regex },
        { 'researchEntity.displayName': regex },
        { 'researchEntity.shortDescription': regex },
        { 'researchEntity.description': regex },
        { 'researchEntity.fullDescription': regex },
        { 'researchEntity.departments': regex },
        { 'researchEntity.researchAreas': regex },
        { 'researchEntity.school': regex },
      ],
    },
  };
}

function buildSort(sort: PathwaySearchSort, query: string): Record<string, 1 | -1> {
  const direction = sort.sortOrder === 'asc' ? 1 : -1;

  switch (sort.sortBy) {
    case 'confidence':
      return { confidence: direction, qualityScore: -1, lastObservedAt: -1, createdAt: -1 };
    case 'lastObservedAt':
      return { lastObservedAt: direction, qualityScore: -1, confidence: -1, createdAt: -1 };
    case 'deadline':
      return { 'activePostedOpportunity.deadline': direction, qualityScore: -1, confidence: -1, createdAt: -1 };
    case 'createdAt':
      return { createdAt: direction, qualityScore: -1, confidence: -1 };
    case 'relevance':
    default:
      if (query.trim()) {
        return { qualityScore: -1, evidenceCount: -1, confidence: -1, lastObservedAt: -1, createdAt: -1 };
      }
      return { qualityScore: -1, evidenceCount: -1, confidence: -1, lastObservedAt: -1, createdAt: -1 };
  }
}

function normalizeHit(raw: Record<string, any>): PathwaySearchHit {
  const contactRouteUrl = publicSourceUrl(raw.contactRoute?.url);
  const contactRoute =
    raw.contactRoute?.visibility === 'PUBLIC' &&
    (!raw.contactRoute?.url || Boolean(contactRouteUrl))
      ? {
          routeType: raw.contactRoute.routeType,
          label: redactPublicText(raw.contactRoute.label),
          url: contactRouteUrl,
          contactPolicy: raw.contactRoute.contactPolicy,
          visibility: raw.contactRoute.visibility,
          rationale: redactPublicText(raw.contactRoute.rationale),
        }
      : undefined;
  const researchEntity = sanitizeResearchEntityPublicDescriptionFields(
    raw.researchEntity || {},
  );

  return {
    _id: String(raw._id),
    pathwayType: raw.pathwayType,
    status: raw.status,
    evidenceStrength: raw.evidenceStrength,
    studentFacingLabel: redactPublicText(raw.studentFacingLabel) || '',
    explanation: redactPublicText(raw.explanation),
    bestNextStep: redactPublicText(raw.bestNextStep),
    bestNextStepCategory: raw.bestNextStepCategory,
    compensation: raw.compensation,
    confidence: raw.confidence,
    derivationKey: raw.derivationKey,
    sourceUrls: publicSourceUrls(raw.sourceUrls),
    lastObservedAt: raw.lastObservedAt,
    createdAt: raw.createdAt,
    researchEntity: {
      _id: String(researchEntity?._id || ''),
      slug: researchEntity?.slug || '',
      name: researchEntity?.name || '',
      displayName: researchEntity?.displayName,
      shortDescription: researchEntity?.shortDescription,
      description: researchEntity?.description,
      fullDescription: researchEntity?.fullDescription,
      kind: researchEntity?.kind,
      entityType: researchEntity?.entityType,
      departments: researchEntity?.departments || [],
      researchAreas: publicResearchAreaArray(researchEntity?.researchAreas),
      school: researchEntity?.school,
      websiteUrl: firstUsableResearchWebsiteUrl([
        researchEntity?.websiteUrl,
        researchEntity?.website,
        researchEntity?.sourceUrls,
      ]) || undefined,
    },
    activePostedOpportunity: raw.activePostedOpportunity
      ? {
          _id: String(raw.activePostedOpportunity._id),
          title: raw.activePostedOpportunity.title,
          deadline: raw.activePostedOpportunity.deadline,
          applicationUrl: publicSourceUrl(raw.activePostedOpportunity.applicationUrl),
          status: raw.activePostedOpportunity.status,
          term: raw.activePostedOpportunity.term,
          provenance:
            raw.activePostedOpportunity.provenance ||
            (raw.activePostedOpportunity.listingId ? 'LISTING_BRIDGED' : 'SCRAPER_DERIVED'),
        }
      : undefined,
    evidence: (raw.evidence || []).map((item: any) => {
      const excerpt = redactPublicText(item?.excerpt);
      return {
        ...item,
        ...(excerpt !== undefined ? { excerpt } : {}),
        sourceUrl: publicSourceUrl(item?.sourceUrl),
      };
    }),
    contactRoute,
    qualityScore: raw.qualityScore,
    evidenceCount: raw.evidenceCount,
    hasMicrositeEvidence: raw.hasMicrositeEvidence,
    hasFellowshipEvidence: raw.hasFellowshipEvidence,
    isProfileFallback: raw.isProfileFallback,
    actionability: raw.actionability,
  };
}

function buildPathwayQualityFieldsExpression(): Record<string, unknown> {
  return {
    evidenceCount: { $size: { $ifNull: ['$evidence', []] } },
    hasMicrositeEvidence: {
      $gt: [
        {
          $size: {
            $filter: {
              input: { $ifNull: ['$evidence', []] },
              as: 'item',
              cond: {
                $regexMatch: {
                  input: {
                    $concat: [
                      { $ifNull: ['$$item.sourceName', ''] },
                      ' ',
                      { $ifNull: ['$$item.sourceUrl', ''] },
                      ' ',
                      { $ifNull: ['$$item.derivationKey', ''] },
                      ' ',
                      { $ifNull: ['$$item.signalType', ''] },
                    ],
                  },
                  regex: 'microsite|lab-microsite|undergrad',
                  options: 'i',
                },
              },
            },
          },
        },
        0,
      ],
    },
    hasFellowshipEvidence: {
      $or: [
        { $in: ['$compensation', ['FELLOWSHIP', 'FELLOWSHIP_ELIGIBLE']] },
        { $eq: ['$contactRoute.routeType', 'FELLOWSHIP_OFFICE'] },
        { $in: ['FELLOWSHIP_COMPATIBLE', { $ifNull: ['$evidence.signalType', []] }] },
      ],
    },
    isProfileFallback: {
      $regexMatch: {
        input: { $ifNull: ['$derivationKey', ''] },
        regex: '^pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:',
        options: 'i',
      },
    },
  };
}

function buildQualityScoreExpression(): Record<string, unknown> {
  return {
    $add: [
      { $cond: [{ $ne: [{ $ifNull: ['$activePostedOpportunity', null] }, null] }, 100, 0] },
      { $cond: [{ $eq: ['$contactRoute.routeType', 'OFFICIAL_APPLICATION'] }, 45, 0] },
      { $cond: [{ $eq: ['$pathwayType', 'POSTED_ROLE'] }, 35, 0] },
      { $cond: [{ $in: ['$pathwayType', ['RECURRING_PROGRAM', 'CENTER_INTERNSHIP']] }, 24, 0] },
      {
        $switch: {
          branches: [
            { case: { $eq: ['$status', 'ACTIVE'] }, then: 35 },
            { case: { $eq: ['$status', 'RECURRING'] }, then: 25 },
            { case: { $eq: ['$status', 'PLAUSIBLE'] }, then: 12 },
            { case: { $eq: ['$status', 'HISTORICAL'] }, then: -10 },
            { case: { $eq: ['$status', 'NOT_CURRENTLY_AVAILABLE'] }, then: -25 },
            { case: { $eq: ['$status', 'NO_EVIDENCE'] }, then: -35 },
          ],
          default: 0,
        },
      },
      {
        $switch: {
          branches: [
            { case: { $eq: ['$evidenceStrength', 'DIRECT'] }, then: 40 },
            { case: { $eq: ['$evidenceStrength', 'STRONG'] }, then: 28 },
            { case: { $eq: ['$evidenceStrength', 'MODERATE'] }, then: 16 },
            { case: { $eq: ['$evidenceStrength', 'WEAK'] }, then: 4 },
          ],
          default: 0,
        },
      },
      { $multiply: [{ $min: ['$evidenceCount', 5] }, 8] },
      { $round: [{ $multiply: [{ $ifNull: ['$confidence', 0] }, 20] }, 0] },
      { $cond: [{ $in: ['POSTED_OPENING', { $ifNull: ['$evidence.signalType', []] }] }, 40, 0] },
      { $cond: [{ $in: ['APPLICATION_FORM_EXISTS', { $ifNull: ['$evidence.signalType', []] }] }, 30, 0] },
      { $cond: [{ $in: ['CURRENT_UNDERGRADS', { $ifNull: ['$evidence.signalType', []] }] }, 24, 0] },
      { $cond: [{ $in: ['PAST_UNDERGRADS', { $ifNull: ['$evidence.signalType', []] }] }, 20, 0] },
      { $cond: [{ $in: ['CONTACT_INSTRUCTIONS_EXIST', { $ifNull: ['$evidence.signalType', []] }] }, 16, 0] },
      { $cond: ['$hasMicrositeEvidence', 18, 0] },
      { $cond: ['$hasFellowshipEvidence', 14, 0] },
      {
        $cond: [
          {
            $and: [
              { $ne: [{ $ifNull: ['$derivationKey', ''] }, ''] },
              { $not: ['$isProfileFallback'] },
            ],
          },
          8,
          0,
        ],
      },
      { $cond: ['$isProfileFallback', -80, 0] },
    ],
  };
}

function buildPathwayActionabilityFieldsExpression(): Record<string, unknown> {
  const activePostedOpportunity = {
    $ne: [{ $ifNull: ['$activePostedOpportunity', null] }, null],
  };
  const hasApplicationRouteEvidence = hasAnySignalExpression(APPLICATION_ROUTE_SIGNAL_TYPES);
  const hasContactInstructionEvidence = hasAnySignalExpression(CONTACT_INSTRUCTION_SIGNAL_TYPES);
  const hasStrongUndergradEvidence = hasAnySignalExpression(STRONG_UNDERGRAD_SIGNAL_TYPES);
  const contactSourceEvidenceCount = {
    $size: { $ifNull: ['$contactRoute.sourceEvidenceIds', []] },
  };
  const evidenceSourceUrlCount = {
    $size: {
      $filter: {
        input: { $ifNull: ['$evidence', []] },
        as: 'item',
        cond: { $ne: [{ $ifNull: ['$$item.sourceUrl', ''] }, ''] },
      },
    },
  };
  const hasPublicSourceEvidence = {
    $or: [
      { $gt: [{ $size: { $ifNull: ['$sourceUrls', []] } }, 0] },
      { $gt: [evidenceSourceUrlCount, 0] },
      { $ne: [{ $ifNull: ['$contactRoute.sourceUrl', ''] }, ''] },
      { $gt: [contactSourceEvidenceCount, 0] },
    ],
  };
  const hasPublicContactRoute = {
    $ne: [{ $ifNull: ['$contactRoute.routeType', null] }, null],
  };
  const hasNonRawPublicContactRoute = {
    $in: ['$contactRoute.routeType', [...NON_RAW_CONTACT_ROUTE_TYPES]],
  };
  const isStructuredRoute = {
    $in: ['$pathwayType', [...STRUCTURED_ACTION_PATHWAY_TYPES]],
  };
  const hasActionableStatus = {
    $in: ['$status', ['ACTIVE', 'RECURRING', 'PLAUSIBLE']],
  };
  const isProgramContactRoute = {
    $in: ['$contactRoute.routeType', [...PROGRAM_CONTACT_ROUTE_TYPES]],
  };

  return {
    actionability: {
      $cond: [
        {
          $and: [
            { $not: ['$isProfileFallback'] },
            {
              $or: [
                activePostedOpportunity,
                {
                  $and: [
                    { $eq: ['$contactRoute.routeType', 'OFFICIAL_APPLICATION'] },
                    hasApplicationRouteEvidence,
                    hasPublicSourceEvidence,
                  ],
                },
                {
                  $and: [
                    isStructuredRoute,
                    hasActionableStatus,
                    hasPublicSourceEvidence,
                  ],
                },
                {
                  $and: [
                    isProgramContactRoute,
                    hasPublicContactRoute,
                    hasContactInstructionEvidence,
                    hasPublicSourceEvidence,
                  ],
                },
                {
                  $and: [
                    hasStrongUndergradEvidence,
                    hasNonRawPublicContactRoute,
                    hasPublicSourceEvidence,
                  ],
                },
              ],
            },
          ],
        },
        'ACTION_READY',
        'REFERENCE_ONLY',
      ],
    },
  };
}

export async function searchPathways(
  input: PathwaySearchInput,
): Promise<PathwaySearchResult> {
  const filters = input.filters || {};
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(input.pageSize || DEFAULT_PAGE_SIZE)),
  );
  const skip = (page - 1) * pageSize;
  const query = input.q || '';
  const sort = input.sort || {};

  const pipeline: PipelineStage[] = [
    { $match: buildPathwayMatch(filters) },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: 'researchEntity',
      },
    },
    { $unwind: '$researchEntity' },
    { $match: buildEntityMatch(filters) },
    {
      $lookup: {
        from: 'posted_opportunities',
        let: { pathwayId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$entryPathwayId', '$$pathwayId'] },
                  { $ne: ['$archived', true] },
                  { $in: ['$status', ['OPEN', 'ROLLING']] },
                  { $eq: [{ $ifNull: ['$listingId', null] }, null] },
                ],
              },
            },
          },
          { $sort: { deadline: 1, createdAt: -1 } },
          { $limit: 1 },
          {
            $project: {
              _id: 1,
              title: 1,
              deadline: 1,
              applicationUrl: 1,
              status: 1,
              term: 1,
              listingId: 1,
              provenance: {
                $cond: [{ $ifNull: ['$listingId', false] }, 'LISTING_BRIDGED', 'SCRAPER_DERIVED'],
              },
            },
          },
        ],
        as: 'activePostedOpportunities',
      },
    },
    {
      $addFields: {
        activePostedOpportunity: { $arrayElemAt: ['$activePostedOpportunities', 0] },
      },
    },
  ];

  if (typeof filters.hasActivePostedOpportunity === 'boolean') {
    pipeline.push({
      $match: filters.hasActivePostedOpportunity
        ? { activePostedOpportunity: { $ne: null } }
        : { activePostedOpportunity: null },
    });
  }

  const textMatch = buildTextMatch(query);
  if (textMatch) pipeline.push(textMatch);

  pipeline.push(
    {
      $lookup: {
        from: 'access_signals',
        let: { pathwayId: '$_id', entityId: '$researchEntityId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: ['$archived', true] },
                  {
                    $or: [
                      { $eq: ['$entryPathwayId', '$$pathwayId'] },
                      {
                        $and: [
                          { $eq: ['$researchEntityId', '$$entityId'] },
                          { $eq: [{ $ifNull: ['$entryPathwayId', null] }, null] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { confidenceScore: -1, observedAt: -1 } },
          { $limit: 3 },
          {
            $project: {
              _id: 0,
              signalType: 1,
              confidence: 1,
              confidenceScore: 1,
              excerpt: 1,
              sourceUrl: 1,
              sourceName: 1,
              derivationKey: 1,
              observedAt: 1,
            },
          },
        ],
        as: 'evidence',
      },
    },
    {
      $lookup: {
        from: 'contact_routes',
        let: { pathwayId: '$_id', entityId: '$researchEntityId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: ['$archived', true] },
                  { $eq: ['$visibility', 'PUBLIC'] },
                  { $ne: ['$contactPolicy', 'NO_DIRECT_CONTACT'] },
                  {
                    $or: [
                      { $eq: ['$entryPathwayId', '$$pathwayId'] },
                      {
                        $and: [
                          { $eq: ['$researchEntityId', '$$entityId'] },
                          { $eq: [{ $ifNull: ['$entryPathwayId', null] }, null] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          {
            $addFields: {
              contactPolicyRank: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$contactPolicy', 'APPLICATION_ONLY'] }, then: 0 },
                    { case: { $eq: ['$contactPolicy', 'OFFICIAL_ROUTE_PREFERRED'] }, then: 1 },
                    { case: { $eq: ['$contactPolicy', 'DIRECT_CONTACT_OK'] }, then: 2 },
                  ],
                  default: 5,
                },
              },
              routeTypeRank: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$routeType', 'OFFICIAL_APPLICATION'] }, then: 0 },
                    { case: { $eq: ['$routeType', 'PROGRAM_MANAGER'] }, then: 1 },
                    { case: { $eq: ['$routeType', 'DEPARTMENT_CONTACT'] }, then: 2 },
                    { case: { $eq: ['$routeType', 'FELLOWSHIP_OFFICE'] }, then: 3 },
                    { case: { $eq: ['$routeType', 'COURSE_INSTRUCTOR'] }, then: 4 },
                    { case: { $eq: ['$routeType', 'LAB_MANAGER'] }, then: 5 },
                    { case: { $eq: ['$routeType', 'FACULTY_PI'] }, then: 8 },
                  ],
                  default: 9,
                },
              },
            },
          },
          { $sort: { contactPolicyRank: 1, routeTypeRank: 1, priority: 1, updatedAt: -1 } },
          { $limit: 1 },
          {
            $project: {
              _id: 0,
              routeType: 1,
              label: 1,
              url: 1,
              contactPolicy: 1,
              visibility: 1,
              rationale: 1,
              sourceUrl: 1,
              sourceEvidenceId: 1,
              sourceEvidenceIds: 1,
            },
          },
        ],
        as: 'contactRoutes',
      },
    },
    {
      $addFields: {
        contactRoute: { $arrayElemAt: ['$contactRoutes', 0] },
      },
    },
    {
      $addFields: {
        bestNextStepCategory: buildBestNextStepCategoryExpression(),
      },
    },
    {
      $addFields: buildPathwayQualityFieldsExpression(),
    },
    {
      $addFields: {
        qualityScore: buildQualityScoreExpression(),
      },
    },
    {
      $addFields: buildPathwayActionabilityFieldsExpression(),
    },
    {
      $match: {
        actionability: 'ACTION_READY',
      },
    },
  );

  if (filters.bestNextStepCategory && filters.bestNextStepCategory.length > 0) {
    pipeline.push({
      $match: {
        bestNextStepCategory: { $in: filters.bestNextStepCategory },
      },
    });
  }

  pipeline.push({
    $facet: {
      hits: [
        { $sort: buildSort(sort, query) },
        { $skip: skip },
        { $limit: pageSize },
        {
          $project: {
            _id: 1,
            pathwayType: 1,
            status: 1,
            evidenceStrength: 1,
            studentFacingLabel: 1,
            explanation: 1,
            bestNextStep: 1,
            bestNextStepCategory: 1,
            compensation: 1,
            confidence: 1,
            derivationKey: 1,
            sourceUrls: 1,
            lastObservedAt: 1,
            createdAt: 1,
            researchEntity: {
              _id: '$researchEntity._id',
              slug: '$researchEntity.slug',
              name: '$researchEntity.name',
              displayName: '$researchEntity.displayName',
              shortDescription: '$researchEntity.shortDescription',
              description: '$researchEntity.description',
              fullDescription: '$researchEntity.fullDescription',
              kind: '$researchEntity.kind',
              entityType: '$researchEntity.entityType',
              departments: '$researchEntity.departments',
              researchAreas: '$researchEntity.researchAreas',
              school: '$researchEntity.school',
              websiteUrl: '$researchEntity.websiteUrl',
              website: '$researchEntity.website',
            },
            activePostedOpportunity: 1,
            evidence: 1,
            contactRoute: 1,
            qualityScore: 1,
            evidenceCount: 1,
            hasMicrositeEvidence: 1,
            hasFellowshipEvidence: 1,
            isProfileFallback: 1,
            actionability: 1,
          },
        },
      ],
      total: [{ $count: 'count' }],
    },
  });

  const [result] = await EntryPathway.aggregate(pipeline).exec();
  const rawHits = Array.isArray(result?.hits) ? result.hits : [];
  const totalCount =
    Array.isArray(result?.total) && result.total[0]?.count ? Number(result.total[0].count) : 0;

  return {
    hits: rawHits.map(normalizeHit),
    estimatedTotalHits: totalCount,
    page,
    pageSize,
  };
}

export async function getPathwaysByIds(ids: string[]): Promise<PathwaySearchHit[]> {
  const validIds = toObjectIds(ids).map((id) => id.toString());
  if (validIds.length === 0) return [];

  const result = await searchPathways({
    page: 1,
    pageSize: Math.min(MAX_PAGE_SIZE, validIds.length),
    filters: { pathwayIds: validIds },
    sort: { sortBy: 'createdAt', sortOrder: 'desc' },
  });

  const hitsById = new Map(result.hits.map((hit) => [hit._id, hit]));
  return validIds.map((id) => hitsById.get(id)).filter(Boolean) as PathwaySearchHit[];
}

export async function listWaysInForResearchEntities(
  entityIds: string[],
  limitPerEntity = 3,
): Promise<Map<string, PathwaySearchHit[]>> {
  const validEntityIds = Array.from(new Set(trimValues(entityIds))).filter((id) =>
    Types.ObjectId.isValid(id),
  );
  const perEntityLimit = Math.min(5, Math.max(1, Math.floor(limitPerEntity) || 3));
  const waysIn = new Map<string, PathwaySearchHit[]>();

  if (validEntityIds.length === 0) {
    return waysIn;
  }

  await Promise.all(
    validEntityIds.map(async (entityId) => {
      const result = await searchPathways({
        page: 1,
        pageSize: perEntityLimit,
        filters: { entityIds: [entityId] },
        sort: { sortBy: 'relevance', sortOrder: 'desc' },
      });
      waysIn.set(entityId, result.hits);
    }),
  );

  return waysIn;
}
