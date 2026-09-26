import { ResearchEntity } from '../models/researchEntity';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  type ResearchEntityPublicDescriptionRepresentation,
} from './researchEntityPublicDescription';
import { getResearchEntityRosterByEntityId } from './researchEntityMembershipAccessor';
import { LEAD_ROLE_LEGACY_LABELS } from '../models/canonicalRoleMapping';

export const PUBLIC_DESCRIPTION_AUDIT_VERSION = 'public-description-v1';

export interface PublicDescriptionAuditSample {
  recordId: string;
  slug: string;
  name: string;
  descriptionSource?: string;
  leadMemberNames: string[];
  reasons: ResearchEntityPublicDescriptionRepresentation['invariant']['reasons'];
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

export const PUBLIC_DESCRIPTION_AUDIT_ENTITY_CHUNK_SIZE = 250;

export const STUDENT_READY_PUBLIC_DESCRIPTION_AUDIT_FILTER = {
  archived: { $ne: true },
  studentVisibilityTier: 'student_ready',
} as const;

type PublicDescriptionViolation = PublicDescriptionAuditSample & { sortName: string };

function publicDescriptionViolations(
  entities: Array<Record<string, any>>,
  leadMembersByEntityId: Map<string, Array<Record<string, any>>>,
): PublicDescriptionViolation[] {
  return entities.flatMap((entity) => {
    const recordId = id(entity._id);
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity,
      leadMembers: leadMembersByEntityId.get(recordId) || [],
    });
    if (representation.invariant.pass) return [];
    return [
      {
        sortName: String(entity.name ?? ''),
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
      },
    ];
  });
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function byNameThenRecordId(left: PublicDescriptionViolation, right: PublicDescriptionViolation) {
  return (
    compareCodeUnits(left.sortName, right.sortName) ||
    compareCodeUnits(left.recordId, right.recordId)
  );
}

function publicDescriptionAuditReportFrom({
  scanned,
  violations,
  includeSamples,
  sampleLimit,
}: {
  scanned: number;
  violations: PublicDescriptionViolation[];
  includeSamples: boolean;
  sampleLimit: number;
}): PublicDescriptionAuditReport {
  const report: PublicDescriptionAuditReport = {
    contractVersion: PUBLIC_DESCRIPTION_AUDIT_VERSION,
    pass: violations.length === 0,
    counts: {
      scanned,
      violations: violations.length,
      missingPublicFullDescription: violations.filter((row) =>
        row.reasons.includes('missing_public_full_description'),
      ).length,
      missingPublicCardDescription: violations.filter((row) =>
        row.reasons.includes('missing_public_card_description'),
      ).length,
    },
  };
  if (includeSamples) {
    report.samples = [...violations]
      .sort(byNameThenRecordId)
      .slice(0, Math.max(0, sampleLimit))
      .map(({ sortName: _sortName, ...sample }) => sample);
  }
  return report;
}

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
  return publicDescriptionAuditReportFrom({
    scanned: entities.length,
    violations: publicDescriptionViolations(entities, leadMembersByEntityId),
    includeSamples,
    sampleLimit,
  });
}

async function* studentReadyEntityChunks(): AsyncGenerator<Array<Record<string, any>>> {
  // Deliberately unprojected. This audit exists to reproduce the live serve
  // verdict, and the gate fails closed on any field it cannot see, so a
  // `.select()` here silently inflates the violation count instead of erroring:
  // omitting `researchAreas` alone reported 307 violations where the real serve
  // path has 32, because card derivation and quality assessment both behave as
  // if the entity had no research areas. Reading whole documents makes the
  // instrument structurally incapable of drifting from the surfaces it audits.
  // Unsorted and streamed: whole student_ready documents passed Mongo's 32 MB
  // in-memory sort limit on Development, so ordering happens in process.
  const cursor = ResearchEntity.find(STUDENT_READY_PUBLIC_DESCRIPTION_AUDIT_FILTER)
    .lean()
    .cursor({ batchSize: PUBLIC_DESCRIPTION_AUDIT_ENTITY_CHUNK_SIZE });
  let chunk: Array<Record<string, any>> = [];
  for await (const entity of cursor) {
    chunk.push(entity as Record<string, any>);
    if (chunk.length >= PUBLIC_DESCRIPTION_AUDIT_ENTITY_CHUNK_SIZE) {
      yield chunk;
      chunk = [];
    }
  }
  if (chunk.length > 0) yield chunk;
}

async function leadMembersByEntityIdFor(
  entities: Array<Record<string, any>>,
): Promise<Map<string, Array<Record<string, any>>>> {
  const rosterByEntityId = await getResearchEntityRosterByEntityId(
    entities.map((entity) => entity._id),
  );
  const leadMembersByEntityId = new Map<string, Array<Record<string, any>>>();
  for (const [entityId, entries] of rosterByEntityId.entries()) {
    const leadMembers = entries
      .filter((entry) => entry.state !== 'HISTORICAL' && LEAD_ROLE_LEGACY_LABELS.has(entry.role))
      .map((entry) => ({
        researchEntityId: entry.researchEntityId,
        personId: entry.personId,
        role: entry.role,
        name: entry.name,
        netid: entry.netid,
      }));
    if (leadMembers.length > 0) leadMembersByEntityId.set(entityId, leadMembers);
  }
  return leadMembersByEntityId;
}

export async function auditStudentReadyPublicDescriptions({
  includeSamples = false,
  sampleLimit = 25,
}: {
  includeSamples?: boolean;
  sampleLimit?: number;
} = {}): Promise<PublicDescriptionAuditReport> {
  let scanned = 0;
  const violations: PublicDescriptionViolation[] = [];
  for await (const entities of studentReadyEntityChunks()) {
    scanned += entities.length;
    violations.push(
      ...publicDescriptionViolations(entities, await leadMembersByEntityIdFor(entities)),
    );
  }
  return publicDescriptionAuditReportFrom({ scanned, violations, includeSamples, sampleLimit });
}
