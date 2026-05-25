import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import { User } from '../models/user';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { buildObservationFingerprint } from '../scrapers/observationStore';
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
  acceptedLeadsPath?: string;
}

export interface AcceptedLeadMapping {
  slug: string;
  netid: string;
  sourceUrl: string;
  note?: string;
}

export function buildTrustTierMissingLeadsFilter(): Record<string, unknown> {
  return {
    archived: { $ne: true },
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: {
      $all: ['source_backed_description', 'concrete_next_step', 'missing_lead'],
    },
    $or: [{ kind: 'lab' }, { entityType: 'LAB' }],
  };
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
      continue;
    }
    if (arg.startsWith('--accepted-leads=')) {
      const value = arg.slice('--accepted-leads='.length).trim();
      if (value) options.acceptedLeadsPath = value;
    }
  }

  return options;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current.trim());
  return out;
}

function normalizeAcceptedLeadMapping(raw: Record<string, unknown>): AcceptedLeadMapping | null {
  const slug = String(raw.slug || '').trim();
  const netid = String(raw.netid || '').trim();
  const sourceUrl = String(raw.sourceUrl || raw.source_url || '').trim();
  const note = String(raw.note || raw.reason || '').trim();
  if (!slug || !netid || !/^https?:\/\//i.test(sourceUrl)) return null;
  return { slug, netid, sourceUrl, note: note || undefined };
}

export function parseAcceptedLeadMappings(text: string): AcceptedLeadMapping[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => normalizeAcceptedLeadMapping(item as Record<string, unknown>))
        .filter((item): item is AcceptedLeadMapping => item !== null);
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).leads)) {
      return (parsed as any).leads
        .map((item: unknown) => normalizeAcceptedLeadMapping(item as Record<string, unknown>))
        .filter((item: AcceptedLeadMapping | null): item is AcceptedLeadMapping => item !== null);
    }
  } catch {
    /* fall through to CSV */
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const hasHeader = header.includes('slug') && header.includes('netid');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const indexFor = (name: string, fallback: number) =>
    hasHeader ? header.indexOf(name.toLowerCase()) : fallback;
  const slugIndex = indexFor('slug', 0);
  const netidIndex = indexFor('netid', 1);
  const sourceUrlIndex =
    hasHeader && header.includes('source_url')
      ? header.indexOf('source_url')
      : indexFor('sourceurl', 2);
  const noteIndex = hasHeader ? Math.max(header.indexOf('note'), header.indexOf('reason')) : 3;

  return dataLines
    .map((line) => {
      const values = parseCsvLine(line);
      return normalizeAcceptedLeadMapping({
        slug: values[slugIndex],
        netid: values[netidIndex],
        sourceUrl: values[sourceUrlIndex],
        note: noteIndex >= 0 ? values[noteIndex] : undefined,
      });
    })
    .filter((item): item is AcceptedLeadMapping => item !== null);
}

async function readAcceptedLeadMappings(
  acceptedLeadsPath: string | undefined,
): Promise<AcceptedLeadMapping[]> {
  if (!acceptedLeadsPath) return [];
  const text = await fs.readFile(path.resolve(acceptedLeadsPath), 'utf8');
  return parseAcceptedLeadMappings(text);
}

async function candidateSlugs(
  options: RepairCliOptions,
  acceptedLeads: AcceptedLeadMapping[] = [],
): Promise<string[]> {
  if (options.slug) return [options.slug];
  if (acceptedLeads.length > 0) {
    return Array.from(new Set(acceptedLeads.map((item) => item.slug).filter(Boolean)));
  }
  if (options.trustTierMissingLeads) {
    const docs = await ResearchEntity.find(buildTrustTierMissingLeadsFilter())
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

async function sourceForAcceptedLeads(): Promise<{
  _id: unknown;
  name: string;
  defaultWeight: number;
}> {
  const source = await Source.findOne({ name: 'manual-admin-edit' })
    .select('_id name defaultWeight')
    .lean();
  if (!source?._id) {
    throw new Error('Source manual-admin-edit not found; run scrape:seed-sources first.');
  }
  return {
    _id: source._id,
    name: String((source as any).name || 'manual-admin-edit'),
    defaultWeight: Number((source as any).defaultWeight) || 1,
  };
}

async function createAcceptedLeadRun(
  source: { _id: unknown; name: string },
  options: RepairCliOptions,
  acceptedLeads: AcceptedLeadMapping[],
): Promise<any> {
  return ScrapeRun.create({
    sourceId: source._id,
    sourceName: source.name,
    triggeredBy: 'cli',
    startedAt: new Date(),
    status: 'running',
    options: {
      script: 'research-entity:coverage-repair',
      acceptedLeadsPath: options.acceptedLeadsPath || null,
      acceptedLeadCount: acceptedLeads.length,
      trustTierMissingLeads: options.trustTierMissingLeads,
    },
  });
}

async function writeAcceptedLeadObservation(args: {
  mapping: AcceptedLeadMapping;
  run: any;
  source: { _id: unknown; name: string; defaultWeight: number };
}): Promise<Record<string, unknown>> {
  const entity = (await ResearchEntity.findOne({
    ...buildTrustTierMissingLeadsFilter(),
    slug: args.mapping.slug,
  })
    .select('_id slug name')
    .lean()) as any;
  if (!entity?._id) {
    return {
      slug: args.mapping.slug,
      acceptedLead: false,
      skipped: 'not-current-missing-lead-lab',
    };
  }

  const user = (await User.findOne({ netid: args.mapping.netid })
    .select('_id netid fname lname email')
    .lean()) as any;
  if (!user?._id) {
    return {
      slug: args.mapping.slug,
      netid: args.mapping.netid,
      acceptedLead: false,
      skipped: 'user-not-found',
    };
  }

  const value = String(user._id);
  const fingerprint = buildObservationFingerprint({
    sourceName: args.source.name,
    entityType: 'researchEntity',
    entityId: entity._id,
    entityKey: entity.slug,
    field: 'inferredPiUserId',
    value,
  });
  const existing = fingerprint
    ? await Observation.findOne({ observationFingerprint: fingerprint, superseded: false })
        .select('_id')
        .lean()
    : null;
  if (existing?._id) {
    return {
      slug: args.mapping.slug,
      netid: args.mapping.netid,
      acceptedLead: true,
      inserted: false,
      skipped: 'active-observation-exists',
    };
  }

  await Observation.create({
    entityType: 'researchEntity',
    entityId: entity._id,
    entityKey: entity.slug,
    field: 'inferredPiUserId',
    value,
    sourceId: args.source._id,
    sourceName: args.source.name,
    sourceUrl: args.mapping.sourceUrl,
    confidence: Math.min(1, args.source.defaultWeight),
    observedAt: new Date(),
    superseded: false,
    observationFingerprint: fingerprint,
    scrapeRunId: args.run._id,
  });

  return {
    slug: args.mapping.slug,
    netid: args.mapping.netid,
    userId: value,
    acceptedLead: true,
    inserted: true,
    sourceUrl: args.mapping.sourceUrl,
  };
}

async function main(): Promise<void> {
  const options = parseResearchEntityCoverageRepairArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:coverage-repair',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const acceptedLeads = await readAcceptedLeadMappings(options.acceptedLeadsPath);
  const acceptedLeadsBySlug = new Map<string, AcceptedLeadMapping[]>();
  for (const item of acceptedLeads) {
    const existing = acceptedLeadsBySlug.get(item.slug) || [];
    existing.push(item);
    acceptedLeadsBySlug.set(item.slug, existing);
  }
  const slugs = await candidateSlugs(options, acceptedLeads);
  const beforeDetails = await detailRowsForSlugs(slugs);
  const beforeRows = beforeDetails
    .map((detail) => detail.row)
    .filter((row): row is CoverageAuditRow => !!row);

  const repairs: Array<Record<string, unknown>> = [];
  let acceptedLeadRun: any | null = null;
  let acceptedLeadSource: Awaited<ReturnType<typeof sourceForAcceptedLeads>> | null = null;
  let insertedAcceptedLeadObservations = 0;
  if (options.apply) {
    if (acceptedLeads.length > 0) {
      acceptedLeadSource = await sourceForAcceptedLeads();
      acceptedLeadRun = await createAcceptedLeadRun(acceptedLeadSource, options, acceptedLeads);
    }
    for (const slug of slugs) {
      const acceptedLeadMappings = acceptedLeadsBySlug.get(slug) || [];
      const acceptedLeadResults: Array<Record<string, unknown>> = [];
      if (acceptedLeadMappings.length > 0 && acceptedLeadRun && acceptedLeadSource) {
        for (const acceptedLead of acceptedLeadMappings) {
          const acceptedLeadResult = await writeAcceptedLeadObservation({
            mapping: acceptedLead,
            run: acceptedLeadRun,
            source: acceptedLeadSource,
          });
          acceptedLeadResults.push(acceptedLeadResult);
          if (acceptedLeadResult.inserted === true) insertedAcceptedLeadObservations++;
        }
      }
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
        acceptedLeads: acceptedLeadResults,
        repaired: true,
        fieldsWritten: result.fieldsWritten,
        conflicts: result.conflicts,
        created: result.created,
        postMaterializationMetrics: result.postMaterializationMetrics || null,
        skipped: result.skipped,
      });
    }
    if (acceptedLeadRun) {
      await ScrapeRun.updateOne(
        { _id: acceptedLeadRun._id },
        {
          $set: {
            finishedAt: new Date(),
            status: 'success',
            observationCount: insertedAcceptedLeadObservations,
            entitiesObserved: insertedAcceptedLeadObservations,
          },
        },
      );
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
          acceptedLeadsPath: options.acceptedLeadsPath || null,
        },
        acceptedLeads: acceptedLeads.map((item) => ({
          slug: item.slug,
          netid: item.netid,
          sourceUrl: item.sourceUrl,
          note: item.note || null,
        })),
        acceptedLeadRunId: acceptedLeadRun?._id ? String(acceptedLeadRun._id) : null,
        insertedAcceptedLeadObservations,
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
