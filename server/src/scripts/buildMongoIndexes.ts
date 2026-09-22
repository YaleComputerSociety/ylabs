/**
 * Builds the indexes every registered model declares, deliberately, because
 * connecting no longer builds them (`autoIndex: false` / `autoCreate: false` in
 * `db/connections.ts`, #2233).
 *
 * NOT named `syncIndexes`, and it must never be renamed to that. Two different
 * things in this repository carry that name with opposite risk profiles: the
 * local helpers in `syncBetaToDevelopment.ts` and `promoteAcceptedBetaCopy.ts`
 * are additive index copies, while Mongoose's own `Model.syncIndexes()` DROPS any
 * index the schema no longer declares. This command is additive only. Removing an
 * index stays a reviewed migration with its own issue, never a side effect of an
 * operator running a build.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import '../models';
import { declaredIndexName, mongoOptions, reportMissingMongoIndexes } from '../db/connections';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface BuildMongoIndexesArgs {
  apply: boolean;
}

export function parseBuildMongoIndexesArgs(argv: string[]): BuildMongoIndexesArgs {
  const args: BuildMongoIndexesArgs = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export interface ModelIndexPlan {
  model: string;
  collection: string;
  declaredIndexNames: string[];
}

export function planDeclaredIndexes(connection: mongoose.Connection): ModelIndexPlan[] {
  return connection
    .modelNames()
    .map((modelName) => {
      const model = connection.model(modelName);
      return {
        model: modelName,
        collection: model.collection.name,
        declaredIndexNames: model.schema
          .indexes()
          .map(([key, options]) =>
            declaredIndexName(key as Record<string, unknown>, options as Record<string, unknown>),
          )
          .filter(Boolean),
      };
    })
    .filter((plan) => plan.declaredIndexNames.length > 0)
    .sort((left, right) => left.collection.localeCompare(right.collection));
}

async function main(): Promise<void> {
  const args = parseBuildMongoIndexesArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'db:build-indexes',
    mongoUrl,
  });

  await mongoose.connect(mongoUrl, mongoOptions);
  try {
    const plans = planDeclaredIndexes(mongoose.connection);
    const declaredTotal = plans.reduce((sum, plan) => sum + plan.declaredIndexNames.length, 0);
    const missingBefore = await reportMissingMongoIndexes();
    const missingBeforeTotal = missingBefore.reduce(
      (sum, entry) => sum + entry.missingIndexNames.length,
      0,
    );
    console.log(
      JSON.stringify(
        {
          mode: args.apply ? 'apply' : 'dry-run',
          environment: guard.environment,
          db: guard.dbLabel,
          collectionsWithDeclaredIndexes: plans.length,
          declaredIndexes: declaredTotal,
          missingIndexesBefore: missingBeforeTotal,
          missingByCollection: missingBefore,
        },
        null,
        2,
      ),
    );

    if (!args.apply) {
      console.log('dry-run: nothing was built. Re-run with --apply to build.');
      return;
    }

    // One model's build failing must not silence the rest, and it must not be
    // swallowed either: measured on Development, `autoIndex` had been failing
    // silently for two declared indexes for the database's whole life, which is
    // the failure mode this command exists to replace.
    let succeeded = 0;
    const failures: Array<{ collection: string; message: string }> = [];
    for (const plan of plans) {
      try {
        await mongoose.connection.model(plan.model).createIndexes();
        succeeded += 1;
      } catch (error) {
        failures.push({
          collection: plan.collection,
          message: (error as Error)?.message ?? String(error),
        });
      }
    }
    const missingAfter = await reportMissingMongoIndexes();
    const missingAfterTotal = missingAfter.reduce(
      (sum, entry) => sum + entry.missingIndexNames.length,
      0,
    );
    console.log(
      JSON.stringify(
        {
          collectionsBuilt: succeeded,
          failures,
          missingIndexesAfter: missingAfterTotal,
          missingByCollection: missingAfter,
        },
        null,
        2,
      ),
    );
    if (missingAfterTotal > 0 || failures.length > 0) {
      throw new Error(
        `db:build-indexes left ${missingAfterTotal} declared index(es) unbuilt across ` +
          `${missingAfter.length} collection(s). A duplicate value blocks a unique index and a ` +
          'single-text-index-per-collection conflict blocks a widened text index; both need a ' +
          'reviewed migration, because this command never drops an index.',
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
