import { ResearchEntity } from '../models/researchEntity';
import { serializedDocumentId } from '../utils/idSerialization';
import { buildResearchEntityPublicDescriptionRepresentation } from './researchEntityPublicDescription';
import { getResearchEntityRosterByEntityId } from './researchEntityMembershipAccessor';

const LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

export const PUBLIC_DESCRIPTION_AUDIT_VERSION = 'public-description-v1';

export interface PublicDescriptionAuditSample {
  recordId: string;
  slug: string;
  name: string;
  descriptionSource?: string;
  leadMemberNames: string[];
  reasons: Array<'missing_public_full_description' | 'missing_public_card_description'>;
  fullDescriptionFlags: string[];
  cardDescriptionFlags: string[];
}

export interface PublicDescriptionAuditReport {
  contractVersion: string;
  pass: boolean;
  counts: {
    scanned: number;
    violations: number;
    missingPublicFullDescription: number;
    missingPublicCardDescription: number;
  };
  samples?: PublicDescriptionAuditSample[];
}

const id = (value: unknown): string => serializedDocumentId(value) || '';

export function buildPublicDescriptionAuditReport({
  entities,
  leadMembersByEntityId,
  includeSamples = false,
  sampleLimit = 25,
}: {
  entities: Array<Record<string, any>>;
  leadMembersByEntityId: Map<string, Array<Record<string, any>>>;
  includeSamples?: boolean;
  sampleLimit?: number;
}): PublicDescriptionAuditReport {
  const violatingRows = entities.flatMap((entity) => {
    const recordId = id(entity._id);
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity,
      leadMembers: leadMembersByEntityId.get(recordId) || [],
    });
    if (representation.invariant.pass) return [];
    return [
      {
        recordId,
        slug: String(entity.slug || ''),
        name: String(entity.displayName || entity.name || entity.slug || recordId),
        ...(entity.descriptionSource
          ? { descriptionSource: String(entity.descriptionSource) }
          : {}),
        leadMemberNames: representation.leadMemberNames,
        reasons: representation.invariant.reasons,
        fullDescriptionFlags: representation.quality.full.flags,
        cardDescriptionFlags: representation.quality.short.flags,
      } satisfies PublicDescriptionAuditSample,
    ];
  });

  const report: PublicDescriptionAuditReport = {
    contractVersion: PUBLIC_DESCRIPTION_AUDIT_VERSION,
    pass: violatingRows.length === 0,
    counts: {
      scanned: entities.length,
      violations: violatingRows.length,
      missingPublicFullDescription: violatingRows.filter((row) =>
        row.reasons.includes('missing_public_full_description'),
      ).length,
      missingPublicCardDescription: violatingRows.filter((row) =>
        row.reasons.includes('missing_public_card_description'),
      ).length,
    },
  };
  if (includeSamples) report.samples = violatingRows.slice(0, Math.max(0, sampleLimit));
  return report;
}

export async function auditStudentReadyPublicDescriptions({
  includeSamples = false,
  sampleLimit = 25,
}: {
  includeSamples?: boolean;
  sampleLimit?: number;
} = {}): Promise<PublicDescriptionAuditReport> {
  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
  })
    .select(
      '_id slug name displayName kind entityType website websiteUrl sourceUrls shortDescription fullDescription profileSynthesisDescription descriptionSource',
    )
    .sort({ name: 1 })
    .lean();
  const entityIds = (entities as any[]).map((entity) => entity._id);
  const rosterByEntityId = await getResearchEntityRosterByEntityId(entityIds);
  const leadMembersByEntityId = new Map<string, Array<Record<string, any>>>();
  for (const [entityId, entries] of rosterByEntityId.entries()) {
    const leadMembers = entries
      .filter((entry) => entry.state !== 'HISTORICAL' && LEAD_ROLES.has(entry.role))
      .map((entry) => ({
        researchEntityId: entry.researchEntityId,
        personId: entry.personId,
        role: entry.role,
        name: entry.name,
        netid: entry.netid,
      }));
    if (leadMembers.length > 0) leadMembersByEntityId.set(entityId, leadMembers);
  }

  return buildPublicDescriptionAuditReport({
    entities: entities as any[],
    leadMembersByEntityId,
    includeSamples,
    sampleLimit,
  });
}
