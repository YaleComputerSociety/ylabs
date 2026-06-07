import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export interface ScholarlyLinkSuppressionAuditCliOptions {
  apply: boolean;
  confirmScholarlyLinkApply: boolean;
  maxApply?: number;
  sampleLimit: number;
  output?: string;
}

const htmlTitlePattern = /<[^>]+>|&(?:amp|lt|gt|quot|nbsp|#39);/i;
const htmlEntityMap: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: ' ',
  '#39': "'",
};

const BETA_COMMAND_PREFIX = 'SCRAPER_ENV=beta ';

function betaCommand(command: string): string {
  let trimmed = command.trim();
  if (!trimmed) return command;
  if (
    trimmed.includes('scholarly-links:suppression-audit') &&
    trimmed.includes('--apply') &&
    !trimmed.includes('--confirm-scholarly-link-apply')
  ) {
    trimmed = `${trimmed} --confirm-scholarly-link-apply`;
  }
  if (trimmed.startsWith(BETA_COMMAND_PREFIX)) return trimmed;
  if (trimmed.startsWith('yarn --cwd server ') || trimmed.startsWith('yarn scrape')) {
    return `${BETA_COMMAND_PREFIX}${trimmed}`;
  }
  return trimmed;
}

function cleanTitle(value: unknown): string {
  return String(value || '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/gi, (entity) => {
      const key = entity.slice(1, -1).toLowerCase();
      return htmlEntityMap[key] || ' ';
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/gi, (entity) => {
      const key = entity.slice(1, -1).toLowerCase();
      return htmlEntityMap[key] || ' ';
    })
    .replace(/<[^>]+>/g, '')
    .replace(/\s+([:;,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const datasetLikeFilter = {
  archived: { $ne: true },
  $or: [
    { venue: /mendeley data|figshare|zenodo/i },
    { url: /doi\.org\/10\.17632\//i },
    { 'externalIds.doi': /^10\.17632\//i },
    { title: /^raw data\b/i },
    { title: /^data from\b/i },
    { title: /^figure\s+s?\d+\s+from\b/i },
    { title: /\b(dataset|data set|supplementary data)\b/i },
  ],
};

const activeOwnedFilter = {
  archived: { $ne: true },
  $or: [
    { userId: { $exists: true, $ne: null } },
    { researchEntityId: { $exists: true, $ne: null } },
  ],
};

type DuplicateScholarlyLinkField = 'url' | 'externalIds.openAlexId' | 'externalIds.arxivId';

interface DuplicateScholarlyLinkGroup {
  ownerId: string;
  field: DuplicateScholarlyLinkField;
  value: string;
  count: number;
  keptLink: Record<string, unknown>;
  suppressedLinks: Record<string, unknown>[];
}

async function duplicateLoserGroups(
  field: DuplicateScholarlyLinkField,
): Promise<DuplicateScholarlyLinkGroup[]> {
  const groups = await ResearchScholarlyLink.aggregate([
    {
      $match: {
        ...activeOwnedFilter,
        [field]: { $exists: true, $nin: [null, ''] },
      },
    },
    { $sort: { confidence: -1, observedAt: -1, updatedAt: -1, _id: 1 } },
    {
      $group: {
        _id: {
          owner: { $ifNull: ['$researchEntityId', '$userId'] },
          value: `$${field}`,
        },
        links: {
          $push: {
            _id: '$_id',
            title: '$title',
            url: '$url',
            sourceUrl: '$sourceUrl',
            displaySource: '$displaySource',
            destinationKind: '$destinationKind',
            venue: '$venue',
            year: '$year',
            externalIds: '$externalIds',
            confidence: '$confidence',
          },
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  return groups.map((group: any) => {
    const links = Array.isArray(group.links) ? group.links : [];
    return {
      ownerId: String(group._id?.owner || ''),
      field,
      value: String(group._id?.value || ''),
      count: Number(group.count) || links.length,
      keptLink: links[0] || {},
      suppressedLinks: links.slice(1),
    };
  });
}

export function parseScholarlyLinkSuppressionAuditArgs(
  argv: string[],
): ScholarlyLinkSuppressionAuditCliOptions {
  const options: ScholarlyLinkSuppressionAuditCliOptions = {
    apply: false,
    confirmScholarlyLinkApply: false,
    sampleLimit: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-scholarly-link-apply') {
      options.confirmScholarlyLinkApply = true;
    } else if (arg.startsWith('--max-apply=')) {
      options.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
    } else if (arg === '--max-apply') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--max-apply requires a value');
      options.maxApply = parsePositiveInteger(next, '--max-apply');
      i += 1;
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

export function assertScholarlyLinkSuppressionAuditApplyAllowed(
  options: ScholarlyLinkSuppressionAuditCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
  plannedChanges?: number,
) {
  if (options.apply && !options.confirmScholarlyLinkApply) {
    throw new Error(
      '--confirm-scholarly-link-apply is required when --apply is set for scholarly-links:suppression-audit',
    );
  }
  if (options.apply && typeof options.maxApply !== 'number') {
    throw new Error('--max-apply is required when --apply is set for scholarly-links:suppression-audit');
  }
  if (
    options.apply &&
    typeof options.maxApply === 'number' &&
    typeof plannedChanges === 'number' &&
    plannedChanges > options.maxApply
  ) {
    throw new Error(`Apply would modify ${plannedChanges} rows, above --max-apply.`);
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'scholarlyLinkSuppressionAudit',
    mongoUrl,
    env,
  });
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

export function writeScholarlyLinkSuppressionAuditOutput(report: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildScholarlyLinkSuppressionAuditOutput(
  target: { environment: string; db: string; options?: ScholarlyLinkSuppressionAuditCliOptions },
  report: Record<string, unknown>,
  generatedAt = new Date(),
): Record<string, unknown> {
  const fixCommand = report.fixCommand;
  return {
    generatedAt: generatedAt.toISOString(),
    environment: target.environment,
    db: target.db,
    ...(target.options ? { options: target.options } : {}),
    ...report,
    ...(typeof fixCommand === 'string' && fixCommand
      ? { fixCommand: betaCommand(fixCommand) }
      : {}),
  };
}

function sampleScholarlyLink(row: any): Record<string, unknown> {
  return {
    id: String(row._id || row.id || ''),
    ...(row.title ? { title: String(row.title) } : {}),
    ...(row.url ? { url: String(row.url) } : {}),
    ...(row.sourceUrl ? { sourceUrl: String(row.sourceUrl) } : {}),
    ...(row.venue ? { venue: String(row.venue) } : {}),
    ...(row.year ? { year: row.year } : {}),
    ...(row.displaySource ? { displaySource: String(row.displaySource) } : {}),
    ...(row.destinationKind ? { destinationKind: String(row.destinationKind) } : {}),
    ...(row.externalIds ? { externalIds: row.externalIds } : {}),
    ...(row.confidence !== undefined ? { confidence: row.confidence } : {}),
  };
}

function sampleDuplicateGroup(group: DuplicateScholarlyLinkGroup, linkLimit: number) {
  return {
    ownerId: group.ownerId,
    field: group.field,
    value: group.value,
    count: group.count,
    keptLink: sampleScholarlyLink(group.keptLink),
    suppressedLinks: group.suppressedLinks.slice(0, linkLimit).map(sampleScholarlyLink),
  };
}

export function buildScholarlyLinkSuppressionAuditSamples(
  input: {
    datasetRows: any[];
    htmlTitleRows: any[];
    duplicateGroups?: DuplicateScholarlyLinkGroup[];
    duplicateLoserIds: string[];
  },
  sampleLimit: number,
): Record<string, unknown[]> {
  return {
    datasetLikeLinks: input.datasetRows.slice(0, sampleLimit).map(sampleScholarlyLink),
    htmlTitleRows: input.htmlTitleRows.slice(0, sampleLimit).map((row) => ({
      id: String(row._id || ''),
      title: String(row.title || ''),
      repairedTitle: cleanTitle(row.title),
    })),
    duplicateLinkIds: input.duplicateLoserIds.slice(0, sampleLimit).map(String),
    duplicateLinkGroups: (input.duplicateGroups || [])
      .slice(0, sampleLimit)
      .map((group) => sampleDuplicateGroup(group, sampleLimit)),
  };
}

async function main() {
  const options = parseScholarlyLinkSuppressionAuditArgs(process.argv.slice(2));
  const guard = assertScholarlyLinkSuppressionAuditApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const [datasetBefore, htmlTitleRows, duplicateUrlGroups, duplicateOpenAlexGroups, duplicateArxivGroups] =
    await Promise.all([
      ResearchScholarlyLink.countDocuments(datasetLikeFilter),
      ResearchScholarlyLink.find({
        archived: { $ne: true },
        title: htmlTitlePattern,
      })
        .select('_id title')
        .lean(),
      duplicateLoserGroups('url'),
      duplicateLoserGroups('externalIds.openAlexId'),
      duplicateLoserGroups('externalIds.arxivId'),
    ]);
  const duplicateGroups = [...duplicateUrlGroups, ...duplicateOpenAlexGroups, ...duplicateArxivGroups];
  const duplicateLosers = Array.from(
    new Set(
      duplicateGroups.flatMap((group) =>
        group.suppressedLinks.map((link) => String(link._id || link.id || '')),
      ),
    ),
  ).filter(Boolean);
  const plannedChanges = datasetBefore + duplicateLosers.length + htmlTitleRows.length;
  assertScholarlyLinkSuppressionAuditApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
    plannedChanges,
  );
  const datasetSamples =
    options.sampleLimit > 0
      ? await ResearchScholarlyLink.find(datasetLikeFilter)
          .select('_id title url venue year displaySource destinationKind externalIds')
          .limit(options.sampleLimit)
          .lean()
      : [];
  const samples =
    options.sampleLimit > 0
      ? buildScholarlyLinkSuppressionAuditSamples(
          {
            datasetRows: datasetSamples,
            htmlTitleRows,
            duplicateGroups,
            duplicateLoserIds: duplicateLosers,
          },
          options.sampleLimit,
        )
      : [];

  let datasetSuppressed = 0;
  let duplicateSuppressed = 0;
  let titlesRepaired = 0;
  if (options.apply && datasetBefore > 0) {
    const result = await ResearchScholarlyLink.updateMany(datasetLikeFilter, {
      $set: {
        archived: true,
        archivedReason: 'not_public_research_paper_activity',
        archivedAt: new Date(),
      },
    });
    datasetSuppressed = result.modifiedCount || 0;
  }

  if (options.apply && duplicateLosers.length > 0) {
    const result = await ResearchScholarlyLink.updateMany(
      { _id: { $in: duplicateLosers } },
      {
        $set: {
          archived: true,
          archivedReason: 'duplicate_scholarly_link_for_owner',
          archivedAt: new Date(),
        },
      },
    );
    duplicateSuppressed = result.modifiedCount || 0;
  }

  if (options.apply && htmlTitleRows.length > 0) {
    for (const row of htmlTitleRows as any[]) {
      const title = cleanTitle(row.title);
      if (!title || title === row.title) continue;
      const result = await ResearchScholarlyLink.updateOne(
        { _id: row._id, archived: { $ne: true } },
        { $set: { title } },
      );
      titlesRepaired += result.modifiedCount || 0;
    }
  }

  const [datasetAfter, htmlTitleAfter, duplicateUrlAfter, duplicateOpenAlexAfter, duplicateArxivAfter] =
    await Promise.all([
      ResearchScholarlyLink.countDocuments(datasetLikeFilter),
      ResearchScholarlyLink.countDocuments({
        archived: { $ne: true },
        title: htmlTitlePattern,
      }),
      duplicateLoserGroups('url'),
      duplicateLoserGroups('externalIds.openAlexId'),
      duplicateLoserGroups('externalIds.arxivId'),
    ]);

  const report = buildScholarlyLinkSuppressionAuditOutput(
    {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    },
    {
      mode: options.apply ? 'apply' : 'dry-run',
      rule: 'scholarly_link_public_activity_quality',
      counts: {
        datasetSuppressibleBefore: datasetBefore,
        datasetSuppressed,
        datasetSuppressibleAfter: datasetAfter,
        htmlTitlesBefore: htmlTitleRows.length,
        htmlTitlesRepaired: titlesRepaired,
        htmlTitlesAfter: htmlTitleAfter,
        duplicateLinksBefore: duplicateLosers.length,
        duplicateLinksSuppressed: duplicateSuppressed,
        duplicateLinksAfter: new Set(
          [...duplicateUrlAfter, ...duplicateOpenAlexAfter, ...duplicateArxivAfter].flatMap(
            (group) => group.suppressedLinks.map((link) => String(link._id || link.id || '')),
          ),
        ).size,
      },
      action: 'repair_titles_and_suppress_non_public_or_duplicate_activity',
      fixCommand:
        (datasetBefore > 0 || htmlTitleRows.length > 0 || duplicateLosers.length > 0) &&
        !options.apply
          ? `yarn --cwd server scholarly-links:suppression-audit --apply --max-apply=${plannedChanges} --confirm-scholarly-link-apply`
          : '',
      samples,
    },
  );

  console.log(JSON.stringify(report, null, 2));
  writeScholarlyLinkSuppressionAuditOutput(report, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to run scholarly link suppression audit:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
