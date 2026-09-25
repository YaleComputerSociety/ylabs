import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  normalizeDepartureNote,
  planResearchEntityDepartureRecord,
  type DepartureRecordDecision,
} from './recordResearchEntityDepartureCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:record-departure';

export interface RecordDepartureArgs {
  slug: string;
  note: string;
  apply: boolean;
}

function flagValue(flag: string, raw: string | undefined, alreadySet: string): string {
  if (alreadySet) throw new Error(`${flag} may be given only once`);
  const value = (raw ?? '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv: string[]): RecordDepartureArgs {
  let slug = '';
  let note = '';
  let apply = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') apply = false;
    else if (arg.startsWith('--slug='))
      slug = flagValue('--slug', arg.slice('--slug='.length), slug);
    else if (arg === '--slug') slug = flagValue('--slug', argv[++index], slug);
    else if (arg.startsWith('--note='))
      note = flagValue('--note', arg.slice('--note='.length), note);
    else if (arg === '--note') note = flagValue('--note', argv[++index], note);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!slug) {
    throw new Error('--slug is required: a reported departure is a judgement about one row.');
  }
  return { slug, note: normalizeDepartureNote(note), apply };
}

export interface DepartureOutcome {
  slug: string;
  entityId?: string;
  tierBefore?: string;
  decision: DepartureRecordDecision | { action: 'skip'; reason: 'not_found' };
}

export async function planOutcome(slug: string, note: string): Promise<DepartureOutcome> {
  const entity = await ResearchEntity.findOne({ slug })
    .select(
      '_id slug studentVisibilityTier studentVisibilitySuppressionReason manuallyLockedFields',
    )
    .lean();
  if (!entity) return { slug, decision: { action: 'skip', reason: 'not_found' } };
  return {
    slug,
    entityId: serializedDocumentId((entity as any)._id),
    tierBefore: (entity as any).studentVisibilityTier,
    decision: planResearchEntityDepartureRecord(entity as any, note),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const outcome = await planOutcome(args.slug, args.note);

  let gateCounts: unknown = null;
  if (args.apply && outcome.entityId) {
    if (outcome.decision.action === 'record') {
      await ResearchEntity.updateOne({ slug: outcome.slug }, { $set: outcome.decision.set });
    }
    gateCounts = (
      await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: [outcome.entityId],
      })
    ).counts;
  }

  // Verification is a re-read of the served surface: `getResearchGroupDetail`
  // returns null for any row the public tiers exclude, so a null here is the same
  // answer a student's request gets.
  const stillServed = Boolean(await getResearchGroupDetail(args.slug));

  const after = (await ResearchEntity.findOne({ slug: args.slug })
    .select('studentVisibilityTier activeAtYaleCache')
    .lean()) as any;

  console.log(
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        generatedAt: new Date().toISOString(),
        environment: guard.environment,
        db: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        note: args.note,
        outcome,
        gateCounts,
        after: after
          ? { tier: after.studentVisibilityTier, activeAtYaleCache: after.activeAtYaleCache }
          : null,
        stillServed,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
