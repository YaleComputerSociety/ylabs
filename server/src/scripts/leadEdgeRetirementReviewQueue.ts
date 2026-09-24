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
import { isNonResearchStaffTitle } from '../utils/nonResearchStaffTitle';
import { isTraineeLevelTitle } from '../utils/traineeLevelTitle';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { laneNamesByCitation, type LeadEdgeCitation } from './backfillLeadEdgeSourceNameCore';
import {
  buildLeadEdgeReviewQueue,
  summarizeLeadEdgeReviewQueue,
  type RetiredLeadEdgeInput,
  type ReviewQueueEntity,
  type ReviewQueuePerson,
} from './leadEdgeRetirementReviewQueueCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'role-assignments:lead-edge-retirement-review-queue';
const LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'];
const RETIREMENT_NOTE = 'cannot (?:host a student|own a research home)';
const LEAD_OBSERVATION_FIELDS = ['inferredPiUserId', 'inferredPiUserKey', 'leadProfessorPublicKey'];

// Read-only by construction: this script has no --apply, because the queue exists so a
// human reads each row. A bulk write is what the refusal was asking to prevent (#3260).
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outputArg = argv.find((a) => a.startsWith('--output='));
  const output = resolveSafeJsonReportOutputPath(
    outputArg
      ? outputArg.slice('--output='.length)
      : path.join('/tmp', 'ylabs-3260-review-queue.json'),
  );
  if (argv.some((a) => a === '--apply' || a.startsWith('--confirm'))) {
    throw new Error(`${SCRIPT_NAME} is read-only: it builds a queue for review and never writes.`);
  }

  await initializeConnections();

  const retired = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: LEAD_ROLES },
    archived: true,
    reviewNotes: { $regex: RETIREMENT_NOTE, $options: 'i' },
  })
    .select('_id personId target role reviewNotes rosterProvenance')
    .lean()) as unknown as Array<Record<string, any>>;

  const edges: RetiredLeadEdgeInput[] = retired.flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    const personId = serializedDocumentId(doc.personId);
    const entityId = serializedDocumentId(doc.target?.id);
    if (!id || !personId || !entityId) return [];
    return [
      {
        id,
        personId,
        entityId,
        role: String(doc.role ?? ''),
        reviewNotes: doc.reviewNotes,
        citedSourceUrl: doc.rosterProvenance?.sourceUrl,
        storedSourceName: doc.rosterProvenance?.sourceName,
      },
    ];
  });

  const entityIds = [...new Set(edges.map((e) => e.entityId))];
  const entityDocs = (await ResearchEntity.find({
    _id: { $in: entityIds.map((i) => new mongoose.Types.ObjectId(i)) },
  })
    .select('slug name studentVisibilityTier archived shortDescription researchAreas websiteUrl')
    .lean()) as unknown as Array<Record<string, any>>;

  const liveLeadCounts = new Map<string, number>();
  for (const row of (await RoleAssignment.aggregate([
    {
      $match: {
        'target.kind': 'RESEARCH_ENTITY',
        role: { $in: LEAD_ROLES },
        archived: { $ne: true },
      },
    },
    { $group: { _id: '$target.id', n: { $sum: 1 } } },
  ])) as Array<{ _id: unknown; n: number }>) {
    liveLeadCounts.set(String(row._id), row.n);
  }

  const entitiesById = new Map<string, ReviewQueueEntity>(
    entityDocs.map((d) => [
      String(d._id),
      {
        id: String(d._id),
        slug: String(d.slug ?? ''),
        name: d.name,
        tier: d.studentVisibilityTier,
        archived: d.archived === true,
        hasCard: Boolean(String(d.shortDescription ?? '').trim()),
        topicCount: Array.isArray(d.researchAreas) ? d.researchAreas.length : 0,
        hasWebsite: Boolean(String(d.websiteUrl ?? '').trim()),
        liveLeadCount: liveLeadCounts.get(String(d._id)) ?? 0,
      },
    ]),
  );

  const personDocs = (await Researcher.find({
    _id: {
      $in: [...new Set(edges.map((e) => e.personId))].map((i) => new mongoose.Types.ObjectId(i)),
    },
  })
    .select('displayName profile.title')
    .lean()) as unknown as Array<Record<string, any>>;
  const peopleById = new Map<string, ReviewQueuePerson>(
    personDocs.map((d) => [
      String(d._id),
      { id: String(d._id), displayName: d.displayName, title: d?.profile?.title },
    ]),
  );

  const citationDocs = (await Observation.find({
    entityType: 'researchEntity',
    field: { $in: LEAD_OBSERVATION_FIELDS },
  })
    .select('entityKey sourceUrl sourceName')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const lanes = laneNamesByCitation(
    citationDocs.map(
      (d): LeadEdgeCitation => ({
        entityKey: String(d.entityKey ?? ''),
        sourceUrl: String(d.sourceUrl ?? ''),
        sourceName: String(d.sourceName ?? ''),
      }),
    ),
  );

  const queue = buildLeadEdgeReviewQueue(
    edges,
    lanes,
    entitiesById,
    peopleById,
    isTraineeLevelTitle,
    isNonResearchStaffTitle,
  );
  const summary = summarizeLeadEdgeReviewQueue(queue);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        generatedAt: new Date().toISOString(),
        retiredEdgesScanned: edges.length,
        summary,
        rows: queue.rows,
      },
      null,
      2,
    ),
  );

  // Aggregates only on stdout. The per-row detail a reviewer needs pairs a person with a
  // defect judgement, which must not reach a public issue or pull request body, so it stays
  // in the artifact.
  console.log(
    JSON.stringify({ script: SCRIPT_NAME, retiredEdgesScanned: edges.length, summary }, null, 2),
  );
  console.log(`Wrote ${queue.rows.length} rows for review to ${output}`);
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
