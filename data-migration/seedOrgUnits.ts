import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OrgUnit } from '../server/src/models/orgUnit';
import {
  buildOrgUnitResolverIndex,
  isDroppedAdministrativeOrgUnit,
  resolveOrgUnitCanonical,
} from '../server/src/scrapers/orgUnitCanonicalization';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from '../server/src/scripts/scriptWriteGuards';
import { buildOrgUnitSeedRows, validateOrgUnitRows, type OrgUnitSeedRow } from './orgUnitGroundTruth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

export interface OrgUnitSeedCliOptions {
  apply: boolean;
  confirmSeedApply?: boolean;
  output?: string;
}

interface OrgUnitDiffSummary {
  creates: number;
  updates: number;
  archives: number;
  unchanged: number;
}

interface OrgUnitSeedApplyResult {
  upsertedCount: number;
  modifiedCount: number;
  parentLinksSet: number;
  archivedCount: number;
}

interface UnresolvedOrgUnitAuditSource {
  label: string;
  kind: 'school' | 'department';
  unresolvedCount: number;
  distinctValueCount: number;
  samples: string[];
}

interface UnresolvedOrgUnitAuditSummary {
  totalUnresolved: number;
  sources: UnresolvedOrgUnitAuditSource[];
}

export function parseOrgUnitSeedArgs(argv: string[]): OrgUnitSeedCliOptions {
  const options: OrgUnitSeedCliOptions = { apply: false };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    const output = value?.trim();
    if (!output || output.startsWith('--')) throw new Error('--output requires a path');
    return output;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--live') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-seed-apply') {
      options.confirmSeedApply = true;
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown org-unit seed argument: ${arg}`);
  }

  return options;
}

export function assertOrgUnitSeedApplyAllowed(args: {
  apply: boolean;
  confirmSeedApply?: boolean;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScriptApplyGuardResult {
  if (args.apply && !args.confirmSeedApply) {
    throw new Error('--confirm-seed-apply is required when --apply is set for org-unit seed');
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'org-unit ground-truth seed',
    mongoUrl: args.mongoUrl,
    env: args.env,
  });
}

export interface OrgUnitDiff {
  creates: OrgUnitSeedRow[];
  updates: Array<{ before: any; after: OrgUnitSeedRow }>;
  archives: any[];
  unchanged: OrgUnitSeedRow[];
}

function comparableRow(row: Partial<OrgUnitSeedRow>): Record<string, unknown> {
  return {
    name: row.name,
    kind: row.kind,
    aliases: [...(row.aliases || [])].sort(),
    parentSlug: row.parentSlug ?? null,
    status: row.status ?? 'ACTIVE',
    archived: row.archived === true,
  };
}

export function diffOrgUnitRows(existingRows: any[], targetRows: OrgUnitSeedRow[]): OrgUnitDiff {
  const existingBySlug = new Map(existingRows.map((row) => [row.slug, row]));
  const targetBySlug = new Map(targetRows.map((row) => [row.slug, row]));
  const diff: OrgUnitDiff = { creates: [], updates: [], archives: [], unchanged: [] };

  for (const target of targetRows) {
    const existing = existingBySlug.get(target.slug);
    if (!existing) {
      diff.creates.push(target);
      continue;
    }
    const existingParentSlug =
      existing.parentOrgUnitId && existingBySlug.size
        ? existingRows.find((row) => String(row._id) === String(existing.parentOrgUnitId))?.slug ??
          null
        : null;
    const before = { ...comparableRow(existing), parentSlug: existingParentSlug };
    if (JSON.stringify(before) === JSON.stringify(comparableRow(target))) {
      diff.unchanged.push(target);
    } else {
      diff.updates.push({ before: existing, after: target });
    }
  }

  for (const existing of existingRows) {
    if (existing?.archived === true) continue;
    if (existing?.slug && !targetBySlug.has(existing.slug)) diff.archives.push(existing);
  }

  return diff;
}

export function buildOrgUnitSeedOutput<T extends object>(
  result: T,
  metadata: {
    generatedAt?: string;
    environment?: string;
    db?: string;
    options: OrgUnitSeedCliOptions;
  },
): T & {
  generatedAt: string;
  environment?: string;
  db?: string;
  options: OrgUnitSeedCliOptions;
} {
  return {
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
    ...result,
  };
}

function writeOrgUnitSeedOutput(result: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

function showRows(label: string, rows: any[], formatter: (row: any) => string): void {
  console.log(`${label}: ${rows.length}`);
  for (const row of rows.slice(0, 20)) console.log(`  - ${formatter(row)}`);
  if (rows.length > 20) console.log(`  ... ${rows.length - 20} more`);
}

async function distinctStrings(collectionName: string, field: string): Promise<string[]> {
  const db = mongoose.connection.db;
  if (!db) return [];
  try {
    const values = await db.collection(collectionName).distinct(field);
    return values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
  } catch (error: any) {
    if (error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

async function auditUnresolvedOrgUnitStrings(
  targetRows: OrgUnitSeedRow[],
): Promise<UnresolvedOrgUnitAuditSummary> {
  const index = buildOrgUnitResolverIndex(targetRows);
  const sources: Array<{ label: string; collection: string; field: string; kind: 'school' | 'department' }> = [
    { label: 'research_entities.school', collection: 'research_entities', field: 'school', kind: 'school' },
    { label: 'research_entities.departments', collection: 'research_entities', field: 'departments', kind: 'department' },
  ];

  console.log('\n=== OrgUnit String Audit ===');
  let totalUnresolved = 0;
  const summaries: UnresolvedOrgUnitAuditSource[] = [];

  for (const source of sources) {
    const values = await distinctStrings(source.collection, source.field);
    const kinds = source.kind === 'school' ? (['SCHOOL', 'DIVISION'] as const) : (['DEPARTMENT', 'DIVISION', 'OFFICE'] as const);
    const unresolved = values.filter(
      (value) =>
        !resolveOrgUnitCanonical(index, value, [...kinds]) &&
        !(source.kind === 'department' && isDroppedAdministrativeOrgUnit(value)),
    );
    totalUnresolved += unresolved.length;
    summaries.push({
      label: source.label,
      kind: source.kind,
      unresolvedCount: unresolved.length,
      distinctValueCount: values.length,
      samples: unresolved.slice(0, 20),
    });
    console.log(`${source.label}: ${unresolved.length} unresolved of ${values.length} distinct value(s)`);
    for (const value of unresolved.slice(0, 20)) console.log(`  - ${value}`);
    if (unresolved.length > 20) console.log(`  ... ${unresolved.length - 20} more`);
  }

  if (totalUnresolved === 0) {
    console.log('All audited school/department strings resolve to a canonical OrgUnit name or alias.');
  }

  return { totalUnresolved, sources: summaries };
}

async function applyOrgUnitRows(
  targetRows: OrgUnitSeedRow[],
  archiveRows: any[],
): Promise<OrgUnitSeedApplyResult> {
  const bulkOps = targetRows.map((row) => ({
    updateOne: {
      filter: { slug: row.slug },
      update: {
        $set: {
          name: row.name,
          kind: row.kind,
          aliases: row.aliases,
          status: row.status,
          archived: row.archived,
        },
      },
      upsert: true,
    },
  }));

  let upsertedCount = 0;
  let modifiedCount = 0;
  if (bulkOps.length > 0) {
    const result = await OrgUnit.bulkWrite(bulkOps);
    upsertedCount = result.upsertedCount;
    modifiedCount = result.modifiedCount;
    console.log(`Applied upserts: ${result.upsertedCount} inserted, ${result.modifiedCount} modified`);
  }

  const idBySlug = new Map<string, mongoose.Types.ObjectId>();
  const seeded = await OrgUnit.find({ slug: { $in: targetRows.map((row) => row.slug) } })
    .select({ slug: 1 })
    .lean<Array<{ _id: mongoose.Types.ObjectId; slug: string }>>();
  for (const row of seeded) idBySlug.set(row.slug, row._id);

  let parentLinksSet = 0;
  for (const row of targetRows) {
    const parentId = row.parentSlug ? idBySlug.get(row.parentSlug) : undefined;
    const selfId = idBySlug.get(row.slug);
    if (!selfId) continue;
    const update = parentId
      ? { $set: { parentOrgUnitId: parentId } }
      : { $unset: { parentOrgUnitId: '' } };
    const result = await OrgUnit.updateOne({ _id: selfId }, update);
    if (result.modifiedCount > 0 && parentId) parentLinksSet += 1;
  }
  console.log(`Parent links set: ${parentLinksSet}`);

  let archivedCount = 0;
  if (archiveRows.length > 0) {
    const slugs = archiveRows.map((row) => row.slug).filter(Boolean);
    const result = await OrgUnit.updateMany(
      { slug: { $in: slugs } },
      { $set: { archived: true, status: 'INACTIVE' } },
    );
    archivedCount = result.modifiedCount;
    console.log(`Archived stale org units: ${result.modifiedCount}`);
  }

  return { upsertedCount, modifiedCount, parentLinksSet, archivedCount };
}

async function main(): Promise<void> {
  const options = parseOrgUnitSeedArgs(process.argv.slice(2));
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set in server/.env');
    process.exit(1);
  }
  const guard = assertOrgUnitSeedApplyAllowed({
    apply: options.apply,
    confirmSeedApply: options.confirmSeedApply,
    mongoUrl: url,
  });

  console.log('\n=== OrgUnit Ground Truth Seed ===');
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);

  const targetRows = buildOrgUnitSeedRows();
  const errors = validateOrgUnitRows(targetRows);
  if (errors.length > 0) {
    throw new Error(`OrgUnit ground truth validation failed:\n${errors.join('\n')}`);
  }
  console.log(`Curated org units: ${targetRows.length}`);

  await mongoose.connect(url);
  const existing = await OrgUnit.find({}).lean<any[]>();
  const diff = diffOrgUnitRows(existing, targetRows);
  const diffSummary: OrgUnitDiffSummary = {
    creates: diff.creates.length,
    updates: diff.updates.length,
    archives: diff.archives.length,
    unchanged: diff.unchanged.length,
  };

  console.log('\n=== Mongo Diff ===');
  showRows('Creates', diff.creates, (row) => `${row.kind} ${row.slug}`);
  showRows('Updates', diff.updates, (row) => `${row.after.kind} ${row.after.slug}`);
  showRows('Stale active rows to archive', diff.archives, (row) => row.slug);
  console.log(`Unchanged: ${diff.unchanged.length}`);

  let applyResult: OrgUnitSeedApplyResult | undefined;
  if (options.apply) {
    applyResult = await applyOrgUnitRows(targetRows, diff.archives);
  } else {
    console.log('\nDry run only. Re-run with --apply --confirm-seed-apply to write org units.');
  }

  const unresolvedOrgUnitAudit = await auditUnresolvedOrgUnitStrings(targetRows);
  const output = buildOrgUnitSeedOutput(
    {
      mode: options.apply ? 'apply' : 'dry-run',
      curatedOrgUnits: targetRows.length,
      diffSummary,
      diffSamples: {
        creates: diff.creates.slice(0, 20).map((row) => ({ slug: row.slug, kind: row.kind })),
        updates: diff.updates.slice(0, 20).map((row) => ({ slug: row.after.slug, kind: row.after.kind })),
        archives: diff.archives.slice(0, 20).map((row) => ({ slug: row.slug })),
      },
      ...(applyResult ? { applyResult } : {}),
      unresolvedOrgUnitAudit,
    },
    {
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options,
    },
  );
  writeOrgUnitSeedOutput(output, options.output);
  await mongoose.disconnect();
  console.log('\n=== OrgUnit Ground Truth Seed Complete ===\n');
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isDirectRun) {
  main().catch(async (err) => {
    console.error('Fatal error:', err);
    await mongoose.disconnect();
    process.exit(1);
  });
}
