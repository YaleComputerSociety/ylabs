import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  resolveBackfillWebsiteUrl,
  type WebsiteUrlBackfillCandidateEntity,
} from './backfillResearchEntityWebsiteUrlsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const PROFILE_PAGE_WEBSITE_URL_PATTERN =
  /(\/profile\/|\/people\/|\/person\/|\/faculty\/|\/faculty-directory\/|\/directory\/faculty\/|\/who-we-are\/faculty\/)/i;

export const LISTING_PAGE_WEBSITE_URL_PATTERN =
  /(a-to-z-index|a-z-index|lab-websites|[?&]page=\d|\/people(\/faculty)?\/?($|\?)|\/people\.(html?|aspx|php)|\/members\/?($|\?)|\/faculty\/?($|\?)|\/(faculty-directory|directory)\/?($|\?))/i;

export interface ResearchEntityWebsiteUrlBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  output?: string;
}

export function parseResearchEntityWebsiteUrlBackfillArgs(
  argv: string[],
): ResearchEntityWebsiteUrlBackfillOptions {
  const options: ResearchEntityWebsiteUrlBackfillOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-research-entity-website-urls') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown backfill:research-entity-website-urls argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

export function assertResearchEntityWebsiteUrlApplyAllowed(
  options: Pick<ResearchEntityWebsiteUrlBackfillOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-research-entity-website-urls.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface ResearchEntityWebsiteUrlBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  resolved: number;
  cleared: number;
  updated: number;
  unresolved: number;
  errors: number;
  samples: Array<{ slug: string; from: string; websiteUrl: string; action: 'set' | 'clear' }>;
}

export async function runResearchEntityWebsiteUrlBackfill(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<ResearchEntityWebsiteUrlBackfillResult> {
  const entities = await ResearchEntity.find(
    {
      archived: { $ne: true },
      $or: [
        { websiteUrl: { $exists: false } },
        { websiteUrl: { $in: ['', null] } },
        { websiteUrl: { $not: /^https?:\/\//i } },
        { websiteUrl: PROFILE_PAGE_WEBSITE_URL_PATTERN },
        { websiteUrl: LISTING_PAGE_WEBSITE_URL_PATTERN },
      ],
    },
    { _id: 1, slug: 1, name: 1, websiteUrl: 1, website: 1, sourceUrls: 1 },
  ).lean();

  const result: ResearchEntityWebsiteUrlBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    resolved: 0,
    cleared: 0,
    updated: 0,
    unresolved: 0,
    errors: 0,
    samples: [],
  };

  for (const entity of entities as Array<
    Record<string, unknown> & WebsiteUrlBackfillCandidateEntity
  >) {
    if (options.limit && result.scanned >= options.limit) break;
    result.scanned += 1;
    try {
      const resolution = resolveBackfillWebsiteUrl(entity);
      if (resolution.action === 'keep') {
        result.unresolved += 1;
        continue;
      }
      const nextWebsiteUrl = resolution.action === 'set' ? resolution.websiteUrl : '';
      if (resolution.action === 'set') result.resolved += 1;
      else result.cleared += 1;
      if (result.samples.length < 25) {
        result.samples.push({
          slug: String(entity.slug ?? ''),
          from: String(entity.websiteUrl ?? ''),
          websiteUrl: nextWebsiteUrl,
          action: resolution.action,
        });
      }
      if (!options.dryRun) {
        await ResearchEntity.updateOne(
          { _id: entity._id },
          { $set: { websiteUrl: nextWebsiteUrl } },
        );
      }
      result.updated += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `research-entity website-url backfill failed for ${String(entity.slug ?? entity._id)}:`,
        sanitizeLogValue(error),
      );
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseResearchEntityWebsiteUrlBackfillArgs(process.argv.slice(2));
  assertResearchEntityWebsiteUrlApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfill:research-entity-website-urls',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runResearchEntityWebsiteUrlBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved research-entity website-url backfill report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
