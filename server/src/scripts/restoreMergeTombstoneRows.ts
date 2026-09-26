import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { walkResearchEntityTombstoneChain } from '../services/researchEntityCanonicalTombstone';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  buildMergeTombstoneRestorePlan,
  tombstoneNameFromSlug,
  type ExistingRowProbe,
  type MergeRedirectRecord,
  type MergeTombstonePlan,
} from './restoreMergeTombstoneRowsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'restore-merge-tombstone-rows';
const REDIRECTS_COLLECTION = 'research_entity_redirects';

export interface RestoreMergeTombstoneRowsOptions {
  apply: boolean;
  confirm: boolean;
  limit?: number;
  output?: string;
}

export function parseRestoreMergeTombstoneRowsArgs(
  argv: string[],
): RestoreMergeTombstoneRowsOptions {
  const options: RestoreMergeTombstoneRowsOptions = { apply: false, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-merge-tombstone-restore') options.confirm = true;
    else if (arg === '--limit') {
      options.limit = Number.parseInt(argv[i + 1] ?? '', 10);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number.parseInt(arg.slice('--limit='.length), 10);
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    throw new Error(`${SCRIPT_NAME} --limit requires a positive integer`);
  }
  return options;
}

/**
 * Reads the retired `research_entity_redirects` collection through the raw driver
 * rather than a Mongoose model, because the model is deleted (#3027) while the
 * collection survives until an explicit drop. This migration has to outlive the
 * model it reads: that is the whole point of it.
 */
async function loadRedirects(): Promise<MergeRedirectRecord[]> {
  const db = mongoose.connection.db;
  if (!db) return [];
  const names = await db.listCollections({ name: REDIRECTS_COLLECTION }).toArray();
  if (names.length === 0) return [];
  const rows = (await db
    .collection(REDIRECTS_COLLECTION)
    .find({})
    .project({ mergedSlug: 1, mergedEntityId: 1, canonicalEntityId: 1, reason: 1 })
    .toArray()) as Array<{
    mergedSlug?: string;
    mergedEntityId?: mongoose.Types.ObjectId;
    canonicalEntityId?: mongoose.Types.ObjectId;
    reason?: string;
  }>;
  return rows.map((row) => ({
    ...(row.mergedSlug ? { mergedSlug: row.mergedSlug } : {}),
    ...(row.mergedEntityId ? { mergedEntityId: String(row.mergedEntityId) } : {}),
    ...(row.canonicalEntityId ? { canonicalEntityId: String(row.canonicalEntityId) } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  }));
}

async function probeRowsBySlug(slugs: string[]): Promise<Map<string, ExistingRowProbe>> {
  const rows = await ResearchEntity.find({ slug: { $in: slugs } })
    .select('_id slug archived canonicalGroupId')
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        slug: string;
        archived?: boolean;
        canonicalGroupId?: mongoose.Types.ObjectId | null;
      }>
    >();
  return new Map(
    rows.map((row) => [
      row.slug,
      {
        id: String(row._id),
        archived: row.archived === true,
        ...(row.canonicalGroupId ? { canonicalGroupId: String(row.canonicalGroupId) } : {}),
      },
    ]),
  );
}

async function probeFreeIds(ids: string[]): Promise<Set<string>> {
  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (objectIds.length === 0) return new Set();
  const taken = await ResearchEntity.find({ _id: { $in: objectIds } })
    .select('_id')
    .lean<Array<{ _id: mongoose.Types.ObjectId }>>();
  const takenSet = new Set(taken.map((row) => String(row._id)));
  return new Set(ids.filter((id) => !takenSet.has(id)));
}

/**
 * Walks from the redirect's recorded `canonicalEntityId`, which can itself be an
 * archived row that was later merged onward, so a single hop is not enough.
 */
async function resolveLiveCanonicalIds(
  redirects: MergeRedirectRecord[],
): Promise<Map<string, string>> {
  const findById = async (id: string) => {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return (await ResearchEntity.findOne({ _id: new mongoose.Types.ObjectId(id) }).lean()) as {
      _id: mongoose.Types.ObjectId;
      archived?: boolean;
      canonicalGroupId?: mongoose.Types.ObjectId | null;
    } | null;
  };

  const resolved = new Map<string, string>();
  for (const redirect of redirects) {
    const key = redirect.mergedSlug ?? '';
    if (!key || resolved.has(key) || !redirect.canonicalEntityId) continue;
    const seed = await findById(redirect.canonicalEntityId);
    if (!seed) continue;
    if (seed.archived !== true) {
      resolved.set(key, String(seed._id));
      continue;
    }
    const canonical = await walkResearchEntityTombstoneChain(seed, { findById });
    if (canonical?._id) resolved.set(key, String(canonical._id));
  }
  return resolved;
}

async function applyPlan(plan: MergeTombstonePlan): Promise<void> {
  const canonicalGroupId = new mongoose.Types.ObjectId(plan.canonicalEntityId);

  if (plan.action === 'stamp_missing_tombstone' && plan.existingRowId) {
    await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(plan.existingRowId) },
      { $set: { canonicalGroupId, archived: true } },
      { runValidators: true },
    );
    return;
  }

  await ResearchEntity.create({
    ...(plan.restoreEntityId ? { _id: new mongoose.Types.ObjectId(plan.restoreEntityId) } : {}),
    slug: plan.mergedSlug,
    name: tombstoneNameFromSlug(plan.mergedSlug),
    archived: true,
    canonicalGroupId,
  });
}

export async function runRestoreMergeTombstoneRows(
  options: RestoreMergeTombstoneRowsOptions,
): Promise<number> {
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });

  if (options.apply && !options.confirm) {
    throw new Error(
      `${SCRIPT_NAME} apply requires --confirm-merge-tombstone-restore. Mongo target: ${guard.dbLabel}.`,
    );
  }

  await initializeConnections();

  const redirects = await loadRedirects();
  const slugs = redirects.map((redirect) => redirect.mergedSlug ?? '').filter(Boolean);
  const mergedIds = redirects
    .map((redirect) => redirect.mergedEntityId ?? '')
    .filter(Boolean) as string[];

  const [rowsBySlug, freeIds, liveCanonicalIds] = await Promise.all([
    probeRowsBySlug(slugs),
    probeFreeIds(mergedIds),
    resolveLiveCanonicalIds(redirects),
  ]);

  const summary = buildMergeTombstoneRestorePlan({
    redirects,
    probes: {
      rowBySlug: (slug) => rowsBySlug.get(slug),
      idIsFree: (id) => freeIds.has(id),
      liveCanonicalIdFor: (redirect) => liveCanonicalIds.get(redirect.mergedSlug ?? ''),
    },
  });

  const plannedTotal = summary.plans.length;
  const selected =
    options.limit === undefined ? summary.plans : summary.plans.slice(0, options.limit);

  let applied = 0;
  const failures: Array<{ mergedSlug: string; error: string }> = [];
  if (options.apply) {
    for (const plan of selected) {
      try {
        await applyPlan(plan);
        applied += 1;
      } catch (error) {
        failures.push({
          mergedSlug: plan.mergedSlug,
          error: sanitizeLogValue(error instanceof Error ? error.message : String(error)),
        });
      }
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    database: guard.dbLabel,
    scanned: summary.scanned,
    plannedTotal,
    selectedForWrite: selected.length,
    applied,
    plannedByAction: summary.plannedByAction,
    skippedByReason: summary.skippedByReason,
    failures,
  };

  if (options.output) {
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
  return failures.length > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (invokedDirectly) {
  runRestoreMergeTombstoneRows(parseRestoreMergeTombstoneRowsArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(String(error)));
      process.exit(1);
    });
}
