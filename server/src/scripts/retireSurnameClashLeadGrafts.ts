import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { researchEntityIdentityTokens } from '../scrapers/utils/personProfileEntityMatch';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planSurnameClashLeadDetachment,
  summarizeSurnameClashRefusals,
  surnameClashGroups,
  type SurnameClashEntityRow,
  type SurnameClashLeadRow,
} from './retireSurnameClashLeadGraftsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'role-assignments:retire-surname-clash-lead-grafts';
export const CONFIRM_FLAG = '--confirm-retire-surname-clash-lead-grafts';
const LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'];
const DETACH_NOTE =
  'Detached as a same-surname lead on an entity whose own identity names a different person (#2768).';

export interface RetireSurnameClashOptions {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRetireSurnameClashArgs(argv: string[]): RetireSurnameClashOptions {
  const options: RetireSurnameClashOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

interface PersonIdentity {
  displayName: string;
  identityAnchored: boolean;
}

async function loadPersonIdentities(): Promise<Map<string, PersonIdentity>> {
  const researchers = (await Researcher.find({ archived: { $ne: true } })
    .select('_id displayName identifiers accountId profile.title profile.primaryDepartment')
    .lean()) as unknown as Array<Record<string, any>>;
  const identities = new Map<string, PersonIdentity>();
  for (const row of researchers) {
    const id = serializedDocumentId(row._id);
    if (!id) continue;
    const displayName = String(row.displayName || '').trim();
    if (!displayName) continue;
    identities.set(id, {
      displayName,
      identityAnchored: Boolean(
        String(row.identifiers?.netid || '').trim() ||
        row.accountId ||
        String(row.profile?.title || '').trim() ||
        String(row.profile?.primaryDepartment || '').trim(),
      ),
    });
  }
  return identities;
}

async function loadClashEntities(
  identities: ReadonlyMap<string, PersonIdentity>,
): Promise<{ rows: SurnameClashEntityRow[]; slugByEntityId: Map<string, string> }> {
  const assignments = (await RoleAssignment.find({
    role: { $in: LEAD_ROLES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
    'target.kind': 'RESEARCH_ENTITY',
  })
    .select('_id personId target reviewStatus rosterProvenance.evidenceStatus')
    .lean()) as unknown as Array<Record<string, any>>;

  const leadsByEntityId = new Map<string, SurnameClashLeadRow[]>();
  for (const doc of assignments) {
    const entityId = serializedDocumentId(doc.target?.id);
    const assignmentId = serializedDocumentId(doc._id);
    const personId = serializedDocumentId(doc.personId);
    if (!entityId || !assignmentId || !personId) continue;
    const identity = identities.get(personId);
    if (!identity) continue;
    leadsByEntityId.set(entityId, [
      ...(leadsByEntityId.get(entityId) || []),
      {
        assignmentId,
        personId,
        displayName: identity.displayName,
        reviewStatus: doc.reviewStatus ? String(doc.reviewStatus) : undefined,
        identityAnchored: identity.identityAnchored,
        rosterVerified:
          String(doc.rosterProvenance?.evidenceStatus || '')
            .trim()
            .toLowerCase() === 'verified',
      },
    ]);
  }

  const clashEntityIds = [...leadsByEntityId.entries()]
    .filter(([, leads]) => surnameClashGroups(leads).length > 0)
    .map(([entityId]) => entityId)
    .filter((entityId) => mongoose.isValidObjectId(entityId));

  const entityDocs = (await ResearchEntity.find({
    _id: { $in: clashEntityIds.map((id) => new mongoose.Types.ObjectId(id)) },
    archived: { $ne: true },
  })
    .select('_id slug name displayName')
    .lean()) as unknown as Array<Record<string, any>>;

  const rows: SurnameClashEntityRow[] = [];
  const slugByEntityId = new Map<string, string>();
  for (const entity of entityDocs) {
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    rows.push({
      entityId,
      identityTokens: researchEntityIdentityTokens({
        name: entity.name,
        displayName: entity.displayName,
        slug: entity.slug,
      }),
      leads: leadsByEntityId.get(entityId) || [],
    });
    slugByEntityId.set(entityId, String(entity.slug || ''));
  }
  return { rows, slugByEntityId };
}

export async function retireSurnameClashLeadGrafts(options: {
  dryRun: boolean;
}): Promise<Record<string, unknown>> {
  const identities = await loadPersonIdentities();
  const { rows, slugByEntityId } = await loadClashEntities(identities);
  const plan = planSurnameClashLeadDetachment(rows);
  const entityIds = [...new Set(plan.detach.map((row) => row.entityId))];

  let detached = 0;
  let regatedEntities = 0;
  if (!options.dryRun && plan.detach.length > 0) {
    const result = await RoleAssignment.updateMany(
      {
        _id: {
          $in: plan.detach
            .map((row) => row.assignmentId)
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
        archived: { $ne: true },
      },
      { $set: { archived: true, reviewStatus: 'DISPUTED', reviewNotes: DETACH_NOTE } },
    );
    detached = result.modifiedCount || 0;

    // Re-gate through the ordinary gate rather than writing tiers here, so every
    // other blocker on those rows still applies and the queue stays consistent.
    if (entityIds.length > 0) {
      await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: entityIds,
      });
      regatedEntities = entityIds.length;
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    surnameClashEntitiesScanned: rows.length,
    plannedDetachments: plan.detach.length,
    entitiesAffected: entityIds.length,
    entitySlugsAffected: entityIds.map((id) => slugByEntityId.get(id) || id).sort(),
    refusedByReason: summarizeSurnameClashRefusals(plan.refused),
    detached,
    regatedEntities,
  };
  return report;
}

async function main(): Promise<void> {
  const options = parseRetireSurnameClashArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();
  const report = await retireSurnameClashLeadGrafts({ dryRun: options.dryRun });
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${options.output}`);
  }

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
