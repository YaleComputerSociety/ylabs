/**
 * One-time backlog repair for the value-in-fingerprint supersession bug.
 *
 * Background: buildObservationFingerprint used to include `value`, so for "latest-wins"
 * fields (fullDescription, shortDescription, researchAreas, methods) an LLM source that
 * paraphrases the text each run produced a new fingerprint every time and never superseded
 * its predecessor. Hundreds of non-superseded observations accumulated per (entity, field),
 * and the materializer flagged each as a conflict (-> sourceHealthWarnings -> data-quality block).
 *
 * The code fix (observationStore.ts: LATEST_WINS_FINGERPRINT_FIELDS) makes those fields'
 * fingerprints value-less going forward. This migration repairs the existing backlog:
 *   For every group of non-superseded observations sharing (sourceName, entityType, entity, field)
 *   on a latest-wins field:
 *     - keep the most recent by observedAt (tie-break: _id),
 *     - mark the rest superseded (supersededBy = kept id),
 *     - rewrite the survivor's observationFingerprint to the new value-less form so the NEXT
 *       scrape run supersedes it cleanly (otherwise a new value-less fingerprint would not match
 *       the survivor's old value-ful fingerprint and the conflict would reappear).
 *
 * Dry-run by default. Apply requires: --apply --limit=N --confirm-v4-migration
 * (limit caps the number of (entity, field) groups processed, for bounded guarded applies).
 *
 * Run from data-migration/:  npx tsx --transpile-only SupersedeStaleLatestWinsObservations.ts [flags]
 */
import mongoose from '../server/node_modules/mongoose';
import { Observation } from '../server/src/models/observation';
import {
  buildObservationFingerprint,
  LATEST_WINS_FINGERPRINT_FIELDS,
} from '../server/src/scrapers/observationStore';
import {
  buildV4MigrationOutput,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
} from './v4MigrationUtils';
import fs from 'fs';

const TITLE = 'Supersede stale latest-wins observations';
const LATEST_WINS = Array.from(LATEST_WINS_FINGERPRINT_FIELDS);

interface GroupRow {
  _id: {
    sourceName: string;
    entityType: string;
    entityId?: unknown;
    entityKey?: string;
    field: string;
  };
  docs: Array<{ id: unknown; observedAt?: Date }>;
  count: number;
}

interface Result {
  latestWinsFields: string[];
  groupsScanned: number;
  groupsProcessed: number;
  groupsWithDuplicates: number;
  orphanGroupsSkipped: number;
  activeObservationsBefore: number;
  observationsSuperseded: number;
  survivorsRefingerprinted: number;
  perField: Record<string, { groups: number; superseded: number }>;
  perSource: Record<string, { groups: number; superseded: number }>;
  samples: Array<{
    sourceName: string;
    field: string;
    entity: string;
    activeBefore: number;
    keptObservedAt?: string;
  }>;
}

function entityKeyFor(id: GroupRow['_id']): string | undefined {
  const entityId =
    id.entityId === null || id.entityId === undefined || id.entityId === ''
      ? undefined
      : String(id.entityId);
  const entityKey =
    id.entityKey === null || id.entityKey === undefined || id.entityKey === ''
      ? undefined
      : String(id.entityKey);
  return entityId ? `id:${entityId}` : entityKey ? `key:${entityKey}` : undefined;
}

async function run(): Promise<void> {
  const options = parseMigrationOptions();
  await connectForMigration(TITLE, options);

  const result: Result = {
    latestWinsFields: LATEST_WINS,
    groupsScanned: 0,
    groupsProcessed: 0,
    groupsWithDuplicates: 0,
    orphanGroupsSkipped: 0,
    activeObservationsBefore: 0,
    observationsSuperseded: 0,
    survivorsRefingerprinted: 0,
    perField: {},
    perSource: {},
    samples: [],
  };

  const groups = (await Observation.aggregate(
    [
      { $match: { superseded: false, field: { $in: LATEST_WINS } } },
      {
        $group: {
          _id: {
            sourceName: '$sourceName',
            entityType: '$entityType',
            entityId: '$entityId',
            entityKey: '$entityKey',
            field: '$field',
          },
          docs: { $push: { id: '$_id', observedAt: '$observedAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ],
    { allowDiskUse: true },
  )) as GroupRow[];

  result.groupsScanned = groups.length;
  const limit = Number.isFinite(options.limit) ? (options.limit as number) : Infinity;

  for (const group of groups) {
    result.activeObservationsBefore += group.count;
    const entity = entityKeyFor(group._id);
    if (!entity) {
      // No usable entity identifier -> unfingerprintable -> never auto-superseded.
      // Leave untouched; surface as orphans for separate review.
      result.orphanGroupsSkipped += 1;
      continue;
    }
    if (result.groupsProcessed >= limit) continue;
    result.groupsProcessed += 1;

    const sourceName = group._id.sourceName;
    const field = group._id.field;
    result.perField[field] = result.perField[field] || { groups: 0, superseded: 0 };
    result.perSource[sourceName] = result.perSource[sourceName] || { groups: 0, superseded: 0 };
    result.perField[field].groups += 1;
    result.perSource[sourceName].groups += 1;

    const sorted = [...group.docs].sort((a, b) => {
      const ta = a.observedAt ? new Date(a.observedAt).getTime() : 0;
      const tb = b.observedAt ? new Date(b.observedAt).getTime() : 0;
      if (ta !== tb) return tb - ta; // newest first
      return String(b.id).localeCompare(String(a.id)); // stable tie-break
    });
    const keep = sorted[0];
    const losers = sorted.slice(1);
    const newFingerprint = buildObservationFingerprint({
      sourceName,
      entityType: group._id.entityType,
      entityId: group._id.entityId,
      entityKey: group._id.entityKey,
      field,
      value: undefined, // ignored for latest-wins fields
    });

    if (losers.length > 0) {
      result.groupsWithDuplicates += 1;
      result.observationsSuperseded += losers.length;
      result.perField[field].superseded += losers.length;
      result.perSource[sourceName].superseded += losers.length;
    }
    result.survivorsRefingerprinted += 1;

    if (result.samples.length < 25 && losers.length > 0) {
      result.samples.push({
        sourceName,
        field,
        entity,
        activeBefore: group.count,
        keptObservedAt: keep.observedAt ? new Date(keep.observedAt).toISOString() : undefined,
      });
    }

    if (options.apply) {
      const ops: any[] = [
        {
          updateOne: {
            filter: { _id: keep.id },
            update: { $set: { observationFingerprint: newFingerprint }, $unset: { supersededBy: '' } },
          },
        },
      ];
      if (losers.length > 0) {
        ops.push({
          updateMany: {
            filter: { _id: { $in: losers.map((l) => l.id) } },
            update: { $set: { superseded: true, supersededBy: keep.id } },
          },
        });
      }
      await Observation.bulkWrite(ops, { ordered: false });
    }
  }

  const output = buildV4MigrationOutput(result, {
    db: mongoose.connection.name,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    fs.writeFileSync(options.output, JSON.stringify(output, null, 2));
    console.log(`\nWrote ${options.output}`);
  }

  await disconnectForMigration();
}

run().catch(async (err) => {
  console.error(err);
  await disconnectForMigration().catch(() => undefined);
  process.exit(1);
});
