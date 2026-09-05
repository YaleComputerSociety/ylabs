/**
 * Read-only category split for observation `entityKey`s that resolve to neither a
 * research entity slug nor a merge redirect (issue #2383). Writes nothing but its
 * report.
 *
 * The join is against `research_entity_redirects.mergedSlug`, which is the field
 * the schema and `researchEntityMergeRedirectService` actually use. #2383's
 * original sizing joined a field name that does not exist in this repository, so
 * the redirect table contributed nothing and every redirect-covered key was
 * counted as an orphan. Reproducing that inflated 1508 keys / 14592 observations
 * to 1931 / 20172 on Development.
 *
 * Only Development stores observations, so this reports 0 against Beta and
 * Production by corpus rather than by structure.
 *
 * Usage:
 *   yarn --cwd server observations:audit-orphan-keys --output "$TMPDIR/orphan-keys.json"
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRedirect } from '../models/researchEntityRedirect';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { Source } from '../models/source';
import { ScrapeRun } from '../models/scrapeRun';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  classifyOrphanObservationKey,
  identityCandidatesForOrphanKey,
  identityCandidatesForPersonName,
  identityCandidatesForSlug,
  summarizeOrphanObservationKeys,
  type OrphanObservationKeyClassification,
} from './orphanObservationKeyAuditCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MINT_INTENT_OBSERVATION_FIELDS = ['name', 'entityType'];
const LEAD_ROLES = ['PI', 'DIRECTOR'];

interface AuditOptions {
  output?: string;
  limitExamples: number;
}

export function parseOrphanObservationKeyAuditArgs(argv: string[]): AuditOptions {
  const options: AuditOptions = { limitExamples: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[(index += 1)]);
    } else if (arg === '--limit-examples') {
      const raw = argv[(index += 1)];
      if (!raw || !/^\d+$/.test(raw)) throw new Error('--limit-examples requires an integer');
      options.limitExamples = Number(raw);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

interface KeyRollup {
  _id: string;
  liveObservationCount: number;
  sourceNames: string[];
  runIds: mongoose.Types.ObjectId[];
}

async function loadLiveKeyRollup(): Promise<KeyRollup[]> {
  return Observation.aggregate([
    {
      $match: {
        entityType: 'researchEntity',
        superseded: { $ne: true },
        entityKey: { $type: 'string' },
      },
    },
    {
      $group: {
        _id: '$entityKey',
        liveObservationCount: { $sum: 1 },
        sourceNames: { $addToSet: '$sourceName' },
        runIds: { $addToSet: '$scrapeRunId' },
      },
    },
  ]).allowDiskUse(true);
}

async function loadObservedEntityIdsByKey(
  entityKeys: string[],
): Promise<Map<string, mongoose.Types.ObjectId[]>> {
  const rows = await Observation.aggregate([
    {
      $match: {
        entityType: 'researchEntity',
        entityKey: { $in: entityKeys },
        entityId: { $type: 'objectId' },
      },
    },
    { $group: { _id: '$entityKey', entityIds: { $addToSet: '$entityId' } } },
  ]).allowDiskUse(true);
  return new Map(rows.map((row: any) => [row._id, row.entityIds]));
}

async function loadMintIntentFieldsByKey(
  entityKeys: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await Observation.aggregate([
    {
      $match: {
        entityType: 'researchEntity',
        superseded: { $ne: true },
        entityKey: { $in: entityKeys },
        field: { $in: MINT_INTENT_OBSERVATION_FIELDS },
      },
    },
    { $sort: { observedAt: 1 } },
    { $group: { _id: { entityKey: '$entityKey', field: '$field' }, value: { $last: '$value' } } },
  ]).allowDiskUse(true);

  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows as any[]) {
    const existing = byKey.get(row._id.entityKey) || {};
    existing[row._id.field] = row.value;
    byKey.set(row._id.entityKey, existing);
  }
  return byKey;
}

interface EntityIndexes {
  slugToEntity: Map<string, { _id: string; slug: string }>;
  idToSlug: Map<string, string>;
  identityToSlugs: Map<string, string[]>;
}

async function loadEntityIndexes(): Promise<EntityIndexes> {
  const entities = await ResearchEntity.find({}).select('slug').lean<Array<any>>();
  const slugToEntity = new Map<string, { _id: string; slug: string }>();
  const idToSlug = new Map<string, string>();
  const identityToSlugs = new Map<string, string[]>();

  for (const entity of entities) {
    const slug = typeof entity.slug === 'string' ? entity.slug : '';
    const id = String(entity._id);
    idToSlug.set(id, slug);
    if (!slug) continue;
    slugToEntity.set(slug, { _id: id, slug });
    for (const candidate of identityCandidatesForSlug(slug)) {
      const bucket = identityToSlugs.get(candidate) || [];
      bucket.push(slug);
      identityToSlugs.set(candidate, bucket);
    }
  }
  return { slugToEntity, idToSlug, identityToSlugs };
}

async function loadLeadIndex(
  idToSlug: Map<string, string>,
): Promise<{ identityToLeadSlugs: Map<string, string[]>; knownPersonIdentities: Set<string> }> {
  const researchers = await Researcher.find({}).select('displayName').lean<Array<any>>();
  const identityToResearcherIds = new Map<string, string[]>();
  const knownPersonIdentities = new Set<string>();
  for (const researcher of researchers) {
    for (const candidate of identityCandidatesForPersonName(researcher.displayName)) {
      knownPersonIdentities.add(candidate);
      const bucket = identityToResearcherIds.get(candidate) || [];
      bucket.push(String(researcher._id));
      identityToResearcherIds.set(candidate, bucket);
    }
  }

  const assignments = await RoleAssignment.find({
    role: { $in: LEAD_ROLES },
    archived: { $ne: true },
    'target.kind': 'RESEARCH_ENTITY',
  })
    .select('personId target.id')
    .lean<Array<any>>();

  const ledSlugsByPerson = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const slug = idToSlug.get(String(assignment.target?.id));
    if (!slug) continue;
    const personId = String(assignment.personId);
    const bucket = ledSlugsByPerson.get(personId) || new Set<string>();
    bucket.add(slug);
    ledSlugsByPerson.set(personId, bucket);
  }

  const identityToLeadSlugs = new Map<string, string[]>();
  for (const [candidate, researcherIds] of identityToResearcherIds) {
    const slugs = new Set<string>();
    for (const researcherId of researcherIds) {
      for (const slug of ledSlugsByPerson.get(researcherId) || []) slugs.add(slug);
    }
    if (slugs.size > 0) identityToLeadSlugs.set(candidate, [...slugs]);
  }
  return { identityToLeadSlugs, knownPersonIdentities };
}

function firstIndexHit(candidates: string[], index: Map<string, string[]>): string[] {
  for (const candidate of candidates) {
    const hit = index.get(candidate);
    if (hit && hit.length > 0) return hit;
  }
  return [];
}

export async function runOrphanObservationKeyAudit() {
  const { slugToEntity, idToSlug, identityToSlugs } = await loadEntityIndexes();
  const redirectSlugs = new Set(
    (
      await ResearchEntityRedirect.find({ mergedSlug: { $type: 'string' } })
        .select('mergedSlug')
        .lean<Array<any>>()
    ).map((row) => row.mergedSlug as string),
  );

  const rollup = (await loadLiveKeyRollup()) as unknown as KeyRollup[];
  const orphanRollup = rollup.filter(
    (row) => !slugToEntity.has(row._id) && !redirectSlugs.has(row._id),
  );
  const orphanKeys = orphanRollup.map((row) => row._id);

  const observedEntityIds = await loadObservedEntityIdsByKey(orphanKeys);
  const mintIntentFields = await loadMintIntentFieldsByKey(orphanKeys);
  const { identityToLeadSlugs, knownPersonIdentities } = await loadLeadIndex(idToSlug);

  const enabledSourceNames = new Set(
    (await Source.find({}).select('name enabled').lean<Array<any>>())
      .filter((source) => source.enabled !== false)
      .map((source) => source.name as string),
  );

  const runStatusById = new Map(
    (await ScrapeRun.find({}).select('status').lean<Array<any>>()).map((run) => [
      String(run._id),
      String(run.status),
    ]),
  );

  const classifications: OrphanObservationKeyClassification[] = orphanRollup.map((row) => {
    const fields = mintIntentFields.get(row._id) || {};
    const candidates = identityCandidatesForOrphanKey(row._id, fields.name);
    const entityIds = observedEntityIds.get(row._id) || [];
    const liveEntityIdSlugs = entityIds
      .map((entityId) => idToSlug.get(String(entityId)))
      .filter((slug): slug is string => Boolean(slug));

    return classifyOrphanObservationKey({
      entityKey: row._id,
      liveObservationCount: row.liveObservationCount,
      sourceNames: row.sourceNames.filter(Boolean),
      enabledSourceNames,
      emittingRunStatuses: row.runIds
        .filter(Boolean)
        .map((runId) => runStatusById.get(String(runId)) || 'missing_run_record'),
      observedEntityIdCount: entityIds.length,
      liveEntityIdSlugs,
      observedName: fields.name,
      observedEntityType: fields.entityType,
      leadTargetSlugs: firstIndexHit(candidates, identityToLeadSlugs),
      nameMatchTargetSlugs: firstIndexHit(candidates, identityToSlugs),
      personKnown: candidates.some((candidate) => knownPersonIdentities.has(candidate)),
    });
  });

  const summary = summarizeOrphanObservationKeys(classifications);
  return {
    generatedAt: new Date().toISOString(),
    population: {
      distinctLiveResearchEntityKeys: rollup.length,
      liveResearchEntityObservationsOnKeys: rollup.reduce(
        (total, row) => total + row.liveObservationCount,
        0,
      ),
      researchEntitySlugs: slugToEntity.size,
      redirectMergedSlugs: redirectSlugs.size,
      keysWithNoEntitySlug: rollup.filter((row) => !slugToEntity.has(row._id)).length,
      redirectCoveredKeys: rollup.filter(
        (row) => !slugToEntity.has(row._id) && redirectSlugs.has(row._id),
      ).length,
    },
    summary,
    classifications: classifications.sort(
      (left, right) => right.liveObservationCount - left.liveObservationCount,
    ),
  };
}

function reportOrphanObservationKeyAudit(
  report: Awaited<ReturnType<typeof runOrphanObservationKeyAudit>>,
  exampleCount: number,
): void {
  const { population, summary } = report;
  console.log('Population');
  console.log(
    `  distinct live researchEntity keys      ${population.distinctLiveResearchEntityKeys}`,
  );
  console.log(
    `  live observations on those keys        ${population.liveResearchEntityObservationsOnKeys}`,
  );
  console.log(`  keys with no research entity slug      ${population.keysWithNoEntitySlug}`);
  console.log(`  of those, covered by a merge redirect  ${population.redirectCoveredKeys}`);
  console.log(`  orphan keys (no slug, no redirect)     ${summary.keys}`);
  console.log(`  live observations on orphan keys       ${summary.liveObservations}`);
  console.log(
    `  never offered to a materializer        ${summary.neverMaterializedKeys} keys / ${summary.neverMaterializedLiveObservations} observations`,
  );
  console.log('\nCategories');
  for (const [category, bucket] of Object.entries(summary.byCategory).sort(
    (left, right) => right[1].keys - left[1].keys,
  )) {
    console.log(
      `  ${String(bucket.keys).padStart(5)} keys ${String(bucket.liveObservations).padStart(6)} obs  ${category}  remedy=${bucket.remedy}  never_materialized=${bucket.neverMaterializedKeys}`,
    );
    console.log(`        ${bucket.exampleKeys.slice(0, exampleCount).join(', ')}`);
  }
}

async function main(): Promise<void> {
  const options = parseOrphanObservationKeyAuditArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  await mongoose.connect(mongoUrl);
  try {
    const report = await runOrphanObservationKeyAudit();
    reportOrphanObservationKeyAudit(report, options.limitExamples);
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(report, null, 2), { mode: 0o600 });
      console.log(`\nReport written to ${options.output}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`orphan observation key audit failed: ${sanitizeLogValue(error)}`);
    process.exit(1);
  });
}
