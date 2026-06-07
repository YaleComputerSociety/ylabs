import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { User } from '../models/user';
import { buildProfileImageQualitySummary } from './profileImageQualityAuditCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

export interface ProfileImageQualityAuditCliOptions {
  strict: boolean;
  sampleLimit: number;
  output?: string;
}

export function parseProfileImageQualityAuditArgs(
  argv: string[],
): ProfileImageQualityAuditCliOptions {
  const options: ProfileImageQualityAuditCliOptions = {
    strict: false,
    sampleLimit: 25,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parseNonNegativeInteger(
        arg.slice('--sample-limit='.length),
        '--sample-limit',
      );
      continue;
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

    throw new Error(`Unknown profile image quality audit argument: ${arg}`);
  }

  return options;
}

function parseRequiredOutputPath(value: string | undefined): string {
  const output = value?.trim();
  if (!output || output.startsWith('--')) {
    throw new Error('--output requires a path');
  }
  return output;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return parsed;
}

export function writeProfileImageQualityAuditOutput(summary: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
}

export function buildProfileImageQualityAuditOutput<T extends object>(
  summary: T,
  metadata: {
    environment?: string;
    db?: string;
    options: ProfileImageQualityAuditCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: ProfileImageQualityAuditCliOptions;
} {
  return {
    ...summary,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main() {
  dotenv.config({ path: '.env' });
  const options = parseProfileImageQualityAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'profiles:image-audit',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const users = await User.find({ imageUrl: { $exists: true, $ne: '' } })
    .select('_id netid fname lname email title imageUrl profileUrls')
    .lean();

  const summary = buildProfileImageQualitySummary(
    users.map((user: any) => ({
      id: String(user._id || ''),
      netid: user.netid,
      fname: user.fname,
      lname: user.lname,
      email: user.email,
      title: user.title,
      imageUrl: user.imageUrl,
      profileUrls: user.profileUrls,
    })),
    { sampleLimit: options.sampleLimit },
  );
  const output = buildProfileImageQualityAuditOutput(summary, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });

  console.log(JSON.stringify(output, null, 2));
  writeProfileImageQualityAuditOutput(output, options.output);
  await mongoose.disconnect();

  if (
    options.strict &&
    (summary.nonPersonImageCount > 0 || summary.duplicateImageGroupCount > 0)
  ) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch(async (error) => {
    console.error('Failed to run profile image quality audit:', error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
