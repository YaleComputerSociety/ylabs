import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  AUDITED_ROSTER_SOURCE,
  buildResearchHomeRosterAudit,
} from './researchHomeRosterAuditCore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface Options {
  strict: boolean;
  sampleLimit: number;
  sampledPrecisionReviewed: boolean;
  output?: string;
}

export function parseResearchHomeRosterAuditArgs(argv: string[]): Options {
  const options: Options = {
    strict: false,
    sampleLimit: 25,
    sampledPrecisionReviewed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--sampled-precision-reviewed') options.sampledPrecisionReviewed = true;
    else if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = Number(arg.slice('--sample-limit='.length));
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown research-home roster audit argument: ${arg}`);
    }
  }
  if (!Number.isSafeInteger(options.sampleLimit) || options.sampleLimit < 0 || options.sampleLimit > 100) {
    throw new Error('--sample-limit must be an integer from 0 to 100');
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseResearchHomeRosterAuditArgs(process.argv.slice(2));
  if (!process.env.MONGODBURL) throw new Error('MONGODBURL is required');
  await mongoose.connect(process.env.MONGODBURL);
  try {
    const rows = await ResearchGroupMember.find({ sourceName: AUDITED_ROSTER_SOURCE })
      .select(
        'researchEntityId name title role sourceName sourceUrl profileUrl identityKey membershipKey evidenceStatus isCurrentMember archived lastObservedAt freshnessExpiresAt',
      )
      .sort({ researchEntityId: 1, role: 1, name: 1 })
      .lean();
    const report = buildResearchHomeRosterAudit(rows, {
      sampleLimit: options.sampleLimit,
      sampledPrecisionReviewed: options.sampledPrecisionReviewed,
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, json);
    }
    process.stdout.write(json);
    if (options.strict && !report.broadEnablementReady) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1]?.endsWith('researchHomeRosterAudit.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
