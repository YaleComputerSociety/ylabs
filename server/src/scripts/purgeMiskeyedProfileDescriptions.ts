import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { personProfileSourceMatchesEntity } from '../scrapers/utils/personProfileEntityMatch';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:purge-miskeyed-profile-descriptions';
const SOURCE_NAME = 'lab-microsite-description-llm';
const ROLLBACK_REASON =
  'mis-keyed profile description: source names a different person than the entity or contradicts its Yale school (#688, #1045)';

export interface PurgeMiskeyedProfileDescriptionsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): PurgeMiskeyedProfileDescriptionsArgs {
  const args: PurgeMiskeyedProfileDescriptionsArgs = {
    apply: false,
    confirm: false,
    maxApply: 200,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-purge-miskeyed-descriptions') args.confirm = true;
    else if (arg.startsWith('--max-apply=')) args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

interface MiskeyedGroup {
  entityType: string;
  entityKey?: string;
  entityId?: string;
  entitySlug?: string;
  entityName?: string;
  sourceUrl: string;
  fields: string[];
  observationIds: string[];
}

export async function loadMiskeyedGroups(): Promise<MiskeyedGroup[]> {
  const observations = await Observation.find({
    entityType: 'researchEntity',
    sourceName: SOURCE_NAME,
    superseded: { $ne: true },
    sourceUrl: /(^|\.)yale\.edu/i,
  })
    .select('_id entityKey entityId sourceUrl field')
    .lean();

  const grouped = new Map<string, MiskeyedGroup & { fieldSet: Set<string> }>();
  for (const obs of observations as any[]) {
    const key = `${obs.entityKey || serializedDocumentId(obs.entityId)}|${obs.sourceUrl}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        entityType: 'researchEntity',
        entityKey: obs.entityKey,
        entityId: obs.entityId ? serializedDocumentId(obs.entityId) : undefined,
        sourceUrl: obs.sourceUrl,
        fields: [],
        fieldSet: new Set<string>(),
        observationIds: [],
      });
    }
    const group = grouped.get(key)!;
    group.fieldSet.add(obs.field);
    const observationId = serializedDocumentId(obs._id);
    if (observationId) group.observationIds.push(observationId);
  }

  const miskeyed: MiskeyedGroup[] = [];
  for (const group of grouped.values()) {
    const entity = await ResearchEntity.findOne(
      group.entityKey ? { slug: group.entityKey } : { _id: group.entityId },
    )
      .select('slug name displayName school schools departments sourceUrls fullDescription recentGrants')
      .lean();
    if (!entity) continue;
    if (personProfileSourceMatchesEntity(group.sourceUrl, entity as any)) continue;
    miskeyed.push({
      entityType: group.entityType,
      entityKey: group.entityKey,
      entityId: group.entityId,
      entitySlug: (entity as any).slug,
      entityName: (entity as any).name,
      sourceUrl: group.sourceUrl,
      fields: Array.from(group.fieldSet).sort(),
      observationIds: group.observationIds,
    });
  }
  return miskeyed.sort((a, b) => String(a.entitySlug).localeCompare(String(b.entitySlug)));
}

async function applyGroups(groups: MiskeyedGroup[]): Promise<number> {
  let superseded = 0;
  for (const group of groups) {
    const ids = group.observationIds.map((id) => new mongoose.Types.ObjectId(id));
    const result = await Observation.updateMany(
      { _id: { $in: ids }, superseded: { $ne: true } },
      {
        $set: {
          superseded: true,
          rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON },
        },
      },
    );
    superseded += result.modifiedCount || 0;
  }
  return superseded;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const groups = await loadMiskeyedGroups();
  const plannedObservations = groups.reduce((sum, group) => sum + group.observationIds.length, 0);

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-purge-miskeyed-descriptions is required when --apply is set.');
    }
    if (plannedObservations > args.maxApply) {
      throw new Error(
        `Apply would supersede ${plannedObservations} observations, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const superseded = args.apply ? await applyGroups(groups) : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    sourceName: SOURCE_NAME,
    miskeyedEntities: groups.length,
    plannedObservations,
    supersededObservations: superseded,
    groups,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, groups: groups.slice(0, 50) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
