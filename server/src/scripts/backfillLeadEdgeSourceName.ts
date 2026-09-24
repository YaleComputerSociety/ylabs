import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  laneNamesByCitation,
  planLeadEdgeSourceNameBackfill,
  type LeadEdgeCitation,
  type LeadEdgeRow,
} from './backfillLeadEdgeSourceNameCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'role-assignments:backfill-lead-edge-source-name';
export const CONFIRM_FLAG = '--confirm-backfill-lead-edge-source-name';
const LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'];
const LEAD_OBSERVATION_FIELDS = ['inferredPiUserId', 'inferredPiUserKey', 'leadProfessorPublicKey'];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = !argv.includes('--apply');
  const confirmed = argv.includes(CONFIRM_FLAG);
  const outputArg = argv.find((a) => a.startsWith('--output='));
  const output = outputArg
    ? resolveSafeJsonReportOutputPath(outputArg.slice('--output='.length))
    : undefined;

  const guard = assertScriptApplyAllowed({
    apply: !dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!dryRun && !confirmed) throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${dryRun ? 'dry-run' : 'apply'}`,
  );

  await initializeConnections();

  const entities = (await ResearchEntity.find({}).select('_id slug').lean()) as unknown as Array<
    Record<string, unknown>
  >;
  const keyById = new Map(entities.map((e) => [String(e._id), String(e.slug ?? '')]));

  const edgeDocs = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: LEAD_ROLES },
    archived: { $ne: true },
  })
    .select('_id personId target rosterProvenance')
    .lean()) as unknown as Array<Record<string, any>>;

  const edges: LeadEdgeRow[] = edgeDocs.flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    const entityKey = keyById.get(String(doc.target?.id)) ?? '';
    if (!id || !entityKey) return [];
    return [
      {
        id,
        personId: serializedDocumentId(doc.personId) ?? '',
        entityKey,
        sourceUrl: doc.rosterProvenance?.sourceUrl,
        sourceName: doc.rosterProvenance?.sourceName,
      },
    ];
  });

  const citationDocs = (await Observation.find({
    entityType: 'researchEntity',
    field: { $in: LEAD_OBSERVATION_FIELDS },
  })
    .select('entityKey sourceUrl sourceName')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const citations: LeadEdgeCitation[] = citationDocs.map((d) => ({
    entityKey: String(d.entityKey ?? ''),
    sourceUrl: String(d.sourceUrl ?? ''),
    sourceName: String(d.sourceName ?? ''),
  }));

  const { plans, outcomes } = planLeadEdgeSourceNameBackfill(edges, laneNamesByCitation(citations));

  let updated = 0;
  if (!dryRun && plans.length > 0) {
    const ops = plans
      .filter((p) => mongoose.isValidObjectId(p.id))
      .map((p) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(p.id) },
          update: { $set: { 'rosterProvenance.sourceName': p.sourceName } },
        },
      }));
    if (ops.length > 0) {
      const result = await RoleAssignment.bulkWrite(ops);
      updated = result.modifiedCount || 0;
    }
  }

  // Re-read rather than trusting the write count: the number that matters is how many live
  // lead edges still carry a url with no lane after the pass.
  const stillMissing = await RoleAssignment.countDocuments({
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: LEAD_ROLES },
    archived: { $ne: true },
    'rosterProvenance.sourceUrl': { $exists: true, $nin: ['', null] },
    $or: [
      { 'rosterProvenance.sourceName': { $exists: false } },
      { 'rosterProvenance.sourceName': '' },
      { 'rosterProvenance.sourceName': null },
    ],
  });

  const report = {
    script: SCRIPT_NAME,
    mode: dryRun ? 'dry-run' : 'apply',
    leadEdgesScanned: edges.length,
    leadCitationObservations: citations.length,
    planned: plans.length,
    outcomes,
    updated,
    liveLeadEdgesWithUrlAndNoSourceName: stillMissing,
  };
  console.log(JSON.stringify(report, null, 2));
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(`Saved ${SCRIPT_NAME} report to ${output}`);
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
