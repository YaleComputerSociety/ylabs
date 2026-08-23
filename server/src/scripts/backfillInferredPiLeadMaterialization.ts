import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { RoleAssignment, type RoleAssignmentRole } from '../models/roleAssignment';
import { canonicalRoleForLegacy } from '../models/canonicalRoleMapping';
import { materializeInferredPiMembership } from '../scrapers/entityMaterializer';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  runInferredPiLeadMaterializationBackfill,
  type InferredPiLagEntity,
  type InferredPiLeadMaterializationDeps,
} from './backfillInferredPiLeadMaterializationCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const GRANT_SHELL_SLUG = '^(nsf|nih)-pi-';
const RESEARCH_ENTITY_OBSERVATION_TYPES = ['researchEntity', 'researchGroup'];
const INFERRED_PI_FIELDS = ['inferredPiUserId', 'inferredPiUserKey'];
const LEGACY_LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const CANONICAL_LEAD_ROLES = LEGACY_LEAD_ROLES.map((role) => canonicalRoleForLegacy(role)).filter(
  (role): role is RoleAssignmentRole => Boolean(role),
);

function toEntityObjectId(entityId: string): mongoose.Types.ObjectId | null {
  return mongoose.Types.ObjectId.isValid(entityId)
    ? new mongoose.Types.ObjectId(entityId)
    : null;
}

async function currentLeadCount(objectIds: mongoose.Types.ObjectId[]): Promise<string[]> {
  if (objectIds.length === 0) return [];
  const linked = await RoleAssignment.distinct('target.id', {
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: objectIds },
    role: { $in: CANONICAL_LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
  });
  return linked.map((value) => String(value));
}

function buildDeps(scope: 'grant-shells' | 'all'): InferredPiLeadMaterializationDeps {
  return {
    async findEntitiesWithInferredPiObservations() {
      const slugs = await Observation.distinct('entityKey', {
        entityType: { $in: RESEARCH_ENTITY_OBSERVATION_TYPES },
        field: { $in: INFERRED_PI_FIELDS },
        superseded: false,
        ...(scope === 'grant-shells'
          ? { entityKey: { $regex: GRANT_SHELL_SLUG, $options: 'i' } }
          : {}),
      });
      if (slugs.length === 0) return [];
      const docs = await ResearchEntity.find({
        slug: { $in: slugs },
        archived: { $ne: true },
      })
        .select('_id slug')
        .lean();
      return (docs as unknown as Array<{ _id: unknown; slug: string }>).map((doc) => ({
        entityId: String(doc._id),
        entityKey: doc.slug,
      }));
    },
    async findEntityIdsWithCurrentLead(entityIds) {
      const objectIds = entityIds
        .map(toEntityObjectId)
        .filter((value): value is mongoose.Types.ObjectId => value !== null);
      return new Set(await currentLeadCount(objectIds));
    },
    async loadCurrentObservationsForEntity(entity: InferredPiLagEntity) {
      const observations = await Observation.find({
        entityType: { $in: RESEARCH_ENTITY_OBSERVATION_TYPES },
        entityKey: entity.entityKey,
        superseded: false,
      })
        .select('field value sourceName sourceUrl observedAt confidence')
        .lean();
      return observations as Array<Record<string, unknown>>;
    },
    async materializeInferredPiLead(entityId, observations) {
      await materializeInferredPiMembership(entityId, observations);
    },
    async hasCurrentLeadAfter(entityId) {
      const objectId = toEntityObjectId(entityId);
      if (!objectId) return false;
      const linked = await currentLeadCount([objectId]);
      return linked.length > 0;
    },
  };
}

function parseOutputPath(argv: string[]): string | undefined {
  const inline = argv.find((arg) => arg.startsWith('--output='));
  if (inline) return resolveSafeJsonReportOutputPath(inline.slice('--output='.length));
  const flagIndex = argv.indexOf('--output');
  if (flagIndex >= 0) return resolveSafeJsonReportOutputPath(argv[flagIndex + 1]);
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const scope = argv.includes('--all') ? 'all' : 'grant-shells';
  const output = parseOutputPath(argv);

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfillInferredPiLeadMaterialization',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const report = await runInferredPiLeadMaterializationBackfill(buildDeps(scope), { apply });

  const outputReport = {
    mode: apply ? 'apply' : 'dry-run',
    scope,
    environment: guard.environment,
    db: guard.dbLabel,
    ...report,
  };
  console.log(JSON.stringify(outputReport, null, 2));
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to materialize inferred PI leads:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
