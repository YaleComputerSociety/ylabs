import dotenv from 'dotenv';
import fs from 'fs';
import { MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  applySync,
  buildPlan,
  collectionsForOptions,
  parseMongoTarget,
  researchPersonAccountIds,
  type BetaToDevelopmentOptions,
} from './syncBetaToDevelopment';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });
const developmentUrl = process.env.MONGODBURL || '';
const betaProfilePath = path.join(SERVER_ROOT, '.env.beta-operator');
const betaProfile = fs.existsSync(betaProfilePath)
  ? dotenv.parse(fs.readFileSync(betaProfilePath))
  : {};

export interface DevelopmentToBetaOptions {
  mode: 'dry-run' | 'apply';
  developmentUrl: string;
  betaUrl: string;
  confirmSync: boolean;
  includeObservations: boolean;
  output?: string;
}

export function parseDevelopmentToBetaOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): DevelopmentToBetaOptions {
  let mode: 'dry-run' | 'apply' = 'dry-run';
  let confirmSync = env.CONFIRM_DEVELOPMENT_TO_BETA_SYNC === 'true';
  let includeObservations = false;
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') mode = 'apply';
    else if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--confirm-development-to-beta') confirmSync = true;
    else if (arg === '--skip-observations') includeObservations = false;
    else if (arg === '--include-observations') includeObservations = true;
    else if (arg === '--output') {
      output = resolveSafeJsonReportOutputPath(argv[++index]?.trim());
    } else if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length).trim());
    } else throw new Error(`Unknown beta:refresh-from-development argument: ${arg}`);
  }
  return {
    mode,
    developmentUrl: env.DEVELOPMENT_MONGODBURL || developmentUrl,
    betaUrl: env.BETA_MONGODBURL || betaProfile.MONGODBURL || '',
    confirmSync,
    includeObservations,
    output,
  };
}

export function assertSafeDevelopmentToBetaOptions(options: DevelopmentToBetaOptions): void {
  const source = parseMongoTarget(options.developmentUrl);
  const target = parseMongoTarget(options.betaUrl);
  if (source.database !== 'Development' || source.local) {
    throw new Error('Source must be a remote MongoDB database named Development');
  }
  if (target.database !== 'Beta' || target.local) {
    throw new Error('Target must be a remote MongoDB database named Beta');
  }
  if (options.developmentUrl === options.betaUrl) throw new Error('Source and target must differ');
  if (options.mode === 'apply' && !options.confirmSync) {
    throw new Error('Apply mode requires --confirm-development-to-beta');
  }
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const options = parseDevelopmentToBetaOptions(process.argv.slice(2));
  assertSafeDevelopmentToBetaOptions(options);
  const sourceClient = new MongoClient(options.developmentUrl);
  const targetClient = new MongoClient(options.betaUrl);
  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    const sourceDb = sourceClient.db();
    const targetDb = targetClient.db();
    const sharedOptions = {
      includeObservations: options.includeObservations,
    } as BetaToDevelopmentOptions;
    const researchAccountIds = await researchPersonAccountIds(sourceDb);
    const collections = collectionsForOptions(sharedOptions, researchAccountIds);
    const before = await buildPlan(sourceDb, targetDb, collections);
    let after = before;
    const report = {
      mode: options.mode,
      sourceEnvironment: 'development',
      targetEnvironment: 'beta',
      developmentTarget: summarizeMongoUrl(options.developmentUrl),
      betaTarget: summarizeMongoUrl(options.betaUrl),
      includesObservations: options.includeObservations,
      collections: before,
      preservedBetaOperationalCollections: true,
      userCopyPolicy:
        'Preserve accounts reachable from a Researcher; pseudonymize every other account and remove account activity fields.',
      observationPolicy: options.includeObservations
        ? 'Observations included by explicit --include-observations opt-in.'
        : 'Observations stay in Development: they are 95 percent of the volume on a shared Atlas cluster. A mirror without them must not be re-materialized.',
    };
    if (options.mode === 'dry-run') {
      console.log(JSON.stringify(report, null, 2));
      writeOutput(report, options.output);
      return;
    }
    await applySync(sourceDb, targetDb, collections, [], async () => {
      after = await buildPlan(sourceDb, targetDb, collections);
      const mismatches = after.filter((row) => row.sourceCopyCount !== row.targetCount);
      if (mismatches.length) {
        throw new Error(
          `Post-sync count verification failed: ${mismatches.map((row) => row.name).join(', ')}`,
        );
      }
    });
    const result = { ...report, status: 'applied', collections: after };
    console.log(JSON.stringify(result, null, 2));
    writeOutput(result, options.output);
  } finally {
    await Promise.all([sourceClient.close(), targetClient.close()]);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
