import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { auditStudentReadyPublicDescriptions } from '../services/researchEntityPublicDescriptionAuditService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

interface PublicDescriptionAuditOptions {
  includeSamples: boolean;
  sampleLimit: number;
  strict: boolean;
  output?: string;
}

const __filename = fileURLToPath(import.meta.url);

function parseNonNegativeInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

export function parsePublicDescriptionAuditArgs(argv: string[]): PublicDescriptionAuditOptions {
  const options: PublicDescriptionAuditOptions = {
    includeSamples: false,
    sampleLimit: 25,
    strict: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--include-samples') {
      options.includeSamples = true;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parseNonNegativeInteger(
        arg.slice('--sample-limit='.length),
        '--sample-limit',
      );
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function writePublicDescriptionAuditOutput(value: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const options = parsePublicDescriptionAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'research-entity:audit-public-descriptions',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const report = await auditStudentReadyPublicDescriptions(options);
  const output = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    options,
    ...report,
  };
  writePublicDescriptionAuditOutput(output, options.output);
  console.log(JSON.stringify(output, null, 2));
  if (options.strict && !report.pass) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to audit public research descriptions:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
