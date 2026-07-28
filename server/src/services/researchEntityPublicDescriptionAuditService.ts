import { FacultyMember } from '../models/facultyMember';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { serializedDocumentId } from '../utils/idSerialization';
import { buildResearchEntityPublicDescriptionRepresentation } from './researchEntityPublicDescription';

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
      '_id slug name displayName kind entityType website websiteUrl sourceUrls description shortDescription fullDescription profileSynthesisDescription descriptionSource',
    )
    .sort({ name: 1 })
    .lean();
  const entityIds = (entities as any[]).map((entity) => entity._id);
  const leadRows = entityIds.length
    ? await ResearchGroupMember.find({
        researchEntityId: { $in: entityIds },
        archived: { $ne: true },
        isCurrentMember: { $ne: false },
        role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
      })
        .select('researchEntityId userId facultyMemberId name role')
        .lean()
    : [];
  const userIds = Array.from(
    new Set((leadRows as any[]).map((row) => id(row.userId)).filter(Boolean)),
  );
  const facultyMemberIds = Array.from(
    new Set((leadRows as any[]).map((row) => id(row.facultyMemberId)).filter(Boolean)),
  );
  const [users, facultyMembers] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select('displayName name fname lname')
          .lean()
      : [],
    facultyMemberIds.length
      ? FacultyMember.find({ _id: { $in: facultyMemberIds } })
          .select('name firstName lastName')
          .lean()
      : [],
  ]);
  const usersById = new Map((users as any[]).map((user) => [id(user._id), user]));
  const facultyMembersById = new Map(
    (facultyMembers as any[]).map((facultyMember) => [id(facultyMember._id), facultyMember]),
  );
  const leadMembersByEntityId = new Map<string, Array<Record<string, any>>>();
  for (const row of leadRows as any[]) {
    const entityId = id(row.researchEntityId);
    const member = {
      ...row,
      user: usersById.get(id(row.userId)),
      facultyMember: facultyMembersById.get(id(row.facultyMemberId)),
    };
    leadMembersByEntityId.set(entityId, [...(leadMembersByEntityId.get(entityId) || []), member]);
  }

  return buildPublicDescriptionAuditReport({
    entities: entities as any[],
    leadMembersByEntityId,
    includeSamples,
    sampleLimit,
  });
}
