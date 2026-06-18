import { assessResearchEntityDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { Listing } from '../models/listing';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { serializedDocumentId } from '../utils/idSerialization';

export type EvidenceCoverageTier = 'thin' | 'partial' | 'ready_candidate';
export type EvidenceClaimState = 'missing' | 'weak' | 'supported';

export type EvidenceCoverageBlocker =
  | 'missing_source_backed_description'
  | 'wrong_evidence_type_description'
  | 'missing_verified_lead'
  | 'missing_access_evidence'
  | 'missing_action_route'
  | 'listing_only_profile';

export type SuggestedSourceType =
  | 'official-profile-page'
  | 'official-lab-homepage'
  | 'department-undergrad-research'
  | 'listing-refresh';

export interface EvidenceCoverageInput {
  entity: Record<string, any>;
  listings?: Array<Record<string, any>>;
  members?: Array<Record<string, any>>;
  accessSignals?: Array<Record<string, any>>;
  contactRoutes?: Array<Record<string, any>>;
  observations?: Array<Record<string, any>>;
}

export interface EvidenceCoverageAssessment {
  coverageTier: EvidenceCoverageTier;
  claimStates: {
    identity: EvidenceClaimState;
    description: EvidenceClaimState;
    lead: EvidenceClaimState;
    access: EvidenceClaimState;
    action: EvidenceClaimState;
    freshness: EvidenceClaimState;
  };
  blockers: EvidenceCoverageBlocker[];
  suggestedSourceTypes: SuggestedSourceType[];
  rejectedFields: Array<{ field: string; reason: string; sourceName?: string }>;
  publicSummary: string;
}

export interface EvidenceCoverageSummary {
  total: number;
  tierCounts: Record<EvidenceCoverageTier, number>;
  blockerCounts: Partial<Record<EvidenceCoverageBlocker, number>>;
  suggestedSourceTypeCounts: Partial<Record<SuggestedSourceType, number>>;
}

export interface EvidenceCoverageImpactInput {
  entityType: string;
  entityId?: string;
  entityKey?: string;
  before: EvidenceCoverageInput;
  observations: Array<Record<string, any>>;
}

export interface EvidenceCoverageImpactRow {
  entityType: string;
  entityId?: string;
  entityKey?: string;
  beforeCoverageTier: EvidenceCoverageTier;
  afterCoverageTier: EvidenceCoverageTier;
  resolvedBlockers: EvidenceCoverageBlocker[];
  remainingBlockers: EvidenceCoverageBlocker[];
  rejectedFields: Array<{ field: string; reason: string; sourceName?: string }>;
}

export interface EvidenceCoverageImpactReport {
  assessed: number;
  improved: number;
  rows: EvidenceCoverageImpactRow[];
}

export interface EvidenceCoverageImpactDeps {
  loadResearchEntityContext: (
    identifier: { entityId?: string; entityKey?: string },
  ) => Promise<EvidenceCoverageInput | null>;
}

const LISTING_SOURCE_NAMES = new Set(['ylabs-listing', 'listing', 'legacy-listing']);

const evidenceCoverageDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

const evidenceCoverageKeyText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const unique = <T extends string>(values: T[]): T[] => Array.from(new Set(values));

const hasHttpUrl = (value: unknown): boolean => /^https?:\/\//i.test(textValue(value));

const rowHasHttpUrl = (row: Record<string, any>): boolean =>
  [row.url, row.websiteUrl, row.website, row.sourceUrl, ...(Array.isArray(row.websites) ? row.websites : [])].some(
    hasHttpUrl,
  );

const hasEntitySourceUrl = (entity: Record<string, any>): boolean =>
  [entity.websiteUrl, entity.website, ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [])].some(
    hasHttpUrl,
  );

const isListingObservation = (observation: Record<string, any>): boolean =>
  LISTING_SOURCE_NAMES.has(textValue(observation.sourceName));

const nonListingObservations = (observations: Array<Record<string, any>>) =>
  observations.filter((observation) => !isListingObservation(observation));

const hasUsefulLead = (members: Array<Record<string, any>>): boolean =>
  members.some((member) =>
    Boolean(
      member.userId ||
        member.facultyMemberId ||
        member.user?._id ||
        textValue(member.name) ||
        textValue(member.user?.netid),
    ),
  );

const looksLikePublicationBlurb = (value: unknown): boolean => {
  const text = textValue(value);
  return (
    /\b(this|the)\s+(book|article|chapter|essay)\b/i.test(text) ||
    /\b(book|article|chapter|essay)\s+(explores|examines|argues|provides|introduces)\b/i.test(text)
  );
};

const descriptionObservationSources = (observations: Array<Record<string, any>>) =>
  observations.filter((observation) =>
    ['description', 'shortDescription', 'fullDescription', 'profileSynthesisDescription'].includes(
      textValue(observation.field),
    ),
  );

function descriptionState(
  entity: Record<string, any>,
  observations: Array<Record<string, any>>,
): {
  state: EvidenceClaimState;
  rejectedFields: EvidenceCoverageAssessment['rejectedFields'];
  sourceBacked: boolean;
} {
  const rejectedFields = descriptionObservationSources(observations)
    .filter((observation) => looksLikePublicationBlurb(observation.value || entity.description))
    .map((observation) => ({
      field: textValue(observation.field) || 'description',
      reason: 'publication_or_book_blurb',
      sourceName: textValue(observation.sourceName) || undefined,
    }));

  if (rejectedFields.length > 0) {
    return { state: 'weak', rejectedFields, sourceBacked: false };
  }

  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: entity.fullDescription,
    shortDescription: entity.shortDescription,
    sourceUrls: entity.sourceUrls,
    website: entity.website,
    websiteUrl: entity.websiteUrl,
  });
  const usefulDescription = quality.full.isUseful || quality.short.isUseful || textValue(entity.description).length >= 80;
  const sources = descriptionObservationSources(observations);
  const hasNonListingDescriptionObservation = sources.some((observation) => !isListingObservation(observation));
  const sourceBacked = usefulDescription && (hasNonListingDescriptionObservation || (sources.length === 0 && hasEntitySourceUrl(entity)));

  if (sourceBacked) return { state: 'supported', rejectedFields, sourceBacked: true };
  if (usefulDescription) return { state: 'weak', rejectedFields, sourceBacked: false };
  return { state: 'missing', rejectedFields, sourceBacked: false };
}

export function assessResearchEntityEvidenceCoverage(
  input: EvidenceCoverageInput,
): EvidenceCoverageAssessment {
  const entity = input.entity || {};
  const listings = input.listings || [];
  const members = input.members || [];
  const accessSignals = input.accessSignals || [];
  const contactRoutes = input.contactRoutes || [];
  const observations = input.observations || [];
  const nonListingSourceCount = new Set(nonListingObservations(observations).map((row) => textValue(row.sourceName))).size;
  const listingOnlyProfile = listings.length > 0 && nonListingSourceCount === 0;
  const description = descriptionState(entity, observations);
  const hasLead = hasUsefulLead(members);
  const hasContactRoute = contactRoutes.some(rowHasHttpUrl);
  const hasAccess = accessSignals.length > 0;
  const hasAction = hasContactRoute || listings.some(rowHasHttpUrl) || accessSignals.some((signal) => textValue(signal.bestNextStep));
  const blockers: EvidenceCoverageBlocker[] = [];
  const suggestedSourceTypes: SuggestedSourceType[] = [];

  if (description.state !== 'supported') {
    blockers.push(
      description.rejectedFields.length > 0
        ? 'wrong_evidence_type_description'
        : 'missing_source_backed_description',
    );
    suggestedSourceTypes.push('official-profile-page', 'official-lab-homepage');
  }
  if (!hasLead && !hasContactRoute) {
    blockers.push('missing_verified_lead');
    suggestedSourceTypes.push('official-profile-page', 'official-lab-homepage');
  }
  if (!hasAccess) {
    blockers.push('missing_access_evidence');
    suggestedSourceTypes.push('department-undergrad-research', 'listing-refresh');
  }
  if (!hasAction) {
    blockers.push('missing_action_route');
    suggestedSourceTypes.push('department-undergrad-research', 'listing-refresh');
  }
  if (listingOnlyProfile) {
    blockers.push('listing_only_profile');
    suggestedSourceTypes.push('official-profile-page', 'official-lab-homepage');
  }

  const claimStates = {
    identity: hasEntitySourceUrl(entity) || listings.length > 0 ? 'supported' : 'weak',
    description: description.state,
    lead: hasLead || hasContactRoute ? 'supported' : 'missing',
    access: hasAccess ? 'supported' : 'missing',
    action: hasAction ? 'supported' : 'missing',
    freshness: observations.length > 0 || listings.length > 0 ? 'supported' : 'weak',
  } satisfies EvidenceCoverageAssessment['claimStates'];

  let coverageTier: EvidenceCoverageTier = 'ready_candidate';
  if (
    blockers.includes('missing_source_backed_description') ||
    blockers.includes('wrong_evidence_type_description') ||
    blockers.includes('missing_verified_lead') ||
    blockers.includes('listing_only_profile')
  ) {
    coverageTier = 'thin';
  } else if (blockers.length > 0) {
    coverageTier = 'partial';
  }

  return {
    coverageTier,
    claimStates,
    blockers: unique(blockers),
    suggestedSourceTypes: unique(suggestedSourceTypes),
    rejectedFields: description.rejectedFields,
    publicSummary:
      blockers.length === 0
        ? 'Ready candidate with source-backed description, lead/action, and access evidence.'
        : `Needs repair: ${unique(blockers).join(', ')}`,
  };
}

export function summarizeEvidenceCoverage(
  assessments: EvidenceCoverageAssessment[],
): EvidenceCoverageSummary {
  const summary: EvidenceCoverageSummary = {
    total: assessments.length,
    tierCounts: { thin: 0, partial: 0, ready_candidate: 0 },
    blockerCounts: {},
    suggestedSourceTypeCounts: {},
  };

  for (const assessment of assessments) {
    summary.tierCounts[assessment.coverageTier] += 1;
    for (const blocker of assessment.blockers) {
      summary.blockerCounts[blocker] = (summary.blockerCounts[blocker] || 0) + 1;
    }
    for (const sourceType of assessment.suggestedSourceTypes) {
      summary.suggestedSourceTypeCounts[sourceType] =
        (summary.suggestedSourceTypeCounts[sourceType] || 0) + 1;
    }
  }

  return summary;
}

function overlayObservation(
  next: EvidenceCoverageInput,
  observation: Record<string, any>,
): EvidenceCoverageInput {
  const field = textValue(observation.field);
  const value = observation.value;
  const entity = { ...(next.entity || {}) };
  const observations = [...(next.observations || []), observation];
  const members = [...(next.members || [])];
  const accessSignals = [...(next.accessSignals || [])];
  const contactRoutes = [...(next.contactRoutes || [])];

  if (['description', 'shortDescription', 'fullDescription', 'profileSynthesisDescription'].includes(field)) {
    entity[field] = value;
  }
  if (field === 'sourceUrls') {
    entity.sourceUrls = unique([
      ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
      ...(Array.isArray(value) ? value : [value]).map(textValue).filter(Boolean),
    ]);
  }
  if (field === 'websiteUrl' || field === 'website') {
    entity[field] = value;
  }
  if (field === 'inferredPiUserId' || field === 'piUserId') {
    members.push({ role: 'pi', userId: value, sourceUrl: observation.sourceUrl });
  }
  if (field === 'undergradAccessEvidence' || field === 'accessSignal') {
    accessSignals.push({
      signalType: 'UNDERGRAD_PARTICIPATION',
      sourceUrl: observation.sourceUrl,
      evidence: value,
    });
  }
  if (field === 'contactRoute' || field === 'applicationUrl' || field === 'bestNextStep') {
    contactRoutes.push({
      routeType: field === 'applicationUrl' ? 'APPLICATION' : 'OFFICIAL_PAGE',
      url: field === 'applicationUrl' ? value : observation.sourceUrl,
      label: value,
    });
  }

  return { ...next, entity, observations, members, accessSignals, contactRoutes };
}

export function buildEvidenceCoverageImpact(
  input: EvidenceCoverageImpactInput,
): EvidenceCoverageImpactRow {
  const before = assessResearchEntityEvidenceCoverage(input.before);
  const afterInput = input.observations.reduce<EvidenceCoverageInput>(
    (next, observation) => overlayObservation(next, observation),
    {
      entity: { ...(input.before.entity || {}) },
      listings: [...(input.before.listings || [])],
      members: [...(input.before.members || [])],
      accessSignals: [...(input.before.accessSignals || [])],
      contactRoutes: [...(input.before.contactRoutes || [])],
      observations: [...(input.before.observations || [])],
    } satisfies EvidenceCoverageInput,
  );
  const after = assessResearchEntityEvidenceCoverage(afterInput);
  const afterBlockers = new Set(after.blockers);

  return {
    entityType: input.entityType,
    entityId: input.entityId,
    entityKey: input.entityKey,
    beforeCoverageTier: before.coverageTier,
    afterCoverageTier: after.coverageTier,
    resolvedBlockers: before.blockers.filter((blocker) => !afterBlockers.has(blocker)),
    remainingBlockers: after.blockers,
    rejectedFields: after.rejectedFields,
  };
}

const entityIdentifierKey = (observation: Record<string, any>): string | null => {
  const entityId = evidenceCoverageDocumentId(observation.entityId);
  if (entityId) return `id:${entityId}`;
  const entityKey = evidenceCoverageKeyText(observation.entityKey);
  if (entityKey) return `key:${entityKey}`;
  return null;
};

async function loadResearchEntityContext({
  entityId,
  entityKey,
}: {
  entityId?: string;
  entityKey?: string;
}): Promise<EvidenceCoverageInput | null> {
  const entity = await ResearchEntity.findOne({
    ...(entityId ? { _id: entityId } : { slug: entityKey }),
    archived: { $ne: true },
  }).lean();
  if (!entity) return null;
  const id = evidenceCoverageDocumentId((entity as any)._id);
  if (!id) return null;
  const [listings, members, accessSignals, contactRoutes, observations] = await Promise.all([
    Listing.find({ researchEntityId: id, archived: { $ne: true } }).lean(),
    ResearchGroupMember.find({ researchEntityId: id, isCurrentMember: { $ne: false } }).lean(),
    AccessSignal.find({ researchEntityId: id, archived: { $ne: true } }).lean(),
    ContactRoute.find({ researchEntityId: id, archived: { $ne: true } }).lean(),
    Observation.find({
      entityType: 'researchEntity',
      superseded: { $ne: true },
      $or: [{ entityId: id }, ...(entityKey ? [{ entityKey }] : [])],
    })
      .select('sourceName field value sourceUrl observedAt confidence')
      .sort({ observedAt: -1 })
      .limit(80)
      .lean(),
  ]);

  return { entity, listings, members, accessSignals, contactRoutes, observations };
}

export async function buildEvidenceCoverageImpactReportForObservations(
  observations: Array<Record<string, any>>,
  deps: EvidenceCoverageImpactDeps = { loadResearchEntityContext },
): Promise<EvidenceCoverageImpactReport> {
  const groups = new Map<string, Array<Record<string, any>>>();
  for (const observation of observations) {
    if (observation.entityType !== 'researchEntity') continue;
    const key = entityIdentifierKey(observation);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(observation);
    groups.set(key, list);
  }

  const rows: EvidenceCoverageImpactRow[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const entityId = evidenceCoverageDocumentId(first.entityId) || undefined;
    const entityKey = evidenceCoverageKeyText(first.entityKey) || undefined;
    const before = await deps.loadResearchEntityContext({ entityId, entityKey });
    if (!before) continue;
    rows.push(
      buildEvidenceCoverageImpact({
        entityType: 'researchEntity',
        entityId,
        entityKey,
        before,
        observations: group,
      }),
    );
  }

  return {
    assessed: rows.length,
    improved: rows.filter((row) => row.resolvedBlockers.length > 0).length,
    rows,
  };
}
