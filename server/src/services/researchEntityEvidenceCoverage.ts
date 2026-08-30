import { assessResearchEntityDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { serializedDocumentId } from '../utils/idSerialization';
import { getResearchEntityRoster } from './researchEntityMembershipAccessor';

export type EvidenceCoverageTier = 'thin' | 'partial' | 'ready_candidate';
export type EvidenceClaimState = 'missing' | 'weak' | 'supported';

export type EvidenceCoverageBlocker =
  | 'missing_source_backed_description'
  | 'wrong_evidence_type_description'
  | 'missing_verified_lead'
  | 'missing_access_evidence'
  | 'missing_action_route';

export type SuggestedSourceType =
  | 'official-profile-page'
  | 'official-lab-homepage'
  | 'department-undergrad-research';

export interface EvidenceCoverageInput {
  entity: Record<string, any>;
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
  loadResearchEntityContext: (identifier: {
    entityId?: string;
    entityKey?: string;
  }) => Promise<EvidenceCoverageInput | null>;
}

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
  [
    row.url,
    row.websiteUrl,
    row.website,
    row.sourceUrl,
    ...(Array.isArray(row.websites) ? row.websites : []),
  ].some(hasHttpUrl);

const hasEntitySourceUrl = (entity: Record<string, any>): boolean =>
  [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ].some(hasHttpUrl);

const hasUsefulLead = (members: Array<Record<string, any>>): boolean =>
  members.some((member) =>
    Boolean(
      textValue(member.name) ||
      textValue(member.netid) ||
      member.personId ||
      member.userId ||
      member.user?._id ||
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
    ['shortDescription', 'fullDescription', 'profileSynthesisDescription'].includes(
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
    .filter((observation) => looksLikePublicationBlurb(observation.value))
    .map((observation) => ({
      field: textValue(observation.field) || 'fullDescription',
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
  const usefulDescription = quality.full.isUseful || quality.short.isUseful;
  const sources = descriptionObservationSources(observations);
  const sourceBacked = usefulDescription && (sources.length > 0 || hasEntitySourceUrl(entity));

  if (sourceBacked) return { state: 'supported', rejectedFields, sourceBacked: true };
  if (usefulDescription) return { state: 'weak', rejectedFields, sourceBacked: false };
  return { state: 'missing', rejectedFields, sourceBacked: false };
}

export function assessResearchEntityEvidenceCoverage(
  input: EvidenceCoverageInput,
): EvidenceCoverageAssessment {
  const entity = input.entity || {};
  const members = input.members || [];
  const accessSignals = input.accessSignals || [];
  const contactRoutes = input.contactRoutes || [];
  const observations = input.observations || [];
  const description = descriptionState(entity, observations);
  const hasLead = hasUsefulLead(members);
  const hasContactRoute = contactRoutes.some(rowHasHttpUrl);
  const hasAccess = accessSignals.length > 0;
  const hasAction =
    hasContactRoute || accessSignals.some((signal) => textValue(signal.bestNextStep));
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
    suggestedSourceTypes.push('department-undergrad-research');
  }
  if (!hasAction) {
    blockers.push('missing_action_route');
    suggestedSourceTypes.push('department-undergrad-research');
  }
  const claimStates = {
    identity: hasEntitySourceUrl(entity) ? 'supported' : 'weak',
    description: description.state,
    lead: hasLead || hasContactRoute ? 'supported' : 'missing',
    access: hasAccess ? 'supported' : 'missing',
    action: hasAction ? 'supported' : 'missing',
    freshness: observations.length > 0 ? 'supported' : 'weak',
  } satisfies EvidenceCoverageAssessment['claimStates'];

  let coverageTier: EvidenceCoverageTier = 'ready_candidate';
  if (
    blockers.includes('missing_source_backed_description') ||
    blockers.includes('wrong_evidence_type_description') ||
    blockers.includes('missing_verified_lead')
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

  if (['shortDescription', 'fullDescription', 'profileSynthesisDescription'].includes(field)) {
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
  const [roster, accessSignals, observations] = await Promise.all([
    getResearchEntityRoster(id),
    Signal.find({
      researchEntityId: id,
      type: { $in: accessSignalTypes },
      archived: { $ne: true },
    }).lean(),
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

  const members = roster
    .filter((entry) => entry.state !== 'HISTORICAL')
    .map((entry) => ({
      name: entry.name,
      role: entry.role,
      netid: entry.netid,
      personId: entry.personId,
    }));

  return { entity, members, accessSignals, contactRoutes: [], observations };
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
