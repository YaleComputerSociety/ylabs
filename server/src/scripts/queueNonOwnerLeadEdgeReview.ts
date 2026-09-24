import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { cannotOwnResearchHome } from '../utils/researchHomeOwnership';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  NON_OWNER_LEAD_RETIREMENT_NOTE_PATTERN,
  planNonOwnerLeadEdgeReviewQueue,
  summarizeNonOwnerLeadEdgeQueueExclusions,
  type NonOwnerLeadEdgeCandidate,
} from './queueNonOwnerLeadEdgeReviewCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:queue-non-owner-lead-edge-review';

export function parseQueueArgs(argv: string[]): { output?: string } {
  const options: { output?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

async function main(): Promise<void> {
  const options = parseQueueArgs(process.argv.slice(2));
  await initializeConnections();

  const retired = (await RoleAssignment.find({
    reviewNotes: NON_OWNER_LEAD_RETIREMENT_NOTE_PATTERN,
  })
    .select('_id personId target role reviewNotes rosterProvenance')
    .lean()) as unknown as Array<Record<string, unknown>>;

  const observations = (await Observation.find({})
    .select('entityKey sourceName sourceUrl')
    .lean()) as unknown as Array<Record<string, unknown>>;

  const personIds = [
    ...new Set(retired.map((doc) => serializedDocumentId(doc.personId)).filter(Boolean)),
  ] as string[];
  const people = (await Researcher.find({
    _id: {
      $in: personIds
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    },
  })
    .select('_id profile.title')
    .lean()) as unknown as Array<Record<string, any>>;
  const titleByPersonId = new Map<string, string>();
  for (const person of people) {
    const id = serializedDocumentId(person._id);
    if (id) titleByPersonId.set(id, String(person?.profile?.title || ''));
  }

  const entityIds = [
    ...new Set(
      retired
        .map((doc) => String((doc.target as Record<string, unknown>)?.id ?? ''))
        .filter(Boolean),
    ),
  ];
  const entityDocs = (await ResearchEntity.find({
    _id: {
      $in: entityIds
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    },
  })
    .select('_id slug studentVisibilityTier archived entityType')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const entityById = new Map<string, Record<string, unknown>>();
  for (const doc of entityDocs) {
    const id = serializedDocumentId(doc._id);
    if (id) entityById.set(id, doc);
  }

  // The canonical owner set, never the served labels and never a literal: the two
  // vocabularies are disjoint, so asking this question with the wrong one counts 0
  // and reads exactly like "no entity holds a lead" (#3204).
  const liveLeadDocs = (await RoleAssignment.find({
    role: { $in: LEAD_ROLE_CANONICAL_VALUES as unknown as string[] },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('target')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const entitiesHoldingALiveLead = new Set(
    liveLeadDocs
      .map((doc) => String((doc.target as Record<string, unknown>)?.id ?? ''))
      .filter(Boolean),
  );

  const candidates: NonOwnerLeadEdgeCandidate[] = retired.flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    const personId = serializedDocumentId(doc.personId);
    const entityId = String((doc.target as Record<string, unknown>)?.id ?? '');
    if (!id || !personId || !entityId) return [];
    const entity = entityById.get(entityId);
    const provenance = (doc.rosterProvenance || {}) as Record<string, unknown>;
    return [
      {
        edgeId: id,
        personId,
        entityId,
        entityKey: text(entity?.slug),
        role: String(doc.role),
        citingUrl: text(provenance.sourceUrl),
        storedTitle: titleByPersonId.get(personId) ?? '',
        entityArchived: entity?.archived === true,
        entityTier: text(entity?.studentVisibilityTier),
        entityHoldsALiveLead: entitiesHoldingALiveLead.has(entityId),
      },
    ];
  });

  const plan = planNonOwnerLeadEdgeReviewQueue(candidates, observations, cannotOwnResearchHome);

  // What each row serves today, so a reviewer decides against the surface rather than
  // against the edge. Refusing or restoring a graft can drop or add a row's only edge,
  // so "what changes for a student" is the question, not "is the edge present".
  const servedByEntityKey: Record<string, unknown> = {};
  for (const key of [...new Set(plan.queue.map((row) => row.entityKey).filter(Boolean))]) {
    let detail: Awaited<ReturnType<typeof getResearchGroupDetail>> | null = null;
    try {
      detail = await getResearchGroupDetail(key);
    } catch {
      detail = null;
    }
    const entity = (detail?.researchEntity ?? {}) as Record<string, unknown>;
    servedByEntityKey[key] = {
      resolved: Boolean(detail),
      name: text(entity.name) ? 'present' : 'absent',
      shortDescription: text(entity.shortDescription) ? 'present' : 'absent',
      websiteUrl: text(entity.websiteUrl) ? 'present' : 'absent',
      departments: Array.isArray(entity.departments) ? entity.departments.length : 0,
      leadProfessorPublicKey: text(entity.leadProfessorPublicKey) ? 'present' : 'absent',
      members: Array.isArray(detail?.members) ? detail.members.length : 0,
    };
  }

  const report = {
    script: SCRIPT_NAME,
    mode: 'report-only',
    retiredByThisLane: retired.length,
    queued: plan.queue.length,
    excludedByReason: summarizeNonOwnerLeadEdgeQueueExclusions(plan.excluded),
    queuedEntityRows: {
      archived: plan.queue.filter((row) => row.entityArchived).length,
      liveStudentReady: plan.queue.filter(
        (row) => !row.entityArchived && row.entityTier === 'student_ready',
      ).length,
      liveOtherTier: plan.queue.filter(
        (row) => !row.entityArchived && row.entityTier !== 'student_ready',
      ).length,
      alreadyHoldingALiveLead: plan.queue.filter((row) => row.entityHoldsALiveLead).length,
      wouldGainTheirOnlyLead: plan.queue.filter(
        (row) => !row.entityHoldsALiveLead && !row.entityArchived,
      ).length,
    },
    recoveredLaneHistogram: plan.queue.reduce((acc: Record<string, number>, row) => {
      acc[row.recoveredLane] = (acc[row.recoveredLane] || 0) + 1;
      return acc;
    }, {}),
    servedByEntityKey,
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(
      options.output,
      `${JSON.stringify({ ...report, queue: plan.queue }, null, 2)}\n`,
    );
    console.log(`\nQueue written to ${options.output} (${plan.queue.length} rows to review)`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
