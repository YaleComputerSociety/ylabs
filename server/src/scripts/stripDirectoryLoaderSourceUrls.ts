import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { isDirectoryLoaderUrl } from '../utils/researchHomeWebsiteUrl';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export interface StripDirectoryLoaderSourceUrlsCliOptions {
  apply: boolean;
  confirmStripDirectoryLoaderSources: boolean;
  limit: number;
  output?: string;
}

interface PlannedStrip {
  researchEntityId: string;
  label: string;
  removed: string[];
  remainingCount: number;
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

function parseRequiredOutputPath(value: string | undefined): string {
  return resolveSafeJsonReportOutputPath(value);
}

export function parseStripDirectoryLoaderSourceUrlsArgs(
  argv: string[],
): StripDirectoryLoaderSourceUrlsCliOptions {
  const options: StripDirectoryLoaderSourceUrlsCliOptions = {
    apply: false,
    confirmStripDirectoryLoaderSources: false,
    limit: Infinity,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-strip-directory-loader-sources') {
      options.confirmStripDirectoryLoaderSources = true;
    } else if (arg.startsWith('--confirm-strip-directory-loader-sources=')) {
      throw new Error('--confirm-strip-directory-loader-sources does not accept a value');
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function writeStripDirectoryLoaderSourceUrlsOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function assertStripDirectoryLoaderSourceUrlsApplyAllowed(
  options: StripDirectoryLoaderSourceUrlsCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (options.apply && !options.confirmStripDirectoryLoaderSources) {
    throw new Error(
      '--confirm-strip-directory-loader-sources is required when --apply is set for stripDirectoryLoaderSourceUrls.',
    );
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'stripDirectoryLoaderSourceUrls',
    mongoUrl,
    env,
  });
}

export function planDirectoryLoaderSourceStrips(
  entities: Array<{ _id: unknown; sourceUrls?: unknown; displayName?: unknown; name?: unknown; slug?: unknown }>,
): PlannedStrip[] {
  const strips: PlannedStrip[] = [];
  for (const entity of entities) {
    if (!Array.isArray(entity.sourceUrls)) continue;
    const removed = entity.sourceUrls.filter((url) => isDirectoryLoaderUrl(url)) as string[];
    if (removed.length === 0) continue;
    const remaining = entity.sourceUrls.filter((url) => !isDirectoryLoaderUrl(url));
    const researchEntityId = serializedDocumentId(entity._id) || '';
    strips.push({
      researchEntityId,
      label:
        (typeof entity.displayName === 'string' && entity.displayName) ||
        (typeof entity.name === 'string' && entity.name) ||
        (typeof entity.slug === 'string' && entity.slug) ||
        researchEntityId,
      removed,
      remainingCount: remaining.length,
    });
  }
  return strips;
}

async function loadCandidateEntities(limit: number) {
  const query = ResearchEntity.find({
    sourceUrls: { $exists: true, $ne: [] },
  })
    .select('sourceUrls displayName name slug')
    .sort({ updatedAt: -1 });
  if (Number.isFinite(limit)) query.limit(limit);
  return query.lean();
}

async function applyStrips(strips: PlannedStrip[]) {
  for (const strip of strips) {
    if (!strip.researchEntityId) continue;
    await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(strip.researchEntityId) },
      { $pull: { sourceUrls: { $in: strip.removed } } },
    );
  }
}

async function main() {
  const options = parseStripDirectoryLoaderSourceUrlsArgs(process.argv.slice(2));
  const guard = assertStripDirectoryLoaderSourceUrlsApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const entities = await loadCandidateEntities(options.limit);
  const strips = planDirectoryLoaderSourceStrips(entities as any[]);
  if (options.apply) await applyStrips(strips);

  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scannedEntities: entities.length,
    affectedEntities: strips.length,
    removedSourceRows: strips.reduce((acc, strip) => acc + strip.removed.length, 0),
    samples: strips.slice(0, 20),
    options,
  };

  console.log(JSON.stringify(report, null, 2));
  writeStripDirectoryLoaderSourceUrlsOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to strip directory-loader source URLs:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
