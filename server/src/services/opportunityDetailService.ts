import { Types } from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { publicPostedOpportunityMongoMatch } from './studentAccessPublicationPolicy';

export type OpportunityDetailProvenance =
  | 'FACULTY_SUBMITTED'
  | 'LISTING_BRIDGED'
  | 'SCRAPER_DERIVED';
export type OpportunityDetailDeadlineState =
  | 'NO_DEADLINE'
  | 'UPCOMING'
  | 'DUE_TODAY'
  | 'PAST'
  | 'ARCHIVED';
export type OpportunityDetailApplicationState =
  | 'APPLY_NOW'
  | 'ROLLING'
  | 'CLOSED'
  | 'ARCHIVED'
  | 'NO_APPLICATION_URL';

export interface OpportunityDetailResearchEntity {
  slug: string;
  name: string;
  displayName?: string;
  kind?: string;
  entityType?: string;
  departments: string[];
  researchAreas: string[];
  school?: string;
  websiteUrl?: string;
  shortDescription?: string;
}

export interface OpportunityDetailPathway {
  pathwayType: string;
  status: string;
  evidenceStrength?: string;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  compensation?: string;
  confidence?: number;
  sourceUrls: string[];
}

export interface OpportunityDetailEvidence {
  sourceName?: string;
  sourceUrl?: string;
  field?: string;
  excerpt?: string;
  confidence?: number;
  observedAt?: Date;
}

export interface OpportunityDetail {
  title: string;
  description?: string;
  term?: string;
  deadline?: Date;
  deadlineState: OpportunityDetailDeadlineState;
  applicationUrl?: string;
  applicationState: OpportunityDetailApplicationState;
  applicationLabel: string;
  status: string;
  provenance: OpportunityDetailProvenance;
  provenanceLabel: string;
  hoursPerWeek?: number;
  payRate?: string;
  compensationType?: string;
  eligibility?: string;
  sourceUrls: string[];
  researchEntity: OpportunityDetailResearchEntity;
  pathway: OpportunityDetailPathway;
  evidence: OpportunityDetailEvidence[];
}

export interface OpportunityDetailServiceDeps {
  opportunityModel?: typeof PostedOpportunity;
  pathwayModel?: typeof EntryPathway;
  researchEntityModel?: typeof ResearchEntity;
  observationModel?: typeof Observation;
  now?: Date;
}

const MAX_EVIDENCE_EXCERPT_LENGTH = 360;
const MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS = 50;
const MAX_OPPORTUNITY_DETAIL_TEXT_LENGTH = 5000;
const MAX_OPPORTUNITY_DETAIL_URL_LENGTH = 2048;
const MAX_OPPORTUNITY_DETAIL_EVIDENCE_DEPTH = 4;
const MAX_OPPORTUNITY_DETAIL_OBJECT_KEYS = 20;
const OPPORTUNITY_DETAIL_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const compactStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .slice(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS)
        .flatMap((value) =>
          Array.isArray(value) ? value.slice(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS) : [value],
        )
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.slice(0, MAX_OPPORTUNITY_DETAIL_TEXT_LENGTH).trim()),
    ),
  );

const HTTP_URL_SCHEMES = new Set(['http:', 'https:']);

const publicHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.slice(0, MAX_OPPORTUNITY_DETAIL_URL_LENGTH).trim();
  if (!trimmed) return undefined;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const candidate = trimmed.startsWith('//')
    ? `https:${trimmed}`
    : hasScheme
      ? trimmed
      : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    return HTTP_URL_SCHEMES.has(parsed.protocol) && isPublicHttpUrl(candidate)
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const publicHttpUrls = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .slice(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS)
        .flatMap((value) =>
          Array.isArray(value) ? value.slice(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS) : [value],
        )
        .map(publicHttpUrl)
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS);

const objectIdString = (value: unknown): string => {
  const id =
    typeof value === 'string'
      ? value.trim()
      : value instanceof Types.ObjectId
        ? value.toHexString()
        : '';
  return OPPORTUNITY_DETAIL_OBJECT_ID_RE.test(id) ? id : '';
};

const toEvidenceIds = (values: unknown[]): Types.ObjectId[] =>
  values
    .slice(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS)
    .flatMap((value) =>
      Array.isArray(value) ? value.slice(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS) : [value],
    )
    .map((value) => objectIdString(value))
    .filter(Boolean)
    .map((value) => new Types.ObjectId(value));

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value.slice(0, MAX_OPPORTUNITY_DETAIL_TEXT_LENGTH).trim() || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

const publicText = (value: unknown): string | undefined => {
  const text = stringValue(value);
  return text ? redactDirectContactInfo(text) : undefined;
};

const publicTextArray = (values: unknown): string[] =>
  Array.isArray(values)
    ? compactStrings(values).map((value) => redactDirectContactInfo(value))
    : [];

const firstEvidenceText = (value: unknown, depth = 0): string | undefined => {
  if (depth > MAX_OPPORTUNITY_DETAIL_EVIDENCE_DEPTH) return undefined;
  const direct = stringValue(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    return (
      value
        .slice(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS)
        .map((item) => firstEvidenceText(item, depth + 1))
        .filter((item): item is string => Boolean(item))
        .join(' ')
        .trim() || undefined
    );
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredKeys = [
      'quote',
      'excerpt',
      'summary',
      'description',
      'undergradRoleEvidenceQuote',
      'contactInstructionsQuote',
      'undergradConstraintQuote',
      'undergradAccessEvidence',
      'title',
      'text',
    ];
    for (const key of preferredKeys.slice(0, MAX_OPPORTUNITY_DETAIL_OBJECT_KEYS)) {
      const text = firstEvidenceText(record[key], depth + 1);
      if (text) return text;
    }
  }

  return undefined;
};

const evidenceExcerpt = (value: unknown): string | undefined => {
  const text = firstEvidenceText(value);
  if (!text) return undefined;
  return truncate(
    redactDirectContactInfo(text.replace(/\s+/g, ' ').trim()),
    MAX_EVIDENCE_EXCERPT_LENGTH,
  );
};

const sameUtcDay = (a: Date, b: Date): boolean =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

export function getOpportunityDeadlineState(
  status: string | undefined,
  deadline: Date | undefined,
  now = new Date(),
): OpportunityDetailDeadlineState {
  if (status === 'ARCHIVED') return 'ARCHIVED';
  if (!deadline || Number.isNaN(deadline.getTime())) return 'NO_DEADLINE';
  if (sameUtcDay(deadline, now)) return 'DUE_TODAY';
  return deadline.getTime() < now.getTime() ? 'PAST' : 'UPCOMING';
}

export function getOpportunityApplicationState(
  status: string | undefined,
  deadlineState: OpportunityDetailDeadlineState,
  applicationUrl?: string,
): OpportunityDetailApplicationState {
  if (status === 'ARCHIVED' || deadlineState === 'ARCHIVED') return 'ARCHIVED';
  if (status === 'CLOSED' || deadlineState === 'PAST') return 'CLOSED';
  if (status === 'ROLLING') return applicationUrl ? 'ROLLING' : 'NO_APPLICATION_URL';
  if (status === 'OPEN') return applicationUrl ? 'APPLY_NOW' : 'NO_APPLICATION_URL';
  return applicationUrl ? 'APPLY_NOW' : 'NO_APPLICATION_URL';
}

export function getOpportunityApplicationLabel(state: OpportunityDetailApplicationState): string {
  switch (state) {
    case 'APPLY_NOW':
      return 'Apply now';
    case 'ROLLING':
      return 'Rolling application';
    case 'CLOSED':
      return 'Closed';
    case 'ARCHIVED':
      return 'Archived';
    case 'NO_APPLICATION_URL':
    default:
      return 'Application route not listed';
  }
}

export async function getOpportunityDetail(
  id: string,
  deps: OpportunityDetailServiceDeps = {},
): Promise<OpportunityDetail | null> {
  const safeId = objectIdString(id);
  if (!safeId) {
    return null;
  }

  const opportunityModel = deps.opportunityModel || PostedOpportunity;
  const pathwayModel = deps.pathwayModel || EntryPathway;
  const researchEntityModel = deps.researchEntityModel || ResearchEntity;
  const observationModel = deps.observationModel || Observation;
  const now = deps.now || new Date();

  const opportunity = await opportunityModel
    .findOne(
      {
        _id: new Types.ObjectId(safeId),
        ...publicPostedOpportunityMongoMatch({ archived: false }, now),
      },
      [
        'entryPathwayId',
        'researchEntityId',
        'listingId',
        'title',
        'description',
        'term',
        'deadline',
        'applicationUrl',
        'status',
        'hoursPerWeek',
        'payRate',
        'compensationType',
        'eligibility',
        'sourceEvidenceIds',
        'sourceUrls',
        'origin',
      ].join(' '),
    )
    .lean();

  if (!opportunity?.entryPathwayId || !opportunity?.researchEntityId) {
    return null;
  }

  const [pathway, researchEntityRaw] = await Promise.all([
    pathwayModel
      .findOne(
        {
          _id: opportunity.entryPathwayId,
          archived: false,
          ...(opportunity.origin === 'FACULTY_SUBMITTED' ? { 'review.status': 'approved' } : {}),
        },
        [
          'pathwayType',
          'status',
          'evidenceStrength',
          'studentFacingLabel',
          'explanation',
          'bestNextStep',
          'compensation',
          'confidence',
          'sourceEvidenceIds',
          'sourceUrls',
        ].join(' '),
      )
      .lean(),
    researchEntityModel
      .findOne(
        {
          _id: opportunity.researchEntityId,
          archived: { $ne: true },
          studentVisibilityTier: { $in: publicStudentVisibilityTiers },
        },
        [
          'slug',
          'name',
          'displayName',
          'kind',
          'entityType',
          'departments',
          'researchAreas',
          'school',
          'websiteUrl',
          'website',
          'shortDescription',
        ].join(' '),
      )
      .lean(),
  ]);
  const researchEntity: any = researchEntityRaw;

  if (!pathway || !researchEntity) {
    return null;
  }

  const evidenceIds = toEvidenceIds([
    opportunity.sourceEvidenceIds || [],
    pathway.sourceEvidenceIds || [],
  ]);
  const evidence =
    evidenceIds.length > 0
      ? await observationModel
          .find(
            { _id: { $in: evidenceIds }, superseded: { $ne: true } },
            'sourceName sourceUrl field value confidence observedAt',
          )
          .sort({ observedAt: -1 })
          .lean()
      : [];

  const sourceUrls = publicHttpUrls([
    opportunity.sourceUrls || [],
    pathway.sourceUrls || [],
    evidence.map((item: any) => item.sourceUrl),
  ]);
  const applicationUrl = publicHttpUrl(opportunity.applicationUrl);
  const researchEntityWebsiteUrl =
    publicHttpUrl(researchEntity.websiteUrl) || publicHttpUrl(researchEntity.website);
  const deadlineState = getOpportunityDeadlineState(
    opportunity.status,
    opportunity.deadline || undefined,
    now,
  );
  const applicationState = getOpportunityApplicationState(
    opportunity.status,
    deadlineState,
    applicationUrl,
  );
  const provenance: OpportunityDetailProvenance = opportunity.listingId
    ? 'LISTING_BRIDGED'
    : opportunity.origin === 'FACULTY_SUBMITTED'
      ? 'FACULTY_SUBMITTED'
      : 'SCRAPER_DERIVED';

  return {
    title: publicText(opportunity.title) || '',
    description: publicText(opportunity.description),
    term: publicText(opportunity.term),
    deadline: opportunity.deadline || undefined,
    deadlineState,
    applicationUrl,
    applicationState,
    applicationLabel: getOpportunityApplicationLabel(applicationState),
    status: opportunity.status,
    provenance,
    provenanceLabel:
      provenance === 'LISTING_BRIDGED'
        ? 'YLabs listing bridge'
        : provenance === 'FACULTY_SUBMITTED'
          ? 'Verified faculty submission'
          : 'Scraper-derived posting',
    hoursPerWeek:
      typeof opportunity.hoursPerWeek === 'number' ? opportunity.hoursPerWeek : undefined,
    payRate: publicText(opportunity.payRate),
    compensationType: opportunity.compensationType,
    eligibility: publicText(opportunity.eligibility),
    sourceUrls,
    researchEntity: {
      slug: researchEntity.slug || '',
      name: publicText(researchEntity.name) || '',
      displayName: publicText(researchEntity.displayName),
      kind: researchEntity.kind,
      entityType: researchEntity.entityType,
      departments: publicTextArray(researchEntity.departments),
      researchAreas: publicTextArray(researchEntity.researchAreas),
      school: publicText(researchEntity.school),
      websiteUrl: researchEntityWebsiteUrl,
      shortDescription: publicText(researchEntity.shortDescription),
    },
    pathway: {
      pathwayType: pathway.pathwayType,
      status: pathway.status,
      evidenceStrength: pathway.evidenceStrength,
      studentFacingLabel: publicText(pathway.studentFacingLabel) || '',
      explanation: publicText(pathway.explanation),
      bestNextStep: publicText(pathway.bestNextStep),
      compensation: pathway.compensation,
      confidence: pathway.confidence,
      sourceUrls: publicHttpUrls([pathway.sourceUrls || []]),
    },
    evidence: evidence.map((item: any) => ({
      sourceName: publicText(item.sourceName),
      sourceUrl: publicHttpUrl(item.sourceUrl),
      field: publicText(item.field),
      excerpt: evidenceExcerpt(item.value),
      confidence: item.confidence,
      observedAt: item.observedAt,
    })),
  };
}
