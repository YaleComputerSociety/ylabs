import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { isDisallowedResearchEntitySourceUrl } from '../utils/researchHomeWebsiteUrl';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export interface StripLegacyListingSourceUrlsCliOptions {
  apply: boolean;
  confirmStripLegacyListingSources: boolean;
  limit: number;
  output?: string;
}

interface PlannedStrip {
  researchEntityId: string;
  label: string;
  removedSourceUrls: string[];
  remainingSourceUrlCount: number;
  clearedWebsiteUrl?: string;
}

interface OrphanRiskEntity {
  researchEntityId: string;
  label: string;
  matchedSourceUrls: string[];
}

interface PlannedStripResult {
  strips: PlannedStrip[];
  orphanRisks: OrphanRiskEntity[];
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

export function parseStripLegacyListingSourceUrlsArgs(
  argv: string[],
): StripLegacyListingSourceUrlsCliOptions {
  const options: StripLegacyListingSourceUrlsCliOptions = {
    apply: false,
    confirmStripLegacyListingSources: false,
    limit: Infinity,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-strip-legacy-listing-sources') {
      options.confirmStripLegacyListingSources = true;
    } else if (arg.startsWith('--confirm-strip-legacy-listing-sources=')) {
      throw new Error('--confirm-strip-legacy-listing-sources does not accept a value');
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

export function writeStripLegacyListingSourceUrlsOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function assertStripLegacyListingSourceUrlsApplyAllowed(
  options: StripLegacyListingSourceUrlsCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (options.apply && !options.confirmStripLegacyListingSources) {
    throw new Error(
      '--confirm-strip-legacy-listing-sources is required when --apply is set for stripLegacyListingSourceUrls.',
    );
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'stripLegacyListingSourceUrls',
    mongoUrl,
    env,
  });
}

function entityLabel(entity: {
  displayName?: unknown;
  name?: unknown;
  slug?: unknown;
  researchEntityId: string;
}): string {
  return (
    (typeof entity.displayName === 'string' && entity.displayName) ||
    (typeof entity.name === 'string' && entity.name) ||
    (typeof entity.slug === 'string' && entity.slug) ||
    entity.researchEntityId
  );
}

export function planLegacyListingSourceUrlStrips(
  entities: Array<{
    _id: unknown;
    sourceUrls?: unknown;
    websiteUrl?: unknown;
    displayName?: unknown;
    name?: unknown;
    slug?: unknown;
  }>,
): PlannedStripResult {
  const strips: PlannedStrip[] = [];
  const orphanRisks: OrphanRiskEntity[] = [];
  for (const entity of entities) {
    const researchEntityId = serializedDocumentId(entity._id) || '';
    const label = entityLabel({ ...entity, researchEntityId });
    const sourceUrls = Array.isArray(entity.sourceUrls) ? (entity.sourceUrls as string[]) : [];
    const matchedSourceUrls = sourceUrls.filter((url) => isDisallowedResearchEntitySourceUrl(url));
    const clearedWebsiteUrl = isDisallowedResearchEntitySourceUrl(entity.websiteUrl)
      ? (entity.websiteUrl as string)
      : undefined;

    if (matchedSourceUrls.length === 0) {
      if (clearedWebsiteUrl) {
        strips.push({
          researchEntityId,
          label,
          removedSourceUrls: [],
          remainingSourceUrlCount: sourceUrls.length,
          clearedWebsiteUrl,
        });
      }
      continue;
    }

    const remainingSourceUrls = sourceUrls.filter(
      (url) => !isDisallowedResearchEntitySourceUrl(url),
    );
    if (remainingSourceUrls.length === 0) {
      orphanRisks.push({ researchEntityId, label, matchedSourceUrls });
      continue;
    }

    strips.push({
      researchEntityId,
      label,
      removedSourceUrls: matchedSourceUrls,
      remainingSourceUrlCount: remainingSourceUrls.length,
      ...(clearedWebsiteUrl ? { clearedWebsiteUrl } : {}),
    });
  }
  return { strips, orphanRisks };
}

async function loadCandidateEntities(limit: number) {
  const query = ResearchEntity.find({
    $or: [{ sourceUrls: { $exists: true, $ne: [] } }, { websiteUrl: { $exists: true, $ne: '' } }],
  })
    .select('sourceUrls websiteUrl displayName name slug')
    .sort({ updatedAt: -1 });
  if (Number.isFinite(limit)) query.limit(limit);
  return query.lean();
}

async function applyStrips(strips: PlannedStrip[]) {
  for (const strip of strips) {
    if (!strip.researchEntityId) continue;
    const update: Record<string, unknown> = {};
    if (strip.removedSourceUrls.length > 0) {
      update.$pull = { sourceUrls: { $in: strip.removedSourceUrls } };
    }
    if (strip.clearedWebsiteUrl) {
      update.$unset = { websiteUrl: '' };
    }
    if (Object.keys(update).length === 0) continue;
    await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(strip.researchEntityId) },
      update,
    );
  }
}

async function main() {
  const options = parseStripLegacyListingSourceUrlsArgs(process.argv.slice(2));
  const guard = assertStripLegacyListingSourceUrlsApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const entities = await loadCandidateEntities(options.limit);
  const { strips, orphanRisks } = planLegacyListingSourceUrlStrips(entities as any[]);
  if (options.apply) await applyStrips(strips);

  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scannedEntities: entities.length,
    affectedEntities: strips.length,
    removedSourceRows: strips.reduce((acc, strip) => acc + strip.removedSourceUrls.length, 0),
    clearedWebsiteUrls: strips.filter((strip) => strip.clearedWebsiteUrl).length,
    orphanRiskEntities: orphanRisks.length,
    samples: strips.slice(0, 20),
    orphanRiskSamples: orphanRisks.slice(0, 20),
    options,
  };

  console.log(JSON.stringify(report, null, 2));
  writeStripLegacyListingSourceUrlsOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to strip legacy listing source URLs:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
