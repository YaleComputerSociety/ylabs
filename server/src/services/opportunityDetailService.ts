import { Types } from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { publicSourceUrl, publicSourceUrls } from '../utils/publicSourceUrl';
import { firstUsableResearchWebsiteUrl } from '../utils/researchWebsiteUrl';

export type OpportunityDetailProvenance = 'LISTING_BRIDGED' | 'SCRAPER_DERIVED';
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
  _id: string;
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
  _id: string;
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
  _id: string;
  sourceName?: string;
  sourceUrl?: string;
  field?: string;
  excerpt?: string;
  confidence?: number;
  observedAt?: Date;
}

export interface OpportunityDetail {
  _id: string;
  entryPathwayId: string;
  researchEntityId: string;
  listingId?: string;
  title: string;
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
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OpportunityDetailServiceDeps {
  opportunityModel?: typeof PostedOpportunity;
  pathwayModel?: typeof EntryPathway;
  researchEntityModel?: typeof ResearchEntity;
  observationModel?: typeof Observation;
  now?: Date;
}

const MAX_EVIDENCE_EXCERPT_LENGTH = 360;

const compactStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  );

const idString = (value: unknown): string => String(value || '');

const documentId = (record: any): string => idString(record?._id);

const toEvidenceIds = (values: unknown[]): Types.ObjectId[] =>
  values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => idString(value))
    .filter((value) => Types.ObjectId.isValid(value))
    .map((value) => new Types.ObjectId(value));

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

const firstEvidenceText = (value: unknown): string | undefined => {
  const direct = stringValue(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    return (
      value
        .map(firstEvidenceText)
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
    for (const key of preferredKeys) {
      const text = firstEvidenceText(record[key]);
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
  if (!Types.ObjectId.isValid(id)) {
    return null;
  }

  const opportunityModel = deps.opportunityModel || PostedOpportunity;
  const pathwayModel = deps.pathwayModel || EntryPathway;
  const researchEntityModel = deps.researchEntityModel || ResearchEntity;
  const observationModel = deps.observationModel || Observation;
  const now = deps.now || new Date();

  const opportunity = await opportunityModel
    .findOne(
      { _id: new Types.ObjectId(id), archived: false },
      [
        'entryPathwayId',
        'researchEntityId',
        'listingId',
        'title',
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
        'createdAt',
        'updatedAt',
      ].join(' '),
    )
    .lean();

  if (!opportunity?.entryPathwayId || !opportunity?.researchEntityId) {
    return null;
  }

  const [pathway, researchEntityRaw] = await Promise.all([
    pathwayModel
      .findOne(
        { _id: opportunity.entryPathwayId, archived: false },
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
        { _id: opportunity.researchEntityId, archived: { $ne: true } },
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

  const sourceUrls = publicSourceUrls(compactStrings([
    opportunity.sourceUrls || [],
    pathway.sourceUrls || [],
    evidence.map((item: any) => item.sourceUrl),
  ]));
  const applicationUrl = publicSourceUrl(opportunity.applicationUrl);
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
    : 'SCRAPER_DERIVED';

  return {
    _id: documentId(opportunity),
    entryPathwayId: idString(opportunity.entryPathwayId),
    researchEntityId: idString(opportunity.researchEntityId),
    listingId: opportunity.listingId ? idString(opportunity.listingId) : undefined,
    title: opportunity.title,
    term: opportunity.term || undefined,
    deadline: opportunity.deadline || undefined,
    deadlineState,
    applicationUrl,
    applicationState,
    applicationLabel: getOpportunityApplicationLabel(applicationState),
    status: opportunity.status,
    provenance,
    provenanceLabel:
      provenance === 'LISTING_BRIDGED'
        ? 'Legacy YLabs listing signal'
        : 'Scraper-derived posting',
    hoursPerWeek:
      typeof opportunity.hoursPerWeek === 'number' ? opportunity.hoursPerWeek : undefined,
    payRate: opportunity.payRate || undefined,
    compensationType: opportunity.compensationType,
    eligibility: opportunity.eligibility || undefined,
    sourceUrls,
    researchEntity: {
      _id: documentId(researchEntity),
      slug: researchEntity.slug || '',
      name: researchEntity.name || '',
      displayName: researchEntity.displayName || undefined,
      kind: researchEntity.kind,
      entityType: researchEntity.entityType,
      departments: researchEntity.departments || [],
      researchAreas: researchEntity.researchAreas || [],
      school: researchEntity.school,
      websiteUrl: firstUsableResearchWebsiteUrl([
        researchEntity.websiteUrl,
        researchEntity.website,
        researchEntity.sourceUrls,
      ]) || undefined,
      shortDescription: researchEntity.shortDescription,
    },
    pathway: {
      _id: documentId(pathway),
      pathwayType: pathway.pathwayType,
      status: pathway.status,
      evidenceStrength: pathway.evidenceStrength,
      studentFacingLabel: pathway.studentFacingLabel,
      explanation: pathway.explanation,
      bestNextStep: pathway.bestNextStep,
      compensation: pathway.compensation,
      confidence: pathway.confidence,
      sourceUrls: publicSourceUrls(compactStrings([pathway.sourceUrls || []])),
    },
    evidence: evidence.map((item: any) => ({
      _id: documentId(item),
      sourceName: item.sourceName,
      sourceUrl: publicSourceUrl(item.sourceUrl),
      field: item.field,
      excerpt: evidenceExcerpt(item.value),
      confidence: item.confidence,
      observedAt: item.observedAt,
    })),
    createdAt: opportunity.createdAt,
    updatedAt: opportunity.updatedAt,
  };
}
