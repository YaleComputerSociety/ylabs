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
  slugs: string[];
  note: string;
  apply: boolean;
}

export function parseArgs(argv: string[]): RecordDepartureArgs {
  const slugs: string[] = [];
  let note = '';
  let apply = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') apply = false;
    else if (arg.startsWith('--slug=')) slugs.push(arg.slice('--slug='.length));
    else if (arg === '--slug') slugs.push(argv[++index] ?? '');
    else if (arg.startsWith('--note=')) note = arg.slice('--note='.length);
    else if (arg === '--note') note = argv[++index] ?? '';
  }
  const normalizedSlugs = Array.from(new Set(slugs.map((slug) => slug.trim()).filter(Boolean)));
  if (normalizedSlugs.length === 0) throw new Error('--slug is required (repeatable)');
  return { slugs: normalizedSlugs, note: normalizeDepartureNote(note), apply };
}

interface SlugOutcome {
  slug: string;
  entityId?: string;
  tierBefore?: string;
  decision: DepartureRecordDecision | { action: 'skip'; reason: 'not_found' };
}

export async function planOutcomes(slugs: string[], note: string): Promise<SlugOutcome[]> {
  const outcomes: SlugOutcome[] = [];
  for (const slug of slugs) {
    const entity = await ResearchEntity.findOne({ slug })
      .select(
        '_id slug studentVisibilityTier studentVisibilitySuppressionReason manuallyLockedFields',
      )
      .lean();
    if (!entity) {
      outcomes.push({ slug, decision: { action: 'skip', reason: 'not_found' } });
      continue;
    }
    outcomes.push({
      slug,
      entityId: serializedDocumentId((entity as any)._id),
      tierBefore: (entity as any).studentVisibilityTier,
      decision: planResearchEntityDepartureRecord(entity as any, note),
    });
  }
  return outcomes;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const outcomes = await planOutcomes(args.slugs, args.note);
  const recordable = outcomes.filter((outcome) => outcome.decision.action === 'record');

  let gateCounts: unknown = null;
  if (args.apply) {
    for (const outcome of recordable) {
      const decision = outcome.decision as Extract<DepartureRecordDecision, { action: 'record' }>;
      await ResearchEntity.updateOne({ slug: outcome.slug }, { $set: decision.set });
    }
    const recordIds = recordable
      .map((outcome) => outcome.entityId)
      .filter((id): id is string => Boolean(id));
    if (recordIds.length > 0) {
      gateCounts = (
        await runStudentVisibilityGate({ collection: 'research', mode: 'apply', recordIds })
      ).counts;
    }
  }

  // Verification is a re-read of the served surface: `getResearchGroupDetail`
  // returns null for any row the public tiers exclude, so a null here is the same
  // answer a student's request gets.
  const served: Record<string, boolean> = {};
  for (const outcome of outcomes) {
    served[outcome.slug] = Boolean(await getResearchGroupDetail(outcome.slug));
  }

  const afterTiers = Object.fromEntries(
    (
      await ResearchEntity.find({ slug: { $in: args.slugs } })
        .select('slug studentVisibilityTier activeAtYaleCache')
        .lean()
    ).map((entity: any) => [
      entity.slug,
      { tier: entity.studentVisibilityTier, activeAtYaleCache: entity.activeAtYaleCache },
    ]),
  );

  console.log(
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        generatedAt: new Date().toISOString(),
        environment: guard.environment,
        db: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        note: args.note,
        planned: recordable.length,
        skipped: outcomes.filter((outcome) => outcome.decision.action === 'skip').length,
        outcomes,
        gateCounts,
        afterTiers,
        stillServed: Object.entries(served)
          .filter(([, isServed]) => isServed)
          .map(([slug]) => slug),
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
