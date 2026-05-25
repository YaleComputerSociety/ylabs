import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { buildBulkAudit, buildSlugAudit } from './researchEntityCoverageAudit';
import type { CoverageAuditRow } from './researchEntityCoverageAuditCore';
import {
  parseIssueList,
  selectRepairRows,
  summarizeRepairRows,
} from './researchEntityCoverageRepairCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface RepairCliOptions {
  slug?: string;
  limit: number;
  minScore: number;
  includeArchived: boolean;
  apply: boolean;
  syncMeili: boolean;
  issues: string[];
  trustTierMissingLeads: boolean;
}

export function parseResearchEntityCoverageRepairArgs(argv: string[]): RepairCliOptions {
  const options: RepairCliOptions = {
    limit: 50,
    minScore: 8,
    includeArchived: false,
    apply: false,
    syncMeili: false,
    issues: parseIssueList(),
    trustTierMissingLeads: false,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--include-archived') {
      options.includeArchived = true;
      continue;
    }
    if (arg === '--sync-meili') {
      options.syncMeili = true;
      continue;
    }
    if (arg === '--trust-tier-missing-leads') {
      options.trustTierMissingLeads = true;
      continue;
    }
    if (arg.startsWith('--slug=')) {
      const value = arg.slice('--slug='.length).trim();
      if (value) options.slug = value;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.limit = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith('--min-score=')) {
      const parsed = Number(arg.slice('--min-score='.length));
      if (Number.isFinite(parsed) && parsed >= 0) options.minScore = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith('--issues=')) {
      options.issues = parseIssueList(arg.slice('--issues='.length));
    }
  }

  return options;
}

async function candidateSlugs(options: RepairCliOptions): Promise<string[]> {
  if (options.slug) return [options.slug];
  if (options.trustTierMissingLeads) {
    const docs = await ResearchEntity.find({
      archived: { $ne: true },
      studentVisibilityTier: 'operator_review',
      studentVisibilityReasons: {
        $all: ['source_backed_description', 'concrete_next_step', 'missing_lead'],
      },
    })
      .select('slug')
      .sort({ name: 1, slug: 1 })
      .limit(options.limit)
      .lean();

    return docs.map((doc: any) => doc.slug).filter(Boolean);
  }

  const audit = await buildBulkAudit({
    limit: options.limit,
    minScore: options.minScore,
    includeArchived: options.includeArchived,
    includeAll: false,
  });

  return selectRepairRows(audit.rows, options.issues).map((row) => row.slug);
}

type FoundSlugAudit = Awaited<ReturnType<typeof buildSlugAudit>> & {
  found: true;
  row: CoverageAuditRow;
};

async function detailRowsForSlugs(slugs: string[]): Promise<FoundSlugAudit[]> {
  const rows = await Promise.all(slugs.map((slug) => buildSlugAudit(slug)));
  return rows.filter((row): row is FoundSlugAudit => row.found === true && !!row.row);
}

async function main(): Promise<void> {
  const options = parseResearchEntityCoverageRepairArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:coverage-repair',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const slugs = await candidateSlugs(options);
  const beforeDetails = await detailRowsForSlugs(slugs);
  const beforeRows = beforeDetails
    .map((detail) => detail.row)
    .filter((row): row is CoverageAuditRow => !!row);

  const repairs: Array<Record<string, unknown>> = [];
  if (options.apply) {
    for (const slug of slugs) {
      const entityDoc = (await ResearchEntity.findOne({ slug }).select('_id slug').lean()) as
        | {
            _id?: unknown;
            slug?: string;
          }
        | Array<{
            _id?: unknown;
            slug?: string;
          }>
        | null;
      const entity = Array.isArray(entityDoc) ? entityDoc[0] || null : entityDoc;
      if (!entity?._id) {
        repairs.push({ slug, repaired: false, skipped: 'entity-not-found' });
        continue;
      }
      const result = await materializeEntity(
        'researchEntity',
        {
          entityId: String(entity._id),
          entityKey: slug,
        },
        {
          dryRun: false,
          syncMeilisearch: options.syncMeili,
        },
      );
      repairs.push({
        slug,
        repaired: true,
        fieldsWritten: result.fieldsWritten,
        conflicts: result.conflicts,
        created: result.created,
        postMaterializationMetrics: result.postMaterializationMetrics || null,
        skipped: result.skipped,
      });
    }
  }

  const afterDetails = options.apply ? await detailRowsForSlugs(slugs) : beforeDetails;
  const afterRows = afterDetails
    .map((detail) => detail.row)
    .filter((row): row is CoverageAuditRow => !!row);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apply: options.apply,
        filters: {
          slug: options.slug || null,
          limit: options.limit,
          minScore: options.minScore,
          includeArchived: options.includeArchived,
          syncMeili: options.syncMeili,
          issues: options.issues,
          trustTierMissingLeads: options.trustTierMissingLeads,
        },
        before: summarizeRepairRows(beforeRows),
        after: summarizeRepairRows(afterRows),
        repairs,
        rows: afterRows,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
