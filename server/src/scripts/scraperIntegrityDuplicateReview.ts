import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { mkdirSync, writeFileSync } from 'fs';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { Paper } from '../models/paper';
import {
  buildDuplicateAccessSignalGroupsFromRows,
  buildDuplicateResearchPaperGroupsFromRows,
  type DuplicateAccessSignalGroup,
  type DuplicateResearchPaperGroup,
} from '../scrapers/integrityGate';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export type ScraperIntegrityDuplicateReviewType = 'all' | 'research-papers' | 'access-signals';

export interface ScraperIntegrityDuplicateReviewArgs {
  type: ScraperIntegrityDuplicateReviewType;
  limit: number;
  output?: string;
}

export interface ScraperIntegrityDuplicateReviewReport {
  generatedAt?: string;
  environment?: string;
  db?: string;
  options?: ScraperIntegrityDuplicateReviewArgs;
  mode: 'dry-run';
  applyBlocked: true;
  applyBlocker: string;
  limit: number;
  counts: {
    duplicateResearchPapers: number;
    duplicateAccessSignals: number;
  };
  groups: {
    duplicateResearchPapers: DuplicateResearchPaperGroup[];
    duplicateAccessSignals: DuplicateAccessSignalGroup[];
  };
  recommendedNextSteps: string[];
}

const APPLY_BLOCKER =
  'This command is read-only. Review duplicate identities and design a targeted guarded merge/archive path before any write.';

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

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseType(value: string): ScraperIntegrityDuplicateReviewType {
  if (value === 'all' || value === 'research-papers' || value === 'access-signals') {
    return value;
  }
  throw new Error('--type must be one of all, research-papers, or access-signals');
}

export function parseScraperIntegrityDuplicateReviewArgs(
  argv: string[],
): ScraperIntegrityDuplicateReviewArgs {
  const options: ScraperIntegrityDuplicateReviewArgs = {
    type: 'all',
    limit: 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--type' || arg.startsWith('--type=')) {
      const { value: typeValue, nextIndex } = consumeValue(argv, index, '--type');
      options.type = parseType(typeValue);
      index = nextIndex;
      continue;
    }

    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const { value: limitValue, nextIndex } = consumeValue(argv, index, '--limit');
      options.limit = parsePositiveInteger(limitValue, '--limit');
      index = nextIndex;
      continue;
    }

    if (arg === '--output' || arg.startsWith('--output=')) {
      const { value: outputValue, nextIndex } = consumeValue(argv, index, '--output');
      options.output = resolveSafeJsonReportOutputPath(outputValue);
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function writeScraperIntegrityDuplicateReviewOutput(
  value: unknown,
  output?: string,
): void {
  if (!output) return;
  const resolvedOutput = resolveSafeJsonReportOutputPath(output);
  mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildScraperIntegrityDuplicateReviewReport(
  input: {
    duplicateResearchPaperGroups?: DuplicateResearchPaperGroup[];
    duplicateAccessSignalGroups?: DuplicateAccessSignalGroup[];
  },
  metadata: {
    generatedAt?: string;
    environment?: string;
    db?: string;
    options?: ScraperIntegrityDuplicateReviewArgs;
    limit: number;
  },
): ScraperIntegrityDuplicateReviewReport {
  const duplicateResearchPaperGroups = (input.duplicateResearchPaperGroups || []).slice(
    0,
    metadata.limit,
  );
  const duplicateAccessSignalGroups = (input.duplicateAccessSignalGroups || []).slice(
    0,
    metadata.limit,
  );

  return {
    ...(metadata.generatedAt ? { generatedAt: metadata.generatedAt } : {}),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    ...(metadata.options ? { options: metadata.options } : {}),
    mode: 'dry-run',
    applyBlocked: true,
    applyBlocker: APPLY_BLOCKER,
    limit: metadata.limit,
    counts: {
      duplicateResearchPapers: duplicateResearchPaperGroups.length,
      duplicateAccessSignals: duplicateAccessSignalGroups.length,
    },
    groups: {
      duplicateResearchPapers: duplicateResearchPaperGroups,
      duplicateAccessSignals: duplicateAccessSignalGroups,
    },
    recommendedNextSteps: [
      'Use this artifact to review duplicate identity groups before designing a targeted repair.',
      'Do not archive, merge, or relink papers or access signals without an accepted guarded repair plan.',
    ],
  };
}

async function loadDuplicateResearchPaperReviewGroups(
  limit: number,
): Promise<DuplicateResearchPaperGroup[]> {
  const fields: DuplicateResearchPaperGroup['identityField'][] = [
    'openAlexId',
    'semanticScholarId',
    'arxivId',
    'doi',
  ];
  const groups: DuplicateResearchPaperGroup[] = [];

  for (const field of fields) {
    const rows = await Paper.aggregate([
      {
        $match: {
          archived: { $ne: true },
          [field]: { $exists: true, $nin: [null, ''] },
        },
      },
      {
        $project: {
          identityValue: { $toString: `$${field}` },
          paperId: { $toString: '$_id' },
        },
      },
      { $match: { identityValue: { $nin: ['', 'null', 'undefined'] } } },
      {
        $group: {
          _id: '$identityValue',
          paperIds: { $addToSet: '$paperId' },
        },
      },
      { $match: { 'paperIds.1': { $exists: true } } },
      { $limit: Math.max(1, limit - groups.length) },
    ]);

    groups.push(
      ...buildDuplicateResearchPaperGroupsFromRows(
        rows.map((row: any) => ({
          identityField: field,
          identityValue: row._id,
          paperIds: row.paperIds || [],
        })),
      ),
    );
    if (groups.length >= limit) return groups.slice(0, limit);
  }

  return groups;
}

async function loadDuplicateAccessSignalReviewGroups(
  limit: number,
): Promise<DuplicateAccessSignalGroup[]> {
  const fields: DuplicateAccessSignalGroup['identityField'][] = [
    'derivationKey',
    'sourceEvidenceId',
    'observationId',
  ];
  const groups: DuplicateAccessSignalGroup[] = [];

  for (const field of fields) {
    const rows = await AccessSignal.aggregate([
      {
        $match: {
          archived: { $ne: true },
          researchEntityId: { $exists: true, $ne: null },
          signalType: { $exists: true, $ne: '' },
          [field]: { $exists: true, $ne: null },
        },
      },
      {
        $project: {
          researchEntityId: { $toString: '$researchEntityId' },
          signalType: '$signalType',
          identityValue: { $toString: `$${field}` },
          signalId: { $toString: '$_id' },
        },
      },
      { $match: { identityValue: { $nin: ['', 'null', 'undefined'] } } },
      {
        $group: {
          _id: {
            researchEntityId: '$researchEntityId',
            signalType: '$signalType',
            identityValue: '$identityValue',
          },
          signalIds: { $addToSet: '$signalId' },
        },
      },
      { $match: { 'signalIds.1': { $exists: true } } },
      { $limit: Math.max(1, limit - groups.length) },
    ]);

    groups.push(
      ...buildDuplicateAccessSignalGroupsFromRows(
        rows.map((row: any) => ({
          researchEntityId: row._id?.researchEntityId,
          signalType: row._id?.signalType,
          identityField: field,
          identityValue: row._id?.identityValue,
          signalIds: row.signalIds || [],
        })),
      ),
    );
    if (groups.length >= limit) return groups.slice(0, limit);
  }

  return groups;
}

async function main(): Promise<void> {
  const options = parseScraperIntegrityDuplicateReviewArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'scraperIntegrityDuplicateReview',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const [duplicateResearchPaperGroups, duplicateAccessSignalGroups] = await Promise.all([
    options.type === 'access-signals'
      ? Promise.resolve([])
      : loadDuplicateResearchPaperReviewGroups(options.limit),
    options.type === 'research-papers'
      ? Promise.resolve([])
      : loadDuplicateAccessSignalReviewGroups(options.limit),
  ]);
  const report = buildScraperIntegrityDuplicateReviewReport(
    {
      duplicateResearchPaperGroups,
      duplicateAccessSignalGroups,
    },
    {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options,
      limit: options.limit,
    },
  );

  writeScraperIntegrityDuplicateReviewOutput(report, options.output);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to run scraper integrity duplicate review:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
