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
 * The leaked seeds are derived from the live observations, not hard-coded, so
 * the script self-scopes to exactly what leaked. A seed value is stripped from
 * a member only when the member's own (non-center) observations do not
 * independently assert it - a genuine Neuroscience-department member keeps
 * "Neuroscience"; a Computer Science member has it removed. A second pass
 * catches the case where a PI-dedupe merge folded a `faculty-research-area-*`
 * shell straight into an existing canonical entity (e.g. an `nih-pi-*` shell),
 * copying the leaked departments array by value with no observation ever
 * recorded under the survivor's own entityKey - those are matched by value
 * against the known leaked seed forms instead.
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
 * Read every `departments` observation the center-institutes scraper ever
 * emitted onto a member's own `faculty-research-area-*` entity, keyed by that
 * entity's slug. Includes already-superseded observations - a first backfill
 * run retires them, and matching by entityKey (rather than by re-deriving the
 * leaked sourceUrl from non-superseded observations) keeps a second run able
 * to find the same leaks and keeps the entity-matching independent of whether
 * the entity's own `sourceUrls` field happens to include the leaking page.
 */
async function deriveLeakedSeedsByEntityKey(): Promise<Map<string, string[]>> {
  const leakObs = await Observation.find({
    entityKey: { $regex: `^${FACULTY_RESEARCH_AREA_KEY_PREFIX}` },
    field: 'departments',
    sourceName: CENTER_SOURCE_NAME,
  })
    .select('entityKey value')
    .lean();

  const seedsByKey = new Map<string, Set<string>>();
  for (const obs of leakObs as Array<{ entityKey?: unknown; value?: unknown }>) {
    const key = typeof obs.entityKey === 'string' ? obs.entityKey : '';
    if (!key) continue;
    const values = asStringArray(obs.value);
    const bucket = seedsByKey.get(key) || new Set<string>();
    for (const form of expandLeakedSeedForms(values)) bucket.add(form);
    seedsByKey.set(key, bucket);
  }
  return new Map([...seedsByKey].map(([key, set]) => [key, [...set]]));
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

  const seedsByEntityKey = await deriveLeakedSeedsByEntityKey();
  const leakedEntityKeys = [...seedsByEntityKey.keys()];

  const affected: any[] = leakedEntityKeys.length
    ? await ResearchEntity.find({
        slug: { $in: leakedEntityKeys },
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
    const leakedForms = seedsByEntityKey.get(slug) || [];
    if (leakedForms.length === 0) continue;

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

  // A PI-dedupe merge can fold a `faculty-research-area-*` shell straight into
  // an existing canonical entity (a pre-existing `nih-pi-*`/`nsf-pi-*` shell),
  // copying the shell's raw `departments` array onto the survivor by value
  // with no observation ever recorded under the survivor's own entityKey.
  // Catch that residue, but only on an EXACT match of the full leaked array -
  // matching on any single overlapping token (e.g. "Computer Science" alone)
  // would misfire on every unrelated entity that legitimately belongs to one
  // of the same real departments the institute also spans.
  const rawLeakObs = await Observation.find({
    entityKey: { $regex: `^${FACULTY_RESEARCH_AREA_KEY_PREFIX}` },
    field: 'departments',
    sourceName: CENTER_SOURCE_NAME,
  })
    .select('value')
    .lean();
  const rawSeedGroups = new Set<string>();
  for (const obs of rawLeakObs as Array<{ value?: unknown }>) {
    const rawSeed = asStringArray(obs.value);
    if (rawSeed.length > 0) rawSeedGroups.add(JSON.stringify([...rawSeed].sort()));
  }

  // Punctuation for the same seed can drift between the scraper's literal
  // config string and the materialized entity (e.g. an Oxford comma), so the
  // exact-match check below compares normalized token sets rather than raw
  // strings. `$size` alone is enough of a DB-side pre-filter; the real
  // equality check happens in JS against the fetched candidates.
  const seedGroups: string[][] = [...rawSeedGroups].map((g) => JSON.parse(g));
  const candidateLengths = [...new Set(seedGroups.map((g) => g.length))];
  const alreadyCovered = new Set([...leakedEntityKeys, ...affected.map((e) => String(e.slug))]);
  const residualCandidates: any[] = [];
  for (const length of candidateLengths) {
    const normalizedGroupsOfLength = seedGroups
      .filter((g) => g.length === length)
      .map((g) => new Set(g.map(normalizeDeptToken)));
    const candidates = await ResearchEntity.find({
      slug: { $not: /^center-/ },
      archived: { $ne: true },
      departments: { $size: length },
    })
      .select({ slug: 1, name: 1, kind: 1, departments: 1, researchAreas: 1 })
      .lean();
    for (const candidate of candidates) {
      const slug = String(candidate.slug);
      if (alreadyCovered.has(slug)) continue;
      const docNormalized = new Set(asStringArray(candidate.departments).map(normalizeDeptToken));
      const exactMatch = normalizedGroupsOfLength.some(
        (group) => group.size === docNormalized.size && [...group].every((t) => docNormalized.has(t)),
      );
      if (!exactMatch) continue;
      alreadyCovered.add(slug);
      residualCandidates.push(candidate);
    }
  }

  const residualSlugs = residualCandidates.map((e) => String(e.slug)).filter(Boolean);
  const residualOwnDeptBySlug = await ownObservedValuesBySlug(residualSlugs, 'departments');
  const residualOwnAreaBySlug = await ownObservedValuesBySlug(residualSlugs, 'researchAreas');
  const allLeakedForms = expandLeakedSeedForms(
    [...rawSeedGroups].flatMap((g) => JSON.parse(g) as string[]),
  );

  for (const entity of residualCandidates) {
    const slug = String(entity.slug);
    const currentDepts = asStringArray(entity.departments);
    const currentAreas = asStringArray(entity.researchAreas);

    const deptResult = stripUncorroboratedLeak({
      current: currentDepts,
      ownObserved: [...(residualOwnDeptBySlug.get(slug) || [])],
      leaked: allLeakedForms,
    });
    const areaResult = stripUncorroboratedLeak({
      current: currentAreas,
      ownObserved: [...(residualOwnAreaBySlug.get(slug) || [])],
      leaked: allLeakedForms,
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
    leakedEntityKeys: leakedEntityKeys.length,
    scannedAffected: affected.length + residualCandidates.length,
    residualValueMatchedAffected: residualCandidates.length,
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
