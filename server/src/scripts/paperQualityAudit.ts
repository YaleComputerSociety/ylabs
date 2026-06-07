import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { buildPaperQualityAudit } from '../services/paperQualityService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export interface PaperQualityAuditCliOptions {
  sampleLimit: number;
  strict: boolean;
  output?: string;
}

export function parsePaperQualityAuditArgs(argv: string[]): PaperQualityAuditCliOptions {
  const options: PaperQualityAuditCliOptions = {
    sampleLimit: 20,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') {
      options.strict = true;
    } else if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parseNonNegativeInteger(
        arg.slice('--sample-limit='.length),
        '--sample-limit',
      );
    } else if (arg === '--output') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      options.output = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      const output = arg.slice('--output='.length).trim();
      if (!output || output.startsWith('--')) throw new Error('--output requires a path');
      options.output = output;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

export function writePaperQualityAuditOutput(report: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildPaperQualityAuditOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: PaperQualityAuditCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: PaperQualityAuditCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main() {
  const options = parsePaperQualityAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'scholarlyLinkQualityAudit',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const report = await buildPaperQualityAudit(options.sampleLimit);
  const output = buildPaperQualityAuditOutput(report, {
    environment: guard.environment,
    db: guard.dbLabel,
    options,
  });

  console.log(
    JSON.stringify(output, null, 2),
  );
  writePaperQualityAuditOutput(output, options.output);

  if (options.strict && !report.pass) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to run scholarly link quality audit:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
