/**
 * Backfill for the center-seed department/researchArea leak (#1055).
 *
 * A legacy `centers-institutes-index` scraper run emitted each institute's
 * spanning `departments` seed (Wu Tsai Institute -> Neuroscience/Psychology/MCDB,
 * Yale Quantum Institute -> Physics/Applied Physics/CS/EE) onto every member's
 * own `faculty-research-area-*` entity. Those values then unioned into merged
 * survivors' `departments` (and, via synthesis, `researchAreas`), polluting the
 * student-facing department facets and "best fit" chips on /research. The
 * current scraper no longer emits member departments, so the fix is to (a) strip
 * the uncorroborated seed values from the affected member entities and (b) retire
 * the legacy observations so a future re-materialize cannot re-inject them.
 *
 * The leaked (sourceUrl -> seed) pairs are derived from the live observations,
 * not hard-coded, so the script self-scopes to exactly what leaked. A seed value
 * is stripped from a member only when the member's own (non-center) observations
 * do not independently assert it - a genuine Neuroscience-department member keeps
 * "Neuroscience"; a Computer Science member has it removed.
 *
 * Dry-run by default. Apply requires `--apply --confirm-center-seed-department-backfill`.
 *
 *   yarn --cwd server tsx src/scripts/backfillCenterSeedDepartmentLeak.ts            # dry-run
 *   yarn --cwd server tsx src/scripts/backfillCenterSeedDepartmentLeak.ts --apply \
 *     --confirm-center-seed-department-backfill
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose, { type AnyBulkWriteOperation } from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  expandLeakedSeedForms,
  normalizeDeptToken,
  stripUncorroboratedLeak,
} from './backfillCenterSeedDepartmentLeakCore';

dotenv.config();

const CENTER_SOURCE_NAME = 'centers-institutes-index';
const FACULTY_RESEARCH_AREA_KEY_PREFIX = 'faculty-research-area-';

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-center-seed-department-backfill') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-center-seed-department-backfill is required when --apply is set.');
  }
  return options;
}

interface PlannedUpdate {
  slug: string;
  name: unknown;
  kind: unknown;
  departments?: { from: string[]; to: string[]; removed: string[] };
  researchAreas?: { from: string[]; to: string[]; removed: string[] };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Read the live legacy observations to learn which center people-pages leaked a
 * `departments` seed and what that seed was, keyed by sourceUrl.
 */
async function deriveLeakedSeedsByUrl(): Promise<Map<string, string[]>> {
  const leakObs = await Observation.find({
    entityKey: { $regex: `^${FACULTY_RESEARCH_AREA_KEY_PREFIX}` },
    field: 'departments',
    sourceName: CENTER_SOURCE_NAME,
    superseded: { $ne: true },
  })
    .select('value sourceUrl')
    .lean();

  const seedsByUrl = new Map<string, Set<string>>();
  for (const obs of leakObs as Array<{ value?: unknown; sourceUrl?: unknown }>) {
    const url = typeof obs.sourceUrl === 'string' ? obs.sourceUrl : '';
    if (!url) continue;
    const values = asStringArray(obs.value);
    const bucket = seedsByUrl.get(url) || new Set<string>();
    for (const form of expandLeakedSeedForms(values)) bucket.add(form);
    seedsByUrl.set(url, bucket);
  }
  return new Map([...seedsByUrl].map(([url, set]) => [url, [...set]]));
}

async function ownObservedValuesBySlug(
  slugs: string[],
  field: string,
): Promise<Map<string, Set<string>>> {
  const bySlug = new Map<string, Set<string>>();
  if (slugs.length === 0) return bySlug;
  const obs = await Observation.find({
    entityKey: { $in: slugs },
    field,
    sourceName: { $ne: CENTER_SOURCE_NAME },
    superseded: { $ne: true },
  })
    .select('entityKey value')
    .lean();
  for (const o of obs as Array<{ entityKey?: unknown; value?: unknown }>) {
    const key = typeof o.entityKey === 'string' ? o.entityKey : '';
    if (!key) continue;
    const set = bySlug.get(key) || new Set<string>();
    for (const value of asStringArray(o.value)) set.add(normalizeDeptToken(value));
    bySlug.set(key, set);
  }
  return bySlug;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillCenterSeedDepartmentLeak',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const seedsByUrl = await deriveLeakedSeedsByUrl();
  const leakedUrls = [...seedsByUrl.keys()];

  const affected: any[] = leakedUrls.length
    ? await ResearchEntity.find({
        sourceUrls: { $in: leakedUrls },
        slug: { $not: /^center-/ },
        archived: { $ne: true },
      })
        .select({ slug: 1, name: 1, kind: 1, departments: 1, researchAreas: 1, sourceUrls: 1 })
        .lean()
    : [];

  const slugs = affected.map((e) => String(e.slug)).filter(Boolean);
  const ownDeptBySlug = await ownObservedValuesBySlug(slugs, 'departments');
  const ownAreaBySlug = await ownObservedValuesBySlug(slugs, 'researchAreas');

  const plannedUpdates: PlannedUpdate[] = [];
  for (const entity of affected) {
    const slug = String(entity.slug);
    const entitySourceUrls = asStringArray(entity.sourceUrls);
    const leaked = new Set<string>();
    for (const url of entitySourceUrls) {
      const seeds = seedsByUrl.get(url);
      if (seeds) for (const seed of seeds) leaked.add(seed);
    }
    if (leaked.size === 0) continue;
    const leakedForms = [...leaked];

    const currentDepts = asStringArray(entity.departments);
    const currentAreas = asStringArray(entity.researchAreas);

    const deptResult = stripUncorroboratedLeak({
      current: currentDepts,
      ownObserved: [...(ownDeptBySlug.get(slug) || [])],
      leaked: leakedForms,
    });
    const areaResult = stripUncorroboratedLeak({
      current: currentAreas,
      ownObserved: [...(ownAreaBySlug.get(slug) || [])],
      leaked: leakedForms,
    });

    if (!deptResult.changed && !areaResult.changed) continue;
    plannedUpdates.push({
      slug,
      name: entity.name,
      kind: entity.kind,
      ...(deptResult.changed
        ? { departments: { from: currentDepts, to: deptResult.cleaned, removed: deptResult.removed } }
        : {}),
      ...(areaResult.changed
        ? { researchAreas: { from: currentAreas, to: areaResult.cleaned, removed: areaResult.removed } }
        : {}),
    });
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    leakedSourceUrls: leakedUrls,
    scannedAffected: affected.length,
    entitiesChanged: plannedUpdates.length,
    departmentsCleaned: plannedUpdates.filter((u) => u.departments).length,
    researchAreasCleaned: plannedUpdates.filter((u) => u.researchAreas).length,
    legacyObservationsRetired: 0,
    reindexed: 0,
  };

  if (options.apply && plannedUpdates.length > 0) {
    const operations: AnyBulkWriteOperation[] = plannedUpdates.map((u) => {
      const set: Record<string, unknown> = {};
      if (u.departments) set.departments = u.departments.to;
      if (u.researchAreas) set.researchAreas = u.researchAreas.to;
      return { updateOne: { filter: { slug: u.slug }, update: { $set: set } } };
    });
    await ResearchEntity.bulkWrite(operations, { ordered: false });

    const retire = await Observation.updateMany(
      {
        entityKey: { $regex: `^${FACULTY_RESEARCH_AREA_KEY_PREFIX}` },
        field: 'departments',
        sourceName: CENTER_SOURCE_NAME,
        superseded: { $ne: true },
      },
      { $set: { superseded: true } },
    );
    summary.legacyObservationsRetired = retire.modifiedCount ?? 0;

    const changedSlugs = plannedUpdates.map((u) => u.slug);
    const fresh = await ResearchEntity.find({ slug: { $in: changedSlugs } }).lean();
    await syncEntities('researchEntity', fresh);
    summary.reindexed = fresh.length;
  }

  const output = { summary, entries: plannedUpdates };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill center-seed department leak:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
