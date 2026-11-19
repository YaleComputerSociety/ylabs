/**
 * Counts how many researchers holding `identifiers.email` carry a current
 * `identifiers.emailSupport` marker (#5627). Read-only. Any serve-time use of the marker that
 * treats an unmarked address as unsupported must wait until `unmarked` reads 0 in that
 * environment, or it would withhold every address the marker has not reached yet.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { Researcher } from '../models/researcher';
import { researcherEmailSupportVerdict } from '../services/servedResearcherEmail';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
  quiet: true,
});

export type CoverageEnvironment = 'development' | 'beta' | 'production';

const MONGO_URL_ENV_VARS: Record<CoverageEnvironment, string> = {
  development: 'MONGODBURL',
  beta: 'BETA_MONGODBURL',
  production: 'PRODUCTION_MONGODBURL',
};

export interface EmailSupportCoverage {
  researchersWithEmail: number;
  supported: number;
  unsupported: number;
  unmarked: number;
  failClosedSafe: boolean;
}

export function summarizeEmailSupportCoverage(
  researchers: ReadonlyArray<{ identifiers?: { email?: unknown; emailSupport?: any } | null }>,
): EmailSupportCoverage {
  const coverage = { researchersWithEmail: 0, supported: 0, unsupported: 0, unmarked: 0 };
  for (const researcher of researchers) {
    coverage.researchersWithEmail += 1;
    coverage[
      researcherEmailSupportVerdict(
        researcher.identifiers?.email,
        researcher.identifiers?.emailSupport,
      )
    ] += 1;
  }
  return { ...coverage, failClosedSafe: coverage.unmarked === 0 };
}

export function parseCoverageEnvironment(argv: string[]): CoverageEnvironment {
  let environment: CoverageEnvironment = 'development';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    const value = arg.startsWith('--environment=')
      ? arg.slice('--environment='.length)
      : arg === '--environment'
        ? argv[++index]
        : undefined;
    if (value === undefined) throw new Error(`Unknown argument: ${arg}`);
    if (value !== 'development' && value !== 'beta' && value !== 'production') {
      throw new Error(`--environment must be development, beta or production; received ${value}`);
    }
    environment = value;
  }
  return environment;
}

export async function runResearcherEmailSupportCoverage(argv: string[]): Promise<number> {
  const environment = parseCoverageEnvironment(argv);
  const variable = MONGO_URL_ENV_VARS[environment];
  const mongoUrl = process.env[variable];
  if (!mongoUrl) {
    console.error(`${variable} is required to read the ${environment} environment`);
    return 1;
  }
  await connectScriptMongo(mongoUrl);
  try {
    const researchers = await Researcher.find({
      archived: { $ne: true },
      'identifiers.email': { $nin: [null, ''] },
    })
      .select('identifiers.email identifiers.emailSupport')
      .lean();
    console.log(`Database ${mongoose.connection.db?.databaseName ?? 'unknown'}`);
    console.log(JSON.stringify(summarizeEmailSupportCoverage(researchers as any[]), null, 2));
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectScriptInvocation(import.meta.url, 'researcherEmailSupportCoverage')) {
  runResearcherEmailSupportCoverage(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[researchers:email-support-coverage] failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
