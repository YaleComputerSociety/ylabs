import dotenv from 'dotenv';
import { createRequire } from 'module';
import path from 'path';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from '../server/src/scripts/scriptWriteGuards';

dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

const require = createRequire(import.meta.url);
const mongoose = require('../server/node_modules/mongoose') as typeof import('mongoose');

export interface MigrationOptions {
  apply: boolean;
  confirmV4Migration?: boolean;
  limit?: number;
  output?: string;
}

export function parseMigrationOptions(argv = process.argv.slice(2)): MigrationOptions {
  const options: MigrationOptions = { apply: false, confirmV4Migration: false };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    const output = value?.trim();
    if (!output || output.startsWith('--')) throw new Error('--output requires a path');
    return output;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--live') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-v4-migration') {
      options.confirmV4Migration = true;
      continue;
    }
    if (arg.startsWith('--confirm-v4-migration=')) {
      throw new Error('--confirm-v4-migration does not accept a value');
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--limit') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error('--limit requires a positive integer');
      options.limit = parsePositiveInteger(next, '--limit');
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown legacy v4 migration argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function assertV4MigrationApplyAllowed(
  options: Pick<MigrationOptions, 'apply' | 'confirmV4Migration' | 'limit'>,
  scriptName: string,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
): ScriptApplyGuardResult {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error(`--limit is required when --apply is set for ${scriptName}`);
  }
  if (options.apply && !options.confirmV4Migration) {
    throw new Error(`--confirm-v4-migration is required when --apply is set for ${scriptName}`);
  }

  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName,
    mongoUrl,
    env,
  });
}

export function buildV4MigrationOutput<T extends object>(
  result: T,
  metadata: {
    generatedAt?: string;
    environment?: string;
    db?: string;
    options: MigrationOptions;
  },
): T & {
  generatedAt: string;
  environment?: string;
  db?: string;
  options: MigrationOptions;
} {
  return {
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
    ...result,
  };
}

export async function connectForMigration(title: string, options: MigrationOptions): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    throw new Error('MONGODBURL not set in server/.env');
  }
  assertV4MigrationApplyAllowed(options, title, process.env, url);
  console.log(`\n=== ${title} ===`);
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);
  if (options.limit) console.log(`Limit: ${options.limit}`);
  console.log('');
  await mongoose.connect(url);
}

export async function disconnectForMigration(): Promise<void> {
  await mongoose.disconnect();
}

export function fullName(first?: string, last?: string, fallback = 'Unknown'): string {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || fallback;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
