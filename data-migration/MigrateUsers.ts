import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../server/src/models/user';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from '../server/src/scripts/scriptWriteGuards';
import { summarizeMongoUrl } from '../server/src/scrapers/scraperEnvironment';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

export interface UserMigrationCliOptions {
  apply: boolean;
  confirmLegacyUserMigration?: boolean;
  replaceExisting: boolean;
  output?: string;
}

export interface UserMigrationResult {
  sourceCount: number;
  existingTargetCount: number;
  deletedCount: number;
  insertedCount: number;
  finalTargetCount: number;
}

export function parseUserMigrationArgs(argv: string[]): UserMigrationCliOptions {
  const options: UserMigrationCliOptions = {
    apply: false,
    confirmLegacyUserMigration: false,
    replaceExisting: false,
  };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    const output = value?.trim();
    if (!output || output.startsWith('--')) throw new Error('--output requires a path');
    return output;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--live') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--replace-existing') {
      options.replaceExisting = true;
      continue;
    }
    if (arg === '--confirm-legacy-user-migration') {
      options.confirmLegacyUserMigration = true;
      continue;
    }
    if (arg.startsWith('--confirm-legacy-user-migration=')) {
      throw new Error('--confirm-legacy-user-migration does not accept a value');
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown legacy user migration argument: ${arg}`);
  }

  return options;
}

export function assertUserMigrationApplyAllowed(args: {
  apply: boolean;
  confirmLegacyUserMigration?: boolean;
  sourceMongoUrl?: string;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScriptApplyGuardResult {
  if (args.apply && !args.confirmLegacyUserMigration) {
    throw new Error(
      '--confirm-legacy-user-migration is required when --apply is set for legacy user migration copy.',
    );
  }

  if (
    args.apply &&
    args.sourceMongoUrl &&
    args.mongoUrl &&
    args.sourceMongoUrl.trim() === args.mongoUrl.trim()
  ) {
    throw new Error(
      'legacy user migration source and target Mongo URLs must be different before apply mode can run.',
    );
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'legacy user migration copy',
    mongoUrl: args.mongoUrl,
    env: args.env,
  });
}

export function assertUserMigrationReplacementAllowed(args: {
  apply: boolean;
  replaceExisting: boolean;
  existingTargetCount: number;
}): void {
  if (args.apply && !args.replaceExisting && args.existingTargetCount > 0) {
    throw new Error(
      'legacy user migration apply would clear existing target users; pass --replace-existing only after reviewing the dry-run artifact.',
    );
  }
}

export function buildUserMigrationOutput<T extends object>(
  result: T,
  metadata: {
    generatedAt?: string;
    environment?: string;
    sourceDb?: string;
    targetDb?: string;
    options: UserMigrationCliOptions;
  },
): T & {
  generatedAt: string;
  environment?: string;
  sourceDb?: string;
  targetDb?: string;
  options: UserMigrationCliOptions;
} {
  return {
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.sourceDb ? { sourceDb: metadata.sourceDb } : {}),
    ...(metadata.targetDb ? { targetDb: metadata.targetDb } : {}),
    options: metadata.options,
    ...result,
  };
}

export function writeUserMigrationOutput(payload: object, outputPath?: string): void {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function migrateUsers(
  options = parseUserMigrationArgs(process.argv.slice(2)),
): Promise<ReturnType<typeof buildUserMigrationOutput<UserMigrationResult>>> {
  const sourceUrl = process.env.MONGODBURL;
  const targetUrl = process.env.MONGODBURL_MIGRATION;

  if (!sourceUrl) {
    throw new Error('MONGODBURL (Production source) not set in environment');
  }

  if (!targetUrl) {
    throw new Error('MONGODBURL_MIGRATION (ProductionMigration target) not set in environment');
  }

  const guard = assertUserMigrationApplyAllowed({
    apply: options.apply,
    confirmLegacyUserMigration: options.confirmLegacyUserMigration,
    sourceMongoUrl: sourceUrl,
    mongoUrl: targetUrl,
  });

  console.log('\n=== Migrating Users: Production -> ProductionMigration ===\n');
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Source: ${summarizeMongoUrl(sourceUrl)}`);
  console.log(`Target: ${guard.dbLabel}`);
  console.log('');

  let sourceConnection: mongoose.Connection | undefined;
  let targetConnection: mongoose.Connection | undefined;

  try {
    console.log('Connecting to source database...');
    sourceConnection = await mongoose.createConnection(sourceUrl).asPromise();
    const SourceUser = sourceConnection.model('User', User.schema, 'users');

    console.log('Counting source users...');
    const sourceCount = await SourceUser.countDocuments();
    console.log(`Found ${sourceCount} users in source database`);

    console.log('Connecting to target database...');
    targetConnection = await mongoose.createConnection(targetUrl).asPromise();
    const TargetUser = targetConnection.model('User', User.schema, 'users');

    const existingTargetCount = await TargetUser.countDocuments();
    console.log(`Existing users in target database: ${existingTargetCount}`);

    assertUserMigrationReplacementAllowed({
      apply: options.apply,
      replaceExisting: options.replaceExisting,
      existingTargetCount,
    });

    let deletedCount = 0;
    let insertedCount = 0;

    if (options.apply && sourceCount > 0) {
      if (existingTargetCount > 0) {
        console.log('Clearing existing users in target database...');
        const deleteResult = await TargetUser.deleteMany({});
        deletedCount = deleteResult.deletedCount || 0;
      }

      console.log('Fetching source users...');
      const users = await SourceUser.find({}).lean();
      console.log('Inserting users into target database...');
      const result = await TargetUser.insertMany(users, { ordered: false });
      insertedCount = result.length;
      console.log(`Successfully migrated ${insertedCount} users`);
    } else if (sourceCount === 0) {
      console.log('No users to migrate');
    } else {
      console.log(`Dry-run only: would migrate ${sourceCount} users`);
      if (existingTargetCount > 0) {
        console.log('Dry-run only: target replacement would require --replace-existing in apply mode');
      }
    }

    const finalTargetCount = await TargetUser.countDocuments();
    console.log(`Total users in target database: ${finalTargetCount}`);

    const output = buildUserMigrationOutput(
      {
        sourceCount,
        existingTargetCount,
        deletedCount,
        insertedCount,
        finalTargetCount,
      },
      {
        environment: guard.environment,
        sourceDb: summarizeMongoUrl(sourceUrl),
        targetDb: guard.dbLabel,
        options,
      },
    );

    writeUserMigrationOutput(output, options.output);
    if (options.output) console.log(`Wrote user migration report to ${options.output}`);
    console.log(options.apply ? '\nMigration complete!\n' : '\nDry-run complete; no users were copied or deleted.\n');
    return output;
  } finally {
    if (sourceConnection) await sourceConnection.close();
    if (targetConnection) await targetConnection.close();
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  migrateUsers().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
