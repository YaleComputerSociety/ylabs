/**
 * Backfill the canonical `research_plans` collection from the legacy embedded
 * `User.savedResearchEntities` / `User.savedResearchEntityPlans` store (#208).
 *
 * The runtime read/write path now serves saved research planning from the
 * first-class `ResearchPlan` collection keyed on `accountId` + `target`. This
 * one-time backfill lifts each user's already-saved entities and plan map into
 * canonical rows so nothing saved before the cutover is lost. It is additive:
 * it inserts only entity+account pairs that do not already have a canonical
 * plan, and it records every collision, orphan plan, and unresolved account in
 * the existing `User.savedResearchEntityPlanMigrationConflicts` field.
 *
 * Legacy pathway-era fields with no canonical home (intent, checklistHistory,
 * actedOnDate, followUpIntervalDays) are intentionally not migrated and are
 * reported per user as dropped legacy fields.
 *
 * Dry-run by default. APPLY requires:
 * --apply --limit=N --confirm-v4-migration
 *
 * Run from data-migration/:
 * npx tsx BackfillResearchPlansFromUsers.ts
 * (add --apply --limit=1 --confirm-v4-migration to write)
 */
import fs from 'fs';
import mongoose from '../server/node_modules/mongoose';
import {
  RESEARCH_PLAN_SCHEMA_VERSION,
} from '../server/src/models/researchPlan';
import {
  planResearchPlanBackfill,
  researchPlanBackfillKey,
  type BackfillUserInput,
} from '../server/src/scripts/researchPlanBackfillCore';
import {
  assertV4MigrationApplyAllowed,
  buildV4MigrationOutput,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
} from './v4MigrationUtils';

const TITLE = 'Backfill research plans from users';
const SCRIPT_NAME = 'model-refactor:backfill-research-plans';

const toHexString = (value: unknown): string | null => {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString().toLowerCase();
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{24}$/i.test(text) ? text : null;
};

async function run(): Promise<void> {
  const options = parseMigrationOptions(process.argv.slice(2));
  await connectForMigration(TITLE, options);
  assertV4MigrationApplyAllowed(options, SCRIPT_NAME);

  const observedAt = new Date();
  const usersCollection = mongoose.connection.collection('users');
  const accountsCollection = mongoose.connection.collection('accounts');
  const researchPlansCollection = mongoose.connection.collection('research_plans');

  const accountIdByNetid = new Map<string, string>();
  for await (const account of accountsCollection.find(
    {},
    { projection: { netid: 1 } },
  )) {
    const netid = typeof account.netid === 'string' ? account.netid.trim().toLowerCase() : '';
    if (netid) accountIdByNetid.set(netid, String(account._id));
  }

  const existingPlanKeys = new Set<string>();
  for await (const plan of researchPlansCollection.find(
    { 'target.kind': 'RESEARCH_ENTITY' },
    { projection: { accountId: 1, 'target.id': 1 } },
  )) {
    const accountId = toHexString(plan.accountId);
    const targetId = toHexString(plan.target?.id);
    if (accountId && targetId) existingPlanKeys.add(researchPlanBackfillKey(accountId, targetId));
  }

  const users: BackfillUserInput[] = [];
  for await (const user of usersCollection.find(
    {
      $or: [
        { savedResearchEntities: { $exists: true, $ne: [] } },
        { savedResearchEntityPlans: { $exists: true, $ne: {} } },
      ],
    },
    { projection: { netid: 1, savedResearchEntities: 1, savedResearchEntityPlans: 1 } },
  )) {
    const netid = typeof user.netid === 'string' ? user.netid.trim() : '';
    if (!netid) continue;
    users.push({
      netid,
      accountId: accountIdByNetid.get(netid.toLowerCase()) ?? null,
      savedResearchEntities: Array.isArray(user.savedResearchEntities)
        ? user.savedResearchEntities
        : [],
      savedResearchEntityPlans:
        user.savedResearchEntityPlans && typeof user.savedResearchEntityPlans === 'object'
          ? (user.savedResearchEntityPlans as Record<string, unknown>)
          : {},
    });
  }

  const plan = planResearchPlanBackfill(users, existingPlanKeys, {
    observedAt: observedAt.toISOString(),
  });

  const rowsToInsert =
    options.apply && Number.isFinite(options.limit)
      ? plan.rows.slice(0, options.limit as number)
      : plan.rows;

  let inserted = 0;
  let conflictsWritten = 0;
  let migrationCompletedMarked = 0;

  if (options.apply) {
    for (const row of rowsToInsert) {
      try {
        await researchPlansCollection.insertOne({
          schemaVersion: RESEARCH_PLAN_SCHEMA_VERSION.currentVersion,
          accountId: new mongoose.Types.ObjectId(row.accountId),
          target: {
            kind: 'RESEARCH_ENTITY',
            id: new mongoose.Types.ObjectId(row.targetId),
          },
          stage: row.fields.stage,
          privateNotes: row.fields.privateNotes,
          checklist: row.fields.checklist.map((item) => ({
            label: item.label,
            completed: item.completed,
            ...(item.completedAt ? { completedAt: new Date(item.completedAt) } : {}),
          })),
          deadlines: row.fields.deadlines.map((deadline) => ({
            label: deadline.label,
            dueAt: new Date(deadline.dueAt),
          })),
          exportPreferences: row.fields.exportPreferences,
          archived: false,
          createdAt: observedAt,
          updatedAt: observedAt,
        });
        inserted += 1;
      } catch (error: any) {
        if (error?.code === 11000) {
          plan.conflictsByNetid[row.netid] = plan.conflictsByNetid[row.netid] || {
            collisions: [],
            orphanPlans: [],
          };
          plan.conflictsByNetid[row.netid].collisions.push(row.targetId);
          continue;
        }
        throw error;
      }
    }

    const pendingRowCountByNetid = new Map<string, number>();
    for (const row of plan.rows) {
      pendingRowCountByNetid.set(row.netid, (pendingRowCountByNetid.get(row.netid) ?? 0) + 1);
    }
    const insertedRowCountByNetid = new Map<string, number>();
    for (const row of rowsToInsert) {
      insertedRowCountByNetid.set(row.netid, (insertedRowCountByNetid.get(row.netid) ?? 0) + 1);
    }

    const completedNetids = users
      .filter((user) => user.accountId)
      .map((user) => user.netid)
      .filter(
        (netid) =>
          (pendingRowCountByNetid.get(netid) ?? 0) === (insertedRowCountByNetid.get(netid) ?? 0),
      );
    for (const netid of new Set(completedNetids)) {
      const conflicts = plan.conflictsByNetid[netid];
      const update: Record<string, unknown> = {
        $set: { savedResearchEntityMigrationCompleted: true },
      };
      if (conflicts) {
        (update.$set as Record<string, unknown>).savedResearchEntityPlanMigrationConflicts = {
          collisions: conflicts.collisions,
          orphanPlans: conflicts.orphanPlans,
          recordedAt: observedAt.toISOString(),
        };
        conflictsWritten += 1;
      }
      await usersCollection.updateOne(
        { netid: { $regex: `^${netid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
        update,
      );
      migrationCompletedMarked += 1;
    }
  }

  const result = {
    scriptName: SCRIPT_NAME,
    applied: options.apply,
    ...plan.stats,
    plannedRows: plan.rows.length,
    inserted,
    conflictsWritten,
    migrationCompletedMarked,
    conflictSamples: Object.entries(plan.conflictsByNetid)
      .slice(0, 25)
      .map(([netid, report]) => ({ netid, ...report })),
    rowSamples: plan.rows.slice(0, 25).map((row) => ({
      netid: row.netid,
      targetId: row.targetId,
      stage: row.fields.stage,
      hasPrivateNotes: row.fields.privateNotes.length > 0,
      checklistItems: row.fields.checklist.length,
      deadlines: row.fields.deadlines.length,
      droppedLegacyFields: row.droppedLegacyFields,
    })),
  };

  const output = buildV4MigrationOutput(result, {
    db: mongoose.connection.name,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  if (options.output) fs.writeFileSync(options.output, JSON.stringify(output, null, 2));

  await disconnectForMigration();
}

run().catch(async (err) => {
  console.error(err);
  await disconnectForMigration().catch(() => undefined);
  process.exit(1);
});
