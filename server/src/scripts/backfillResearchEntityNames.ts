/**
 * Re-resolves research entity `name`/`displayName` from their existing name
 * observations using the branded-name-preference resolver, so a genuinely
 * branded name (from the lab's own microsite or a curated directory) replaces a
 * synthesized PI-derived label ("<PI> Lab", "<Person> Faculty Research", or a
 * bare person name) that only won on recency/agreement (issue #1087).
 *
 * By construction the resolver only ever moves a name toward a genuine branded
 * value: when the only candidates are synthesized the winner is unchanged, so a
 * grant-shell lab keeps its "<PI> Lab" name. displayName is corrected only when
 * the entity already stores one, never newly populated corpus-wide.
 *
 * Dry-run-first. Apply requires an explicit --limit plus --confirm-names and
 * writes only to a non-production DB. Rebuilds the Meilisearch research index
 * for every changed entity so the browse/search name never drifts from Mongo.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import {
  resolveField,
  ResolverObservation,
  MICROSITE_NAME_SOURCES,
} from '../scrapers/confidenceResolver';
import {
  collapseDuplicateResearchHomeSuffix,
  normalizeResearchEntityNameDashes,
  stripTrailingResearchHomeDescription,
} from '../utils/researchEntityNameNormalization';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const NAME_FIELDS = ['name', 'displayName'] as const;
type NameField = (typeof NAME_FIELDS)[number];

export interface ResearchEntityNameBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  batchSize: number;
  output?: string;
}

export interface ResearchEntityNameChange {
  id: string;
  slug: string;
  field: NameField;
  from: string;
  to: string;
}

export interface ResearchEntityNameBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  changedEntities: number;
  changes: ResearchEntityNameChange[];
  sampleChanges: ResearchEntityNameChange[];
  syncedToMeili: number;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('expected a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('expected a positive integer');
  return parsed;
}

export function parseResearchEntityNameBackfillArgs(
  argv: string[],
): ResearchEntityNameBackfillOptions {
  const options: ResearchEntityNameBackfillOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
    batchSize: 100,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-names') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parsePositiveInt(arg.slice('--batch-size='.length));
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown backfill:research-entity-names argument: ${arg}`);
    }
  }
  return options;
}

export function assertResearchEntityNameApplyAllowed(
  options: Pick<ResearchEntityNameBackfillOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-names.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

function sanitizeResolvedName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return normalizeResearchEntityNameDashes(
    collapseDuplicateResearchHomeSuffix(stripTrailingResearchHomeDescription(value)),
  ).trim();
}

export function planResearchEntityNameChanges(
  entity: {
    _id: unknown;
    slug?: string;
    name?: unknown;
    displayName?: unknown;
    manuallyLockedFields?: string[];
  },
  observations: ResolverObservation[],
): ResearchEntityNameChange[] {
  const locked = new Set(entity.manuallyLockedFields || []);
  const changes: ResearchEntityNameChange[] = [];
  for (const field of NAME_FIELDS) {
    if (locked.has(field)) continue;
    const current = typeof entity[field] === 'string' ? (entity[field] as string) : '';
    // displayName is corrected only when the entity already stores one; a blank
    // displayName falls back to name at read time, so leave it blank.
    if (field === 'displayName' && !current.trim()) continue;
    const resolved = resolveField(field, observations);
    const next = sanitizeResolvedName(resolved?.value);
    if (!next || next === current.trim()) continue;
    // Only ever adopt the lab's own captured microsite brand. A winner sourced
    // from grants, rosters, or a PI's affiliated-center backfill is left alone,
    // so this never rewrites a name to a conflated or PI-derived value (#1087).
    const winnerFromMicrosite = (resolved?.contributingSources ?? []).some((source) =>
      MICROSITE_NAME_SOURCES.has(source),
    );
    if (!winnerFromMicrosite) continue;
    changes.push({
      id: String(entity._id),
      slug: String(entity.slug ?? ''),
      field,
      from: current,
      to: next,
    });
  }
  return changes;
}

export interface ResearchEntityNameApplyDeps {
  persistBatch: (changes: ResearchEntityNameChange[]) => Promise<void>;
  syncBatch: (ids: string[]) => Promise<number>;
}

function createResearchEntityNameApplyDeps(): ResearchEntityNameApplyDeps {
  return {
    persistBatch: async (changes) => {
      const byId = new Map<string, Record<string, string>>();
      for (const change of changes) {
        const set = byId.get(change.id) || {};
        set[change.field] = change.to;
        byId.set(change.id, set);
      }
      await ResearchEntity.bulkWrite(
        Array.from(byId.entries()).map(([id, set]) => ({
          updateOne: { filter: { _id: id }, update: { $set: set } },
        })),
      );
    },
    syncBatch: async (ids) => {
      const fresh = await ResearchEntity.find({ _id: { $in: ids } }).lean();
      await syncEntities('researchEntity', fresh);
      return fresh.length;
    },
  };
}

export async function runResearchEntityNameBackfill(
  options: { dryRun: boolean; limit?: number; batchSize: number },
  deps: ResearchEntityNameApplyDeps = createResearchEntityNameApplyDeps(),
): Promise<ResearchEntityNameBackfillResult> {
  const query = ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug name displayName manuallyLockedFields')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as Array<Record<string, unknown>>;

  const slugs = entities.map((entity) => String(entity.slug ?? '')).filter(Boolean);
  const observationsByKey = new Map<string, ResolverObservation[]>();
  const nameObservations = await Observation.find({
    entityKey: { $in: slugs },
    field: { $in: NAME_FIELDS as unknown as string[] },
    superseded: { $ne: true },
  })
    .select('entityKey field value sourceName confidence observedAt')
    .lean();
  for (const o of nameObservations as any[]) {
    const key = String(o.entityKey);
    const list = observationsByKey.get(key) || [];
    list.push({
      field: o.field,
      value: o.value,
      sourceName: o.sourceName,
      confidence: o.confidence,
      observedAt: o.observedAt,
    });
    observationsByKey.set(key, list);
  }

  const allChanges: ResearchEntityNameChange[] = [];
  let scanned = 0;
  for (const entity of entities) {
    scanned += 1;
    const slug = String(entity.slug ?? '');
    if (!slug) continue;
    const resolverObs = observationsByKey.get(slug) || [];
    allChanges.push(...planResearchEntityNameChanges(entity as any, resolverObs));
  }

  const changedEntityIds = Array.from(new Set(allChanges.map((change) => change.id)));

  let syncedToMeili = 0;
  if (!options.dryRun && allChanges.length > 0) {
    for (let i = 0; i < allChanges.length; i += options.batchSize) {
      const batch = allChanges.slice(i, i + options.batchSize);
      await deps.persistBatch(batch);
      syncedToMeili += await deps.syncBatch(Array.from(new Set(batch.map((change) => change.id))));
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned,
    changedEntities: changedEntityIds.length,
    changes: allChanges,
    sampleChanges: allChanges.slice(0, 50),
    syncedToMeili,
  };
}

async function main(): Promise<void> {
  const options = parseResearchEntityNameBackfillArgs(process.argv.slice(2));
  assertResearchEntityNameApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfill:research-entity-names',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runResearchEntityNameBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
      batchSize: options.batchSize,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        limit: options.explicitLimit ? options.limit : undefined,
        batchSize: options.batchSize,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved research-entity name backfill report to ${safeOutput}`);
    }
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          scanned: result.scanned,
          changedEntities: result.changedEntities,
          totalFieldChanges: result.changes.length,
          syncedToMeili: result.syncedToMeili,
          sampleChanges: result.sampleChanges,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
