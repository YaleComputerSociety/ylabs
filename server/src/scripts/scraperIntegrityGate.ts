import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import {
  isIntegrityGateFailure,
  runPostMaterializationIntegrityGate,
  type PostMaterializationIntegritySummary,
} from '../scrapers/integrityGate';
import { loadResearchAccessArtifacts } from './claimGate';
import { buildClaimGateReport } from '../services/claimValidation/accessClaims';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface ScraperIntegrityGateCliOptions {
  includeSamples: boolean;
  includeClaimGate: boolean;
  limit: number;
  sourceRunId?: string;
  output?: string;
}

function valueAfterEquals(arg: string, flag: string): string | undefined {
  return arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
}

function consumeValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = valueAfterEquals(arg, flag);
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, nextIndex: inline !== undefined ? index : index + 1 };
}

export function parseScraperIntegrityGateArgs(argv: string[]): ScraperIntegrityGateCliOptions {
  let includeSamples = false;
  let includeClaimGate = false;
  let limit = 25;
  let sourceRunId: string | undefined;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--include-samples') {
      includeSamples = true;
      continue;
    }
    if (arg === '--include-claim-gate') {
      includeClaimGate = true;
      continue;
    }

    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const { value: limitValue, nextIndex } = consumeValue(argv, index, '--limit');
      if (!/^[1-9]\d*$/.test(limitValue)) {
        throw new Error('--limit must be a positive integer');
      }
      const parsed = Number(limitValue);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      index = nextIndex;
      continue;
    }

    if (arg === '--source-run' || arg.startsWith('--source-run=')) {
      const { value: sourceRunValue, nextIndex } = consumeValue(argv, index, '--source-run');
      sourceRunId = sourceRunValue;
      index = nextIndex;
      continue;
    }

    if (arg === '--output' || arg.startsWith('--output=')) {
      const { value: outputValue, nextIndex } = consumeValue(argv, index, '--output');
      output = outputValue;
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    includeSamples,
    includeClaimGate,
    limit,
    ...(sourceRunId ? { sourceRunId } : {}),
    ...(output ? { output } : {}),
  };
}

export function writeIntegrityGateOutput(value: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildScraperIntegrityGateOutput<
  T extends PostMaterializationIntegritySummary & { claimGate?: ReturnType<typeof buildClaimGateReport> },
>(
  result: T,
  metadata: {
    generatedAt: string;
    environment?: string;
    db?: string;
    options?: ScraperIntegrityGateCliOptions;
  },
): T & {
  generatedAt: string;
  environment?: string;
  db?: string;
  options?: ScraperIntegrityGateCliOptions;
} {
  return {
    generatedAt: metadata.generatedAt,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    ...(metadata.options ? { options: metadata.options } : {}),
    ...result,
  };
}

async function main(): Promise<void> {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');

  const options = parseScraperIntegrityGateArgs(process.argv.slice(2));
  await mongoose.connect(mongoUrl);
  const result: PostMaterializationIntegritySummary & { claimGate?: ReturnType<typeof buildClaimGateReport> } =
    await runPostMaterializationIntegrityGate(options);
  if (options.includeClaimGate) {
    const artifacts = await loadResearchAccessArtifacts(options.limit);
    result.claimGate = buildClaimGateReport({
      artifacts,
      includeSamples: options.includeSamples,
      sampleLimit: options.limit,
    });
  }
  const output = buildScraperIntegrityGateOutput(result, {
    generatedAt: new Date().toISOString(),
    environment: process.env.SCRAPER_ENV || process.env.NODE_ENV || 'local',
    db: mongoose.connection.db?.databaseName || mongoose.connection.name,
    options,
  });
  writeIntegrityGateOutput(output, options.output);
  console.log(JSON.stringify(output, null, 2));
  if (isIntegrityGateFailure(output)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
